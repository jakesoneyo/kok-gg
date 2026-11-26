"""TF-6(BM25)·TF-7(RRF)·TF-8(Kiwi 토큰화) — DB 없이 도는 순수 로직."""

import math

from app.search.bm25 import BM25Index
from app.search.rrf import rrf
from app.search.tokenize import tokenize


def test_tf6_bm25_fixed_corpus_ranking():
    idx = BM25Index(
        {
            1: ["lint", "hook", "pr"],
            2: ["lint", "lint", "lint", "style", "format", "check", "run"],  # 길지만 tf 높음
            3: ["deploy", "docker"],
            4: ["hook", "deploy"],
        }
    )
    got = idx.search(["lint", "hook"], limit=10)
    assert [i for i, _ in got] == [1, 2, 4]  # 3은 매칭 없음 제외
    assert [i for i, _ in idx.search(["lint"], 10)] == [2, 1]  # tf 포화 곡선: 3회 > 1회


def test_bm25_score_matches_hand_calc():
    idx = BM25Index({1: ["a", "b"], 2: ["b"]})
    # N=2, df(a)=1 → idf=ln(1+1.5/1.5)=ln2; tf=1, dl=2, avgdl=1.5
    norm = 1 - 0.75 + 0.75 * 2 / 1.5
    want = math.log(2) * 1 * 2.2 / (1 + 1.2 * norm)
    assert math.isclose(idx.search(["a"], 5)[0][1], want)


def test_bm25_respects_allowed_filter():
    idx = BM25Index({1: ["x"], 2: ["x"]})
    assert [i for i, _ in idx.search(["x"], 5, allowed={2})] == [2]


def test_tf7_rrf_hand_calculated():
    out = dict(rrf([[10, 20, 30], [20, 10, 40]]))
    assert math.isclose(out[10], 1 / 61 + 1 / 62)
    assert math.isclose(out[20], 1 / 62 + 1 / 61)
    assert math.isclose(out[30], 1 / 63) and math.isclose(out[40], 1 / 63)
    assert [i for i, _ in rrf([[1, 2], [2, 3]])][0] == 2  # 두 목록에 모두 있는 항목이 1위


def test_tf8_kiwi_tokens_for_korean_query():
    toks = tokenize("PR 올리기 전에 lint 돌려주는 hook")
    for want in ("pr", "올리", "lint", "hook"):
        assert want in toks, toks
    assert "에" not in toks  # 조사는 걸러진다
