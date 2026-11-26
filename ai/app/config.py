"""환경변수 설정 — 시크릿은 전부 환경에서만 읽는다(.env는 커밋 금지)."""

from functools import lru_cache

from pydantic_settings import BaseSettings, SettingsConfigDict


class Settings(BaseSettings):
    model_config = SettingsConfigDict(env_file=".env", extra="ignore")

    # kok_ai 롤 접속(psycopg3 드라이버). ai 스키마만 쓰고 public은 3개 테이블 SELECT만 가능하다.
    ai_database_url: str = "postgresql+psycopg://kok_ai:kok_ai@localhost:5432/kok"
    internal_api_token: str = ""
    app_env: str = "development"  # production이면 /docs 비활성

    anthropic_api_key: str = ""
    voyage_api_key: str = ""
    # 기본값은 PLAN C7 평가 결과로 확정(잠정 haiku). 답변도 같은 모델을 기본으로 쓴다.
    summary_model: str = "claude-haiku-5-5"
    answer_model: str = "claude-haiku-5-5"
    embed_model: str = "voyage-4"
    rerank_model: str = "rerank-3-lite"

    daily_ai_budget_usd: float = 1.0
    ai_budget_split: str = "60/20/20"  # SUMMARY/SEARCH/ANSWER
    # 모델 -> [입력, 출력] USD per MTok. [미검증: 실제 적용 단가] 보수적으로 높게 잡아 fail-closed.
    model_prices: dict[str, tuple[float, float]] = {
        "claude-haiku-5-5": (1.0, 5.0),
        "claude-sonnet-5-5": (3.0, 15.0),
        "voyage-4": (0.1, 0.0),
        "rerank-3-lite": (0.1, 0.0),
    }


@lru_cache
def get_settings() -> Settings:
    return Settings()
