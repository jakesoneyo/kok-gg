"""내부 API 요청 스키마(API.md 7장). NestJS Zod 제약과 같게 유지한다."""

from typing import Annotated, Literal

from pydantic import BaseModel, Field, StringConstraints

Query = Annotated[str, StringConstraints(strip_whitespace=True, min_length=1, max_length=200)]
Kind = Literal["PLUGIN", "SKILL", "HOOK"]
Level = Literal["SAFE", "CAUTION", "DANGER"]


class SearchReq(BaseModel, extra="forbid"):
    q: Query
    kind: Kind | None = None
    level: Level | None = None
    limit: int = Field(10, ge=1, le=10)


class AnswerReq(BaseModel, extra="forbid"):
    q: Query
    kind: Kind | None = None
    level: Level | None = None


class SyncReq(BaseModel, extra="forbid"):
    max_items: int = Field(20, ge=1, le=50, alias="maxItems")
