"""Reciprocal Rank Fusion — score(d) = Σ 1/(k + rank). 서로 다른 척도의 점수를 순위로만 합친다."""


def rrf(rankings: list[list[int]], k: int = 60) -> list[tuple[int, float]]:
    """각 목록은 1위부터 정렬된 id. 점수 내림차순(동점은 id 오름차순)."""
    scores: dict[int, float] = {}
    for ranking in rankings:
        for rank, i in enumerate(ranking, start=1):
            scores[i] = scores.get(i, 0.0) + 1 / (k + rank)
    return sorted(scores.items(), key=lambda x: (-x[1], x[0]))
