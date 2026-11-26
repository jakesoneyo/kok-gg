"""Voyage REST 2개(임베딩·재순위) — SDK 대신 httpx(의존성 최소화, ARCHITECTURE 11장)."""

from typing import Literal, Protocol

import httpx

BASE = "https://api.voyageai.com/v1"


class Embedder(Protocol):
    def embed(
        self, texts: list[str], input_type: Literal["document", "query"], model: str
    ) -> tuple[list[list[float]], int]:
        """(벡터 목록, 사용 토큰)"""
        ...

    def rerank(
        self, query: str, documents: list[str], top_k: int, model: str
    ) -> tuple[list[tuple[int, float]], int]:
        """([(documents 인덱스, 점수)] 점수 내림차순, 사용 토큰)"""
        ...


class VoyageClient:
    def __init__(self, api_key: str, transport: httpx.BaseTransport | None = None):
        self._http = httpx.Client(
            base_url=BASE,
            headers={"Authorization": f"Bearer {api_key}"},
            timeout=30,
            transport=transport,
        )

    def _post(self, path: str, body: dict) -> dict:
        res = self._http.post(path, json=body)
        res.raise_for_status()
        return res.json()

    def embed(self, texts, input_type, model):
        data = self._post(
            "/embeddings",
            {"input": texts, "model": model, "input_type": input_type, "output_dimension": 1024},
        )
        ordered = sorted(data["data"], key=lambda d: d["index"])
        return [d["embedding"] for d in ordered], data["usage"]["total_tokens"]

    def rerank(self, query, documents, top_k, model):
        data = self._post(
            "/rerank", {"query": query, "documents": documents, "model": model, "top_k": top_k}
        )
        return [(d["index"], d["relevance_score"]) for d in data["data"]], data["usage"][
            "total_tokens"
        ]
