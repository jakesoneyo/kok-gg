"""일일 AI 예산 원장 — Postgres 조건부 UPDATE로 원자적 예약·정산·해제(ARCHITECTURE 9.2).

한 문장 UPDATE라 동시 요청 N개가 와도 cap을 넘길 수 없고, DB CHECK가 이중 안전장치다.
프로세스가 예약 후 죽으면 reserved가 남아 예산이 줄어드는 쪽(fail-closed)으로만 틀린다.
각 연산은 자체 트랜잭션으로 즉시 커밋한다(예약이 다른 요청에 바로 보여야 하므로).
"""

import math
from collections.abc import Callable
from contextlib import contextmanager
from dataclasses import dataclass
from datetime import UTC, date, datetime
from typing import Literal

from sqlalchemy import Engine, text

from app.config import Settings

Pool = Literal["SUMMARY", "SEARCH", "ANSWER"]
POOLS: tuple[Pool, ...] = ("SUMMARY", "SEARCH", "ANSWER")


class BudgetExceeded(Exception):
    """풀 잔량 부족 — 호출자는 외부 API를 부르지 않고 degraded/중단 경로로 간다."""


@dataclass
class Reservation:
    day: date
    pool: Pool
    est_micros: int


def utc_today() -> date:
    # 날짜 경계는 UTC(ARCHITECTURE 9.2)
    return datetime.now(UTC).date()


def cost_micros(settings: Settings, model: str, input_tokens: int, output_tokens: int) -> int:
    """USD/MTok 단가 × 토큰 = micro-USD(1 USD/MTok = 토큰당 1 micro). 올림해 과소 청구 방지."""
    p_in, p_out = settings.model_prices[model]
    return math.ceil(input_tokens * p_in + output_tokens * p_out)


def estimate_micros(
    settings: Settings, model: str, input_chars: int, max_output_tokens: int
) -> int:
    """입력 문자수/3을 토큰으로 보는 과대 추정 — 상한을 넘을 수 없는 방향으로만 오차."""
    return cost_micros(settings, model, math.ceil(input_chars / 3), max_output_tokens)


def pool_caps(settings: Settings) -> dict[Pool, int]:
    split = [int(x) for x in settings.ai_budget_split.split("/")]
    total = round(settings.daily_ai_budget_usd * 1_000_000)
    return {p: total * s // sum(split) for p, s in zip(POOLS, split, strict=True)}


class Ledger:
    def __init__(self, engine: Engine, settings: Settings, today: Callable[[], date] = utc_today):
        self.engine, self.settings, self._today = engine, settings, today

    def _ensure_day(self, conn, day: date) -> None:
        # 하루 첫 호출이 3행을 만든다. 동시 호출은 ON CONFLICT가 흡수한다.
        for pool, cap in pool_caps(self.settings).items():
            conn.execute(
                text(
                    "INSERT INTO ai.budget_day (day, pool, cap_micros) VALUES (:d, :p, :c) "
                    "ON CONFLICT DO NOTHING"
                ),
                {"d": day, "p": pool, "c": cap},
            )

    def reserve(self, pool: Pool, est_micros: int) -> Reservation:
        day = self._today()
        with self.engine.begin() as conn:
            self._ensure_day(conn, day)
            row = conn.execute(
                text(
                    "UPDATE ai.budget_day SET reserved_micros = reserved_micros + :e "
                    "WHERE day = :d AND pool = :p "
                    "AND spent_micros + reserved_micros + :e <= cap_micros RETURNING day"
                ),
                {"e": est_micros, "d": day, "p": pool},
            ).first()
        if row is None:
            raise BudgetExceeded(pool)
        return Reservation(day, pool, est_micros)

    def settle(
        self,
        r: Reservation,
        *,
        provider: Literal["anthropic", "voyage"],
        model: str,
        purpose: str,
        input_tokens: int,
        output_tokens: int = 0,
        item_id: int | None = None,
    ) -> None:
        actual = cost_micros(self.settings, model, input_tokens, output_tokens)
        # 실제가 추정을 넘어도 spent는 기록하되 reserved는 est만큼만 해제한다(CHECK가 초과를 막는다).
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE ai.budget_day SET reserved_micros = reserved_micros - :e, "
                    "spent_micros = spent_micros + LEAST(:a, cap_micros - spent_micros - "
                    "(reserved_micros - :e)) WHERE day = :d AND pool = :p"
                ),
                {"e": r.est_micros, "a": actual, "d": r.day, "p": r.pool},
            )
            conn.execute(
                text(
                    "INSERT INTO ai.usage_ledger (day, pool, provider, model, purpose, "
                    "input_tokens, output_tokens, cost_micros, item_id) "
                    "VALUES (:d, :p, :pr, :m, :pu, :i, :o, :c, :it)"
                ),
                {
                    "d": r.day, "p": r.pool, "pr": provider, "m": model, "pu": purpose,
                    "i": input_tokens, "o": output_tokens, "c": actual, "it": item_id,
                },
            )  # fmt: skip

    def release(self, r: Reservation) -> None:
        with self.engine.begin() as conn:
            conn.execute(
                text(
                    "UPDATE ai.budget_day SET reserved_micros = reserved_micros - :e "
                    "WHERE day = :d AND pool = :p"
                ),
                {"e": r.est_micros, "d": r.day, "p": r.pool},
            )

    @contextmanager
    def reserved(self, pool: Pool, est_micros: int):
        """예약 → 본문 실행 → 예외면 자동 해제. 성공 시 호출자가 settle 해야 한다."""
        r = self.reserve(pool, est_micros)
        try:
            yield r
        except BaseException:
            self.release(r)
            raise
