"""요약 입력 전처리 — 배지·HTML·링크 URL을 걷어 토큰을 아끼고, 본문 길이로 정보 부족을 판정한다."""

import re

MIN_BODY_CHARS = 300  # SPEC F5: 이보다 짧으면 LLM 호출 없이 INSUFFICIENT

_BADGE = re.compile(r"\[?!\[[^\]]*\]\([^)]*\)\]?(\([^)]*\))?")  # ![alt](img) 및 [![alt](img)](link)
_LINK = re.compile(r"\[([^\]]*)\]\([^)]*\)")
_HTML = re.compile(r"<[^>]+>")
_HEADING = re.compile(r"^\s*#{1,6}\s.*$", re.MULTILINE)


def clean(doc: str) -> str:
    """LLM에 보낼 텍스트. 헤딩은 구조 단서라 남긴다."""
    text = _BADGE.sub("", doc)
    text = _LINK.sub(r"\1", text)
    return _HTML.sub("", text)


def body_length(cleaned: str) -> int:
    """헤딩 줄을 뺀 본문의 공백 접힌 길이."""
    return len(" ".join(_HEADING.sub("", cleaned).split()))
