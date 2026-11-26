"""한국어 요약 한 건 — 전처리 → 정보 부족 판정 → 예산 예약 → 구조화 출력 → 인용 검증."""

from dataclasses import dataclass, field

from pydantic import BaseModel

from app.budget.ledger import BudgetExceeded, Ledger, estimate_micros
from app.config import Settings
from app.providers.claude import LLM
from app.summary.preprocess import MIN_BODY_CHARS, body_length, clean
from app.summary.prompt import SYSTEM, build_user
from app.summary.quote_verify import verify_quote

MAX_OUTPUT_TOKENS = 1024


class SummaryOut(BaseModel):
    summary_ko: str
    use_cases_ko: list[str]
    install_commands: list[str]
    requirements_ko: list[str]


@dataclass
class SummaryResult:
    status: str  # OK | INSUFFICIENT | FAILED
    model: str
    summary_ko: str | None = None
    use_cases_ko: list[str] = field(default_factory=list)
    install_commands: list[str] = field(default_factory=list)
    requirements_ko: list[str] = field(default_factory=list)
    rejected_quote_count: int = 0
    input_tokens: int | None = None
    output_tokens: int | None = None
    error: str | None = None


def summarize(
    llm: LLM, ledger: Ledger, settings: Settings, *, item_id: int, name: str, doc: str
) -> SummaryResult:
    """BudgetExceeded는 잡아 삼키지 않고 올려보낸다(호출자가 배치를 중단해야 하므로).

    그 외 제공자 예외는 FAILED 행으로 남겨 다음 실행에서 재시도 대상이 되게 한다.
    """
    model = settings.summary_model
    cleaned = clean(doc)
    if body_length(cleaned) < MIN_BODY_CHARS:
        return SummaryResult("INSUFFICIENT", model)
    user = build_user(name, cleaned)
    est = estimate_micros(settings, model, SYSTEM + user, MAX_OUTPUT_TOKENS)
    try:
        with ledger.reserved("SUMMARY", est) as r:  # 예외 시 자동 해제(호출 실패는 과금 없음)
            res = llm.parse(
                model=model,
                system=SYSTEM,
                user=user,
                schema=SummaryOut,
                max_tokens=MAX_OUTPUT_TOKENS,
            )
            ledger.settle(
                r, provider="anthropic", model=model, purpose="summary",
                input_tokens=res.input_tokens, output_tokens=res.output_tokens, item_id=item_id,
            )  # fmt: skip
    except BudgetExceeded:
        raise
    except Exception as e:
        return SummaryResult("FAILED", model, error=str(e)[:500])
    out = res.parsed
    # 원문 대조는 전처리 전 원본 기준 — 걷어낸 부분에 있던 명령도 원문에 있으면 정당하다.
    kept = [c.strip() for c in out.install_commands if verify_quote(c, doc)]
    return SummaryResult(
        "OK" if out.summary_ko.strip() else "FAILED",
        model,
        summary_ko=out.summary_ko.strip() or None,
        use_cases_ko=out.use_cases_ko[:3],
        install_commands=kept,
        requirements_ko=out.requirements_ko,
        rejected_quote_count=len(out.install_commands) - len(kept),
        input_tokens=res.input_tokens,
        output_tokens=res.output_tokens,
        error=None if out.summary_ko.strip() else "빈 요약",
    )
