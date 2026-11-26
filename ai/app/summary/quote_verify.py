"""설치 명령 인용 검증 — 환각 방어의 핵심(ARCHITECTURE 7장)."""

import re


def _fold(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def verify_quote(cmd: str, doc: str) -> bool:
    """원문의 부분 문자열(공백 연속은 1칸으로 접어 비교)일 때만 통과.

    따옴표 교체·버전 추정 같은 변형은 의도적으로 전부 탈락 — 모델이 만든 명령은 신뢰하지 않는다.
    """
    cmd = cmd.strip()
    return bool(cmd) and (cmd in doc or _fold(cmd) in _fold(doc))
