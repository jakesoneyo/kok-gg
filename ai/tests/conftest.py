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
