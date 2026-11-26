"""TF-5(재동기화)·TF-9(저하)·TF-10(인용 검증)·TF-11(캐시)·TF-13(필터) — 가짜 제공자 + 실제 pgvector."""

from sqlalchemy import text

from app.search.service import AnswerOut
from tests.fakes import FakeLLM


def test_tf5_same_sha_skips_claude_changed_sha_calls_once(world):
    first = world.sync()
    assert (first.processed, world.llm.calls, first.remaining) == (4, 4, 0)
    assert first.index_version == 1 and world.index.doc_count == 4

    again = world.sync()
    assert (again.processed, world.llm.calls) == (0, 4)  # Claude 0회

    world.seed(1, "HOOK", "x", "x", "run lint hook before pull request, now changed")
    third = world.sync()
    assert (third.processed, world.llm.calls) == (1, 5)  # sha 변경 → 1회
    assert third.index_version == 2


def test_sync_insufficient_body_counts_and_still_indexed(world):
    world.seed(9, "SKILL", "tiny", "짧은 문서", "too short", filler=False)
    res = world.sync()
    assert res.insufficient == 1 and world.index.doc_count == 5
    assert world.llm.calls == 4


def test_sync_budget_exhausted_stops_and_resumes_later(world):
    from app.budget.ledger import Ledger
    from app.config import Settings

    tiny = Settings(daily_ai_budget_usd=0.002, ai_budget_split="100/0/0")  # 요약 1~2건분
    import app.jobs.sync as sync_mod

    res = sync_mod.run_sync(
        world.engine, world.llm, world.voyage, Ledger(world.engine, tiny), tiny, world.index, 50
    )
    assert res.budget_exhausted and res.remaining > 0
    assert world.llm.calls < 4


def test_tf13_kind_filter_returns_only_hooks_via_vector(world):
    world.sync()
    out = world.service.search("lint hook", kind="HOOK")
    ids = [i["itemId"] for i in out["items"]]
    assert set(ids) <= {1, 3} and 1 in ids and not out["degraded"]
    assert all(i["ranks"]["vector"] is not None for i in out["items"])
    assert out["items"][0]["itemId"] == 1


def test_level_filter(world):
    world.seed(
        2, "SKILL", "lint-skill", "코드 lint 스킬", "lint skill formats code style", level="DANGER"
    )
    with world.admin.begin() as c:
        c.execute(text("UPDATE public.item SET current_level='DANGER' WHERE id=2"))
    world.sync()
    ids = [i["itemId"] for i in world.service.search("lint", level="DANGER")["items"]]
    assert ids == [2]


def test_korean_query_finds_korean_summary_by_bm25(world):
    world.sync()
    out = world.service.search("PR 올리기 전에 lint 돌려주는 hook")
    assert out["items"][0]["itemId"] == 1 and out["items"][0]["ranks"]["bm25"] == 1


def _zero_cap(world, pool):
    with world.admin.begin() as c:
        c.execute(text("UPDATE ai.budget_day SET cap_micros = 0 WHERE pool = :p"), {"p": pool})


def test_tf9_search_pool_exhausted_degrades_without_voyage_query_call(world):
    world.sync()
    embed_before = world.voyage.embed_calls
    _zero_cap(world, "SEARCH")
    out = world.service.search("lint hook")
    assert out["degraded"] is True and out["items"]
    assert world.voyage.embed_calls == embed_before and world.voyage.rerank_calls == 0
    assert all(i["ranks"]["vector"] is None for i in out["items"])


def test_voyage_outage_degrades_and_releases_reservation(world):
    world.sync()
    world.voyage.fail = True
    out = world.service.search("lint hook")
    assert out["degraded"] is True and out["items"]
    with world.engine.connect() as c:
        assert (
            c.execute(
                text("SELECT reserved_micros FROM ai.budget_day WHERE pool='SEARCH'")
            ).scalar()
            == 0
        )


def test_tf11_cache_hit_then_miss_after_index_version_bump(world):
    world.sync()
    world.service.search("lint hook")
    calls = (world.voyage.embed_calls, world.voyage.rerank_calls)
    world.service.search("  LINT   Hook ")  # 정규화 후 같은 키
    assert (world.voyage.embed_calls, world.voyage.rerank_calls) == calls

    world.seed(3, "HOOK", "docker-deploy", "x", "deploy docker image hook updated text")
    world.sync()  # index_version 증가 + 옛 캐시 청소
    before = world.voyage.embed_calls
    world.service.search("lint hook")
    assert world.voyage.embed_calls == before + 1  # 미스 → 질의 임베딩 다시
    with world.engine.connect() as c:
        assert (
            c.execute(text("SELECT count(*) FROM ai.search_cache WHERE index_version = 1")).scalar()
            == 0
        )


def _answer_llm(cited):
    return FakeLLM(AnswerOut(answer_ko="첫째. 둘째. 셋째. 넷째.", cited_item_ids=cited))


def test_answer_ok_truncates_to_three_sentences_and_caches(world):
    world.sync()
    world.service.llm = _answer_llm([1])
    out = world.service.answer("lint hook")
    assert (
        out["answerKo"] == "첫째. 둘째. 셋째."
        and out["citedItemIds"] == [1]
        and out["reason"] is None
    )
    world.service.answer("lint hook")
    assert world.service.llm.calls == 1  # 캐시


def test_tf10_citation_outside_top5_is_discarded(world):
    world.sync()
    world.service.llm = _answer_llm([1, 999])
    out = world.service.answer("lint hook")
    assert out == {
        "answerKo": None,
        "citedItemIds": [],
        "degraded": False,
        "reason": "CITATION_INVALID",
    }


def test_answer_budget_exhausted_and_no_results(world):
    world.sync()
    world.service.llm = _answer_llm([1])
    _zero_cap(world, "ANSWER")
    out = world.service.answer("lint hook")
    assert out["reason"] == "BUDGET_EXHAUSTED" and out["degraded"] and world.service.llm.calls == 0


def test_answer_with_no_indexed_items_is_no_results(world):
    world.service.llm = _answer_llm([1])
    assert world.service.answer("lint hook")["reason"] == "NO_RESULTS"
    assert world.service.llm.calls == 0
