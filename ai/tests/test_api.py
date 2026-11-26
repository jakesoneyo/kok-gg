"""TF-12(내부 토큰) + 엔드포인트 연결 + Voyage REST 클라이언트(httpx mock) + 운영 /docs 비활성."""

import httpx
import pytest
from fastapi.testclient import TestClient

from app.config import Settings, get_settings
from app.db import get_engine
from app.main import app, get_index, get_llm, get_voyage
from app.providers.voyage import VoyageClient

TOKEN = "s3cret"


@pytest.fixture
def client(world):
    app.dependency_overrides.update(
        {
            get_engine: lambda: world.engine,
            get_llm: lambda: world.llm,
            get_voyage: lambda: world.voyage,
            get_index: lambda: world.index,
            get_settings: lambda: Settings(
                internal_api_token=TOKEN, daily_ai_budget_usd=1.0, ai_budget_split="50/25/25"
            ),
        }
    )
    yield TestClient(app)
    app.dependency_overrides.clear()


@pytest.mark.parametrize("headers", [{}, {"X-Internal-Token": "wrong"}, {"X-Internal-Token": ""}])
@pytest.mark.parametrize(
    ("path", "body"),
    [
        ("/internal/search", {"q": "lint"}),
        ("/internal/search/answer", {"q": "lint"}),
        ("/internal/jobs/sync", {}),
    ],
)
def test_tf12_missing_or_wrong_token_is_401_without_body(client, path, headers, body):
    res = client.post(path, json=body, headers=headers)
    assert res.status_code == 401 and res.content == b""


def test_empty_server_token_rejects_everything(client):
    app.dependency_overrides[get_settings] = lambda: Settings(internal_api_token="")
    assert (
        client.post(
            "/internal/search", json={"q": "x"}, headers={"X-Internal-Token": ""}
        ).status_code
        == 401
    )


def test_sync_then_search_over_http(client):
    h = {"X-Internal-Token": TOKEN}
    sync = client.post("/internal/jobs/sync", json={"maxItems": 50}, headers=h).json()
    assert sync["processed"] == 4 and sync["remaining"] == 0 and sync["budgetExhausted"] is False
    res = client.post("/internal/search", json={"q": "lint hook", "kind": "HOOK"}, headers=h)
    assert res.status_code == 200
    body = res.json()
    assert body["items"][0]["itemId"] == 1 and body["indexVersion"] == sync["indexVersion"]


@pytest.mark.parametrize(
    "body",
    [
        {"q": "  "},
        {"q": "x" * 201},
        {"q": "x", "limit": 11},
        {"q": "x", "kind": "NOPE"},
        {"q": "x", "z": 1},
    ],
)
def test_search_validation_422(client, body):
    assert (
        client.post("/internal/search", json=body, headers={"X-Internal-Token": TOKEN}).status_code
        == 422
    )


def test_voyage_client_parses_rest_responses():
    def handler(req: httpx.Request) -> httpx.Response:
        assert req.headers["authorization"] == "Bearer k"
        if req.url.path == "/v1/embeddings":
            return httpx.Response(200, json={
                "data": [{"index": 1, "embedding": [2.0]}, {"index": 0, "embedding": [1.0]}],
                "usage": {"total_tokens": 7}})  # fmt: skip
        return httpx.Response(200, json={
            "data": [{"index": 2, "relevance_score": 0.9}], "usage": {"total_tokens": 3}})  # fmt: skip

    v = VoyageClient("k", transport=httpx.MockTransport(handler))
    assert v.embed(["a", "b"], "document", "voyage-4") == ([[1.0], [2.0]], 7)
    assert v.rerank("q", ["a", "b", "c"], 1, "rerank-3-lite") == ([(2, 0.9)], 3)


def test_docs_disabled_in_production(monkeypatch):
    import importlib

    import app.main as main

    monkeypatch.setenv("APP_ENV", "production")
    get_settings.cache_clear()
    try:
        prod = importlib.reload(main)
        res = TestClient(prod.app).get("/docs")
        assert res.status_code == 404
    finally:
        monkeypatch.delenv("APP_ENV")
        get_settings.cache_clear()
        importlib.reload(main)
