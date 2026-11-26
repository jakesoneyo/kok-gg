"""GET /health 계약(API.md 7장): DB가 죽어도 기동·응답은 유지하고 상태만 보고한다."""

from fastapi.testclient import TestClient
from sqlalchemy import create_engine

from app.db import get_engine
from app.main import app


def test_health_db_ok():
    app.dependency_overrides[get_engine] = lambda: create_engine("sqlite://")
    try:
        res = TestClient(app).get("/health")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    body = res.json()
    assert (body["status"], body["db"]) == ("ok", "ok")
    assert {"indexVersion", "docCount", "kiwi"} <= body.keys()


def test_health_db_down_is_degraded_not_error():
    # 닫힌 포트 — Prisma 마이그레이션 전/DB 슬립 중에도 서비스가 죽지 않아야 한다.
    app.dependency_overrides[get_engine] = lambda: create_engine(
        "postgresql+psycopg://x:x@127.0.0.1:1/x", connect_args={"connect_timeout": 1}
    )
    try:
        res = TestClient(app).get("/health")
    finally:
        app.dependency_overrides.clear()
    assert res.status_code == 200
    body = res.json()
    assert (body["status"], body["db"]) == ("degraded", "down")
