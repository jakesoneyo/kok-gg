"""결정적 가짜 외부 제공자 — 테스트·CI는 절대 실제 API를 부르지 않는다."""

import hashlib
import re
import threading

from app.providers.claude import LLMResult


class FakeLLM:
    """`outputs`를 순서대로(마지막 값 반복) 돌려주고 호출 횟수를 센다."""

    def __init__(self, *outputs, fail: Exception | None = None):
        self.outputs = list(outputs)
        self.fail = fail
        self.calls = 0
        self.last_user = ""
        self._lock = threading.Lock()

    def parse(self, *, model, system, user, schema, max_tokens):
        with self._lock:
            self.calls += 1
            n = self.calls
        self.last_user = user
        if self.fail:
            raise self.fail
        out = self.outputs[min(n, len(self.outputs)) - 1]
        return LLMResult(out, 100, 50)


def _vec(text: str) -> list[float]:
    """단어 해시 bag → 1024차원 단위벡터. 단어가 겹치면 코사인이 높아지는 결정적 근사."""
    v = [0.0] * 1024
    for w in re.findall(r"\w+", text.lower()):
        v[int(hashlib.md5(w.encode()).hexdigest(), 16) % 1024] += 1.0
    norm = sum(x * x for x in v) ** 0.5 or 1.0
    return [x / norm for x in v]


class FakeVoyage:
    def __init__(self, fail: bool = False):
        self.embed_calls = 0
        self.rerank_calls = 0
        self.fail = fail

    def embed(self, texts, input_type, model):
        self.embed_calls += 1
        if self.fail:
            raise RuntimeError("voyage down")
        return [_vec(t) for t in texts], sum(len(t) for t in texts) // 3

    def rerank(self, query, documents, top_k, model):
        self.rerank_calls += 1
        if self.fail:
            raise RuntimeError("voyage down")
        q = set(re.findall(r"\w+", query.lower()))
        scored = [
            (i, len(q & set(re.findall(r"\w+", d.lower()))) / (len(q) or 1))
            for i, d in enumerate(documents)
        ]
        scored.sort(key=lambda x: (-x[1], x[0]))
        return scored[:top_k], 10
