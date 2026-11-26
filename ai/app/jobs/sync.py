"""POST /internal/jobs/sync 본체 — 바뀐 항목만 요약·임베딩·검색 문서 갱신 후 BM25 재구축.

항목 단위로 커밋하므로 중간에 죽거나 예산이 바닥나도 끝낸 만큼은 남고, 다음 실행이 이어받는다.
"""

import hashlib
import json
import logging
from dataclasses import dataclass

from sqlalchemy import Engine, text

from app.budget.ledger import BudgetExceeded, Ledger, estimate_micros
from app.config import Settings
from app.providers.claude import LLM
from app.providers.voyage import Embedder
from app.search.index import SearchIndex
from app.search.tokenize import tokenize
from app.summary.prompt import PROMPT_VERSION
from app.summary.service import summarize

log = logging.getLogger(__name__)

# 재요약 대상: 요약 없음 / 원문 해시 변경 / 프롬프트 버전 변경 / 1시간 지난 FAILED. 임베딩 없음도 포함(요약은 재사용).
PENDING_WHERE = """
  i.status = 'ACTIVE' AND (
    s.item_id IS NULL OR e.item_id IS NULL
    OR s.source_sha256 <> d.content_sha256 OR s.prompt_version <> :pv
    OR (s.status = 'FAILED' AND s.generated_at < now() - interval '1 hour'))
"""
PENDING_FROM = """
  FROM public.item_source_doc d JOIN public.item i ON i.id = d.item_id
  LEFT JOIN ai.item_summary s ON s.item_id = d.item_id
  LEFT JOIN ai.item_embedding e ON e.item_id = d.item_id
"""
EMBED_DOC_CHARS = 2000


@dataclass
class SyncResult:
    processed: int = 0
    insufficient: int = 0
    failed: int = 0
    remaining: int = 0
    budget_exhausted: bool = False
    index_version: int = 0


def _sha(s: str) -> str:
    return hashlib.sha256(s.encode()).hexdigest()


def embed_input(name: str, description: str | None, summary: str | None, doc: str) -> str:
    """임베딩·BM25 공통 입력 = 이름 + 설명 + 한국어 요약 + 원문 앞 2000자(ARCHITECTURE 8장)."""
    return "\n".join([name, description or "", summary or "", doc[:EMBED_DOC_CHARS]])


def vec_literal(v: list[float]) -> str:
    return "[" + ",".join(f"{x:.6f}" for x in v) + "]"


def _needs_summary(s, d) -> bool:
    return (
        s is None
        or s.source_sha256 != d.content_sha256
        or s.prompt_version != PROMPT_VERSION
        or (s.status == "FAILED")
    )


def run_sync(
    engine: Engine,
    llm: LLM,
    voyage: Embedder,
    ledger: Ledger,
    settings: Settings,
    index: SearchIndex,
    max_items: int,
) -> SyncResult:
    res = SyncResult()
    with engine.connect() as conn:
        pending = conn.execute(
            text(
                "SELECT d.item_id, d.content, d.content_sha256, i.name, i.description "
                f"{PENDING_FROM} WHERE {PENDING_WHERE} ORDER BY d.item_id LIMIT :n"
            ),
            {"pv": PROMPT_VERSION, "n": max_items},
        ).all()

    for d in pending:
        try:
            _process(engine, llm, voyage, ledger, settings, d, res)
        except BudgetExceeded:
            res.budget_exhausted = True
            break
        except Exception:
            log.exception("sync 실패 item_id=%s", d.item_id)
            res.failed += 1

    with engine.begin() as conn:
        if res.processed:
            res.index_version = conn.execute(
                text(
                    "INSERT INTO ai.index_meta (id, index_version, rebuilt_at) VALUES (1, 1, now()) "
                    "ON CONFLICT (id) DO UPDATE SET index_version = ai.index_meta.index_version + 1, "
                    "rebuilt_at = now() RETURNING index_version"
                )
            ).scalar_one()
            # index_version이 키에 들어가므로 옛 버전 캐시는 죽은 행 — 만료분과 함께 청소
            conn.execute(
                text("DELETE FROM ai.search_cache WHERE expires_at < now() OR index_version < :v"),
                {"v": res.index_version},
            )
        res.remaining = conn.execute(
            text(f"SELECT count(*) {PENDING_FROM} WHERE {PENDING_WHERE}"), {"pv": PROMPT_VERSION}
        ).scalar_one()
    index.rebuild(engine)
    res.index_version = index.version
    return res


def _process(engine, llm, voyage, ledger, settings, d, res: SyncResult) -> None:
    with engine.connect() as conn:
        s = conn.execute(
            text("SELECT * FROM ai.item_summary WHERE item_id = :i"), {"i": d.item_id}
        ).first()
    if _needs_summary(s, d):
        r = summarize(llm, ledger, settings, item_id=d.item_id, name=d.name, doc=d.content)
        with engine.begin() as conn:
            conn.execute(
                text(
                    "INSERT INTO ai.item_summary (item_id, source_sha256, prompt_version, model, status, "
                    "summary_ko, use_cases_ko, install_commands, requirements_ko, rejected_quote_count, "
                    "input_tokens, output_tokens, error, generated_at) VALUES (:i, :sha, :pv, :m, :st, "
                    ":sum, CAST(:uc AS jsonb), CAST(:ic AS jsonb), CAST(:rq AS jsonb), :rej, :it, :ot, "
                    ":err, now()) ON CONFLICT (item_id) DO UPDATE SET source_sha256 = EXCLUDED.source_sha256, "
                    "prompt_version = EXCLUDED.prompt_version, model = EXCLUDED.model, status = EXCLUDED.status, "
                    "summary_ko = EXCLUDED.summary_ko, use_cases_ko = EXCLUDED.use_cases_ko, "
                    "install_commands = EXCLUDED.install_commands, requirements_ko = EXCLUDED.requirements_ko, "
                    "rejected_quote_count = EXCLUDED.rejected_quote_count, input_tokens = EXCLUDED.input_tokens, "
                    "output_tokens = EXCLUDED.output_tokens, error = EXCLUDED.error, generated_at = now()"
                ),
                {
                    "i": d.item_id, "sha": d.content_sha256, "pv": PROMPT_VERSION, "m": r.model,
                    "st": r.status, "sum": r.summary_ko, "uc": _json(r.use_cases_ko),
                    "ic": _json(r.install_commands), "rq": _json(r.requirements_ko),
                    "rej": r.rejected_quote_count, "it": r.input_tokens, "ot": r.output_tokens,
                    "err": r.error,
                },
            )  # fmt: skip
        summary_ko, status = r.summary_ko, r.status
        res.insufficient += status == "INSUFFICIENT"
        # FAILED도 이름·설명으로는 검색되게 색인한다(요약만 1시간 뒤 재시도). 안 그러면 영원히 pending.
        res.failed += status == "FAILED"
    else:
        summary_ko = s.summary_ko

    text_in = embed_input(d.name, d.description, summary_ko, d.content)
    sha = _sha(text_in)
    with engine.connect() as conn:
        have = conn.execute(
            text("SELECT input_sha256 FROM ai.item_embedding WHERE item_id = :i"), {"i": d.item_id}
        ).scalar()
    vec = None
    if have != sha:
        est = estimate_micros(settings, settings.embed_model, text_in, 0)
        with ledger.reserved("SUMMARY", est) as rsv:
            vecs, tokens = voyage.embed([text_in], "document", settings.embed_model)
            ledger.settle(
                rsv, provider="voyage", model=settings.embed_model, purpose="embed_doc",
                input_tokens=tokens, item_id=d.item_id,
            )  # fmt: skip
        vec = vecs[0]
    with engine.begin() as conn:
        if vec is not None:
            conn.execute(
                text(
                    "INSERT INTO ai.item_embedding (item_id, input_sha256, model, embedding) "
                    "VALUES (:i, :sha, :m, CAST(:v AS vector)) ON CONFLICT (item_id) DO UPDATE SET "
                    "input_sha256 = EXCLUDED.input_sha256, model = EXCLUDED.model, "
                    "embedding = EXCLUDED.embedding, updated_at = now()"
                ),
                {"i": d.item_id, "sha": sha, "m": settings.embed_model, "v": vec_literal(vec)},
            )
        conn.execute(
            text(
                "INSERT INTO ai.search_doc (item_id, tokens, input_sha256) VALUES (:i, :t, :sha) "
                "ON CONFLICT (item_id) DO UPDATE SET tokens = EXCLUDED.tokens, "
                "input_sha256 = EXCLUDED.input_sha256, updated_at = now()"
            ),
            {"i": d.item_id, "t": tokenize(text_in), "sha": sha},
        )
    res.processed += 1


def _json(v) -> str:
    return json.dumps(v, ensure_ascii=False)
