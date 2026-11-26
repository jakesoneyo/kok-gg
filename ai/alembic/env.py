"""Alembic 환경 — `ai` 스키마만 소유한다.

- 버전 테이블은 `ai.alembic_version`: public(Prisma)과 두 도구가 서로의 이력을 건드리지 않게 한다.
- `include_object`: 자동 생성(autogenerate)이 public 테이블을 보고 DROP을 제안하지 못하게 ai만 비교.
- 오프라인(`--sql`) 모드는 `backend/test/fixtures/ai-contract.sql` 생성에 쓰인다
  (Nest 통합 테스트용, 손으로 복사 금지).
"""

from sqlalchemy import create_engine

from alembic import context
from app.config import get_settings

target_metadata = None  # 0001은 의도 SQL 그대로(뷰·HNSW·CHECK는 ORM 메타데이터로 표현 불가)


def include_object(obj, name, type_, reflected, compare_to):
    if type_ == "table":
        return obj.schema == "ai"
    return True


_common = {
    "target_metadata": target_metadata,
    "version_table_schema": "ai",
    "include_schemas": True,
    "include_object": include_object,
}


def run_migrations_offline() -> None:
    # URL은 방언 결정용일 뿐 연결하지 않는다.
    context.configure(
        url=get_settings().ai_database_url,
        literal_binds=True,
        dialect_opts={"paramstyle": "named"},
        **_common,
    )
    with context.begin_transaction():
        context.run_migrations()


def run_migrations_online() -> None:
    engine = create_engine(get_settings().ai_database_url)
    with engine.connect() as connection:
        context.configure(connection=connection, **_common)
        with context.begin_transaction():
            context.run_migrations()


if context.is_offline_mode():
    run_migrations_offline()
else:
    run_migrations_online()
