"""FastAPI 진입점 — 검색·요약·예산 원장(C3에서 라우터 추가)."""

from typing import Annotated

from fastapi import Depends, FastAPI
from sqlalchemy import Engine, text

from app.db import get_engine

app = FastAPI(title="kok.gg AI")


@app.get("/health")
def health(engine: Annotated[Engine, Depends(get_engine)]) -> dict[str, str]:
    """토큰 불필요. DB가 죽어도 200 + degraded.

    Prisma 마이그레이션 전에는 검색 쿼리만 권한 오류라 기동 실패로 보지 않는다(DATA-MODEL.md 8장).
    """
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return {"status": "degraded", "db": "down"}
    return {"status": "ok", "db": "ok"}
