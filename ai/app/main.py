"""FastAPI 진입점 — /health(공개)와 /internal/*(X-Internal-Token) 라우터."""

import logging
from contextlib import asynccontextmanager
from functools import lru_cache
from typing import Annotated

from fastapi import Depends, FastAPI, HTTPException, Request, Response
from sqlalchemy import Engine, text

from app.budget.ledger import Ledger
from app.config import Settings, get_settings
from app.db import get_engine
from app.jobs.sync import run_sync
from app.providers.claude import LLM, AnthropicLLM
from app.providers.voyage import Embedder, VoyageClient
from app.schemas import AnswerReq, SearchReq, SyncReq
from app.search.index import SearchIndex
from app.search.service import SearchService
from app.search.tokenize import get_kiwi, kiwi_loaded
from app.security import Unauthorized, require_internal_token

log = logging.getLogger(__name__)


@lru_cache
def get_index() -> SearchIndex:
    return SearchIndex()


@lru_cache
def get_llm() -> LLM:
    return AnthropicLLM(get_settings().anthropic_api_key)


@lru_cache
def get_voyage() -> Embedder:
    return VoyageClient(get_settings().voyage_api_key)


@asynccontextmanager
async def lifespan(_: FastAPI):
    get_kiwi()  # 첫 요청 지연(수 초)을 기동 시점으로 당긴다
    try:
        get_index().rebuild(get_engine())
    except Exception:  # DB 슬립·마이그레이션 전이라도 기동은 유지(/health가 상태를 보고)
        log.warning("BM25 인덱스 초기 구축 실패 — 동기화 후 재시도", exc_info=True)
    yield


_prod = get_settings().app_env == "production"
app = FastAPI(
    title="kok.gg AI",
    lifespan=lifespan,
    docs_url=None if _prod else "/docs",
    redoc_url=None,
    openapi_url=None if _prod else "/openapi.json",
)


@app.exception_handler(Unauthorized)
async def _unauthorized(_: Request, __: Unauthorized) -> Response:
    return Response(status_code=401)


@app.get("/health")
def health(
    engine: Annotated[Engine, Depends(get_engine)],
    index: Annotated[SearchIndex, Depends(get_index)],
) -> dict:
    """토큰 불필요. DB가 죽어도 200 + degraded.

    Prisma 마이그레이션 전에는 검색 쿼리만 권한 오류라 기동 실패로 보지 않는다(DATA-MODEL.md 8장).
    """
    body = {
        "indexVersion": index.version,
        "docCount": index.doc_count,
        "kiwi": "loaded" if kiwi_loaded() else "not_loaded",
    }
    try:
        with engine.connect() as conn:
            conn.execute(text("SELECT 1"))
    except Exception:
        return {"status": "degraded", "db": "down", **body}
    return {"status": "ok", "db": "ok", **body}


def get_ledger(
    engine: Annotated[Engine, Depends(get_engine)],
    settings: Annotated[Settings, Depends(get_settings)],
) -> Ledger:
    return Ledger(engine, settings)


def get_search_service(
    engine: Annotated[Engine, Depends(get_engine)],
    voyage: Annotated[Embedder, Depends(get_voyage)],
    llm: Annotated[LLM, Depends(get_llm)],
    ledger: Annotated[Ledger, Depends(get_ledger)],
    settings: Annotated[Settings, Depends(get_settings)],
    index: Annotated[SearchIndex, Depends(get_index)],
) -> SearchService:
    return SearchService(engine, voyage, llm, ledger, settings, index)


Service = Annotated[SearchService, Depends(get_search_service)]
Authed = Depends(require_internal_token)


@app.post("/internal/search", dependencies=[Authed])
def search(body: SearchReq, svc: Service) -> dict:
    """하이브리드 검색. 외부 장애·예산 소진은 degraded(BM25만)로 응답한다."""
    return svc.search(body.q, body.kind, body.level, body.limit)


@app.post("/internal/search/answer", dependencies=[Authed])
def answer(body: AnswerReq, svc: Service) -> dict:
    try:
        return svc.answer(body.q, body.kind, body.level)
    except Exception as e:
        log.exception("답변 생성 실패")
        raise HTTPException(502, "answer provider error") from e


@app.post("/internal/jobs/sync", dependencies=[Authed])
def sync(
    body: SyncReq,
    engine: Annotated[Engine, Depends(get_engine)],
    llm: Annotated[LLM, Depends(get_llm)],
    voyage: Annotated[Embedder, Depends(get_voyage)],
    ledger: Annotated[Ledger, Depends(get_ledger)],
    settings: Annotated[Settings, Depends(get_settings)],
    index: Annotated[SearchIndex, Depends(get_index)],
) -> dict:
    r = run_sync(engine, llm, voyage, ledger, settings, index, body.max_items)
    return {
        "processed": r.processed,
        "insufficient": r.insufficient,
        "failed": r.failed,
        "remaining": r.remaining,
        "budgetExhausted": r.budget_exhausted,
        "indexVersion": r.index_version,
    }
