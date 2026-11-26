"""순수 Python BM25(Okapi, k1=1.2, b=0.75) — 코퍼스 ≤ 2만 문서라 인메모리로 충분."""

import math
from collections import Counter

K1, B = 1.2, 0.75


class BM25Index:
    def __init__(self, docs: dict[int, list[str]]):
        self.tf = {i: Counter(toks) for i, toks in docs.items()}
        self.len = {i: len(toks) for i, toks in docs.items()}
        self.avgdl = (sum(self.len.values()) / len(docs)) if docs else 0.0
        df: Counter[str] = Counter()
        for c in self.tf.values():
            df.update(c.keys())
        n = len(docs)
        # 음수가 되지 않는 Lucene 방식 IDF
        self.idf = {t: math.log(1 + (n - d + 0.5) / (d + 0.5)) for t, d in df.items()}
        self.postings: dict[str, list[int]] = {}
        for i, c in self.tf.items():
            for t in c:
                self.postings.setdefault(t, []).append(i)

    def __len__(self) -> int:
        return len(self.tf)

    def search(
        self, query: list[str], limit: int, allowed: set[int] | None = None
    ) -> list[tuple[int, float]]:
        """(item_id, 점수) 내림차순. 점수 0(매칭 없음)은 제외, 동점은 id 오름차순으로 결정적."""
        scores: dict[int, float] = {}
        for t in set(query):
            idf = self.idf.get(t)
            if idf is None:
                continue
            for i in self.postings[t]:
                if allowed is not None and i not in allowed:
                    continue
                f = self.tf[i][t]
                norm = 1 - B + B * self.len[i] / self.avgdl
                scores[i] = scores.get(i, 0.0) + idf * f * (K1 + 1) / (f + K1 * norm)
        return sorted(scores.items(), key=lambda x: (-x[1], x[0]))[:limit]
