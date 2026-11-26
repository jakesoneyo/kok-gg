"""테스트 공통 픽스처 — 실제 pgvector Postgres(Testcontainers) + 외부 API 가짜.

bootstrap.sql(롤·스키마·확장)과 Alembic 0001을 운영과 같은 경로로 적용한다.
public 테이블은 Prisma 소유라 여기서는 FastAPI가 읽는 컬럼만 가진 최소판을 만든다.
"""

from pathlib import Path

import pytest
from alembic.config import Config
from sqlalchemy import create_engine, text
from testcontainers.community.postgres import PostgresContainer

from alembic import command

BOOTSTRAP = Path(__file__).resolve().parents[2] / "infra/db/bootstrap.sql"

PUBLIC_DDL = """
CREATE TABLE public.item (
  id integer PRIMARY KEY, kind text NOT NULL, name text NOT NULL, description text,
  status text NOT NULL DEFAULT 'ACTIVE', current_level text
);
CREATE TABLE public.item_source_doc (
  item_id integer PRIMARY KEY, path text NOT NULL, content text NOT NULL,
  content_sha256 char(64) NOT NULL
);
GRANT SELECT ON public.item, public.item_source_doc TO kok_ai;
"""


@pytest.fixture(scope="session")
def ai_url():
    with PostgresContainer(
        "pgvector/pgvector:pg17", username="postgres", password="pg", dbname="kok"
    ) as pg:
        pg.get_wrapped_container().exec_run(["mkdir", "-p", "/bootstrap"])
        sql = BOOTSTRAP.read_text()
        pg.exec(
            [
                "sh",
                "-c",
                f"cat > /bootstrap/b.sql <<'EOSQL'\n{sql}\nEOSQL\n"
                "psql -v ON_ERROR_STOP=1 -v app_password=a -v ai_password=ai "
                "-U postgres -d kok -f /bootstrap/b.sql",
            ]
        )
        host, port = pg.get_container_host_ip(), pg.get_exposed_port(5432)
        admin = create_engine(f"postgresql+psycopg://postgres:pg@{host}:{port}/kok")
        with admin.begin() as c:
            c.execute(text(PUBLIC_DDL))
        url = f"postgresql+psycopg://kok_ai:ai@{host}:{port}/kok"
        cfg = Config(str(Path(__file__).resolve().parents[1] / "alembic.ini"))
        cfg.set_main_option("script_location", str(Path(__file__).resolve().parents[1] / "alembic"))
        import os

        os.environ["AI_DATABASE_URL"] = url
        from app.config import get_settings

        get_settings.cache_clear()
        command.upgrade(cfg, "head")
        yield url, f"postgresql+psycopg://postgres:pg@{host}:{port}/kok"


@pytest.fixture
def engine(ai_url):
    url, admin_url = ai_url
    eng = create_engine(url, pool_size=20)
    admin = create_engine(admin_url)
    with admin.begin() as c:
        c.execute(
            text(
                "TRUNCATE ai.item_summary, ai.item_embedding, ai.search_doc, ai.search_cache, "
                "ai.budget_day, ai.usage_ledger, public.item, public.item_source_doc;"
                "DELETE FROM ai.index_meta"
            )
        )
    yield eng
    eng.dispose()
    admin.dispose()


@pytest.fixture
def admin_engine(ai_url):
    eng = create_engine(ai_url[1])
    yield eng
    eng.dispose()


@pytest.fixture
def world(engine, admin_engine):
    """항목 4개를 심고 동기화까지 돌린 검색 환경. 가짜 제공자의 호출 횟수를 노출한다."""
    from types import SimpleNamespace

    from app.budget.ledger import Ledger
    from app.config import Settings
    from app.search.index import SearchIndex
    from app.search.service import SearchService
    from app.summary.service import SummaryOut
    from tests.fakes import FakeLLM, FakeVoyage

    settings = Settings(daily_ai_budget_usd=1.0, ai_budget_split="50/25/25")
    llm = FakeLLM(
        lambda user: SummaryOut(
            summary_ko=f"요약: {user.split(chr(10))[0]}",
            use_cases_ko=[], install_commands=[], requirements_ko=[],
        )
    )  # fmt: skip
    voyage, ledger, index = FakeVoyage(), Ledger(engine, settings), SearchIndex()
    w = SimpleNamespace(
        engine=engine, admin=admin_engine, settings=settings, llm=llm, voyage=voyage,
        ledger=ledger, index=index,
    )  # fmt: skip
    w.service = SearchService(engine, voyage, llm, ledger, settings, index)

    def seed(item_id, kind, name, desc, body, level="SAFE", filler=True):
        import hashlib

        content = body + (" filler" * 80 if filler else "")
        with admin_engine.begin() as c:
            c.execute(
                text(
                    "INSERT INTO public.item (id, kind, name, description, current_level) "
                    "VALUES (:i, :k, :n, :d, :l) ON CONFLICT (id) DO NOTHING"
                ),
                {"i": item_id, "k": kind, "n": name, "d": desc, "l": level},
            )
            c.execute(
                text(
                    "INSERT INTO public.item_source_doc (item_id, path, content, content_sha256) "
                    "VALUES (:i, 'README.md', :c, :h) ON CONFLICT (item_id) DO UPDATE SET "
                    "content = EXCLUDED.content, content_sha256 = EXCLUDED.content_sha256"
                ),
                {"i": item_id, "c": content, "h": hashlib.sha256(content.encode()).hexdigest()},
            )

    def sync(n=50):
        from app.jobs.sync import run_sync

        return run_sync(engine, llm, voyage, ledger, settings, index, n)

    w.seed, w.sync = seed, sync
    seed(
        1,
        "HOOK",
        "lint-before-pr",
        "PR 전에 lint를 돌리는 hook",
        "run lint hook before pull request",
    )
    seed(2, "SKILL", "lint-skill", "코드 lint 스킬", "lint skill formats code style")
    seed(3, "HOOK", "docker-deploy", "도커 배포 hook", "deploy docker image hook")
    seed(4, "PLUGIN", "image-gen", "이미지 생성 플러그인", "generate images with diffusion")
    return w
