"""TF-1·TF-2: 동시 예약 경쟁과 실패 시 해제."""

from concurrent.futures import ThreadPoolExecutor

import pytest
from sqlalchemy import text

from app.budget.ledger import BudgetExceeded, Ledger, cost_micros, pool_caps
from app.config import Settings


def make(engine, usd=0.001):
    return Ledger(engine, Settings(daily_ai_budget_usd=usd, ai_budget_split="100/0/0"))


def row(engine, pool="SUMMARY"):
    with engine.connect() as c:
        return c.execute(
            text(
                "SELECT cap_micros, reserved_micros, spent_micros FROM ai.budget_day WHERE pool=:p"
            ),
            {"p": pool},
        ).one()


def test_split_caps():
    assert pool_caps(Settings(daily_ai_budget_usd=1, ai_budget_split="60/20/20")) == {
        "SUMMARY": 600_000, "SEARCH": 200_000, "ANSWER": 200_000,
    }  # fmt: skip


def test_tf1_concurrent_reserve_never_exceeds_cap(engine):
    # cap SUMMARY = 1000 micros, 건당 100 → 정확히 10건만 성공
    ledger = make(engine)
    external_calls = []

    def attempt(_):
        try:
            ledger.reserve("SUMMARY", 100)
        except BudgetExceeded:
            return False
        external_calls.append(1)  # 예약 성공 후에만 외부 호출
        return True

    with ThreadPoolExecutor(50) as ex:
        results = list(ex.map(attempt, range(50)))
    assert sum(results) == 10
    assert len(external_calls) == 10
    cap, reserved, _ = row(engine)
    assert (cap, reserved) == (1000, 1000)


def test_tf2_release_on_exception(engine):
    ledger = make(engine)
    with pytest.raises(RuntimeError), ledger.reserved("SUMMARY", 300):
        raise RuntimeError("provider down")
    assert row(engine).reserved_micros == 0


def test_settle_moves_reserved_to_spent_and_logs(engine):
    ledger = make(engine, usd=1)
    r = ledger.reserve("SUMMARY", 5000)
    ledger.settle(r, provider="anthropic", model="claude-haiku-5-5", purpose="summary",
                  input_tokens=1000, output_tokens=100, item_id=7)  # fmt: skip
    _, reserved, spent = row(engine)
    assert (reserved, spent) == (0, 1500)  # 1000*1 + 100*5
    with engine.connect() as c:
        assert c.execute(text("SELECT cost_micros, item_id FROM ai.usage_ledger")).one() == (
            1500,
            7,
        )


def test_estimate_counts_korean_one_token_per_char():
    # Y7: 한국어는 문자당 ≥1토큰이라 문자수/3으로 추정하면 과소 → 비ASCII는 문자당 1토큰
    from app.budget.ledger import estimate_micros

    s = Settings()
    model = s.summary_model
    ko = estimate_micros(s, model, "한" * 300, 0)
    assert ko >= cost_micros(s, model, 300, 0)
    assert estimate_micros(s, model, "a" * 300, 0) == cost_micros(s, model, 100, 0)
