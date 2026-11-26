"""내부 API 인증 — NestJS·배치만 호출하므로 공유 토큰을 상수 시간 비교한다."""

import hmac
from typing import Annotated

from fastapi import Depends, Header

from app.config import Settings, get_settings


class Unauthorized(Exception):
    """main.py가 본문 없는 401로 변환한다(API.md 7장)."""


def require_internal_token(
    settings: Annotated[Settings, Depends(get_settings)],
    x_internal_token: Annotated[str | None, Header()] = None,
) -> None:
    # 서버 토큰이 비어 있으면 전부 거부(fail-closed): 설정 누락이 무인증 개방이 되면 안 된다.
    if not settings.internal_api_token or not x_internal_token:
        raise Unauthorized
    if not hmac.compare_digest(x_internal_token.encode(), settings.internal_api_token.encode()):
        raise Unauthorized
