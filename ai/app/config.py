"""환경변수 설정 — 시크릿은 전부 환경에서만 읽는다(.env는 커밋 금지)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # kok_ai 롤 접속(psycopg3 드라이버). ai 스키마만 쓰고 public은 3개 테이블 SELECT만 가능하다.
    ai_database_url: str = "postgresql+psycopg://kok_ai:kok_ai@localhost:5432/kok"
    internal_api_token: str = ""


@lru_cache
def get_settings() -> Settings:
    return Settings()
