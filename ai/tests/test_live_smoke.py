"""실제 키로 제공자 계약을 확인하는 옵트인 스모크 — 기본 스킵(CI·로컬 모두 외부 호출 0)."""

import os

import pytest

from app.config import get_settings

pytestmark = pytest.mark.skipif(
    os.environ.get("KOK_LIVE_SMOKE") != "1", reason="KOK_LIVE_SMOKE=1 일 때만 실행"
)


def test_voyage_embeds_1024_dims():
    from app.providers.voyage import VoyageClient

    s = get_settings()
    vecs, tokens = VoyageClient(s.voyage_api_key).embed(["hook"], "query", s.embed_model)
    assert len(vecs[0]) == 1024 and tokens > 0


def test_claude_structured_output():
    from app.providers.claude import AnthropicLLM
    from app.summary.service import SummaryOut

    s = get_settings()
    res = AnthropicLLM(s.anthropic_api_key).parse(
        model=s.summary_model, system="요약하라", user="lint hook runs eslint.",
        schema=SummaryOut, max_tokens=300,
    )  # fmt: skip
    assert res.parsed.summary_ko
