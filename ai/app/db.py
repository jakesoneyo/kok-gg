"""SQLAlchemy 엔진 — 요청마다 만들지 않고 프로세스당 1개(풀)."""

from functools import lru_cache

from sqlalchemy import Engine, create_engine

from app.config import get_settings


@lru_cache
def get_engine() -> Engine:
    # pool_pre_ping: Neon이 5분 무활동에 정지하면 끊긴 커넥션을 첫 쿼리 전에 걸러낸다.
    return create_engine(
        get_settings().ai_database_url, pool_pre_ping=True, connect_args={"connect_timeout": 5}
    )
