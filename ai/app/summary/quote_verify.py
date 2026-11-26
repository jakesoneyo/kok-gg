"""설치 명령 인용 검증 — 환각 방어의 핵심(ARCHITECTURE 7장)."""

import re

_CODE_SPAN = re.compile(r"`([^`\n]+)`")


def _fold(s: str) -> str:
    return re.sub(r"\s+", " ", s).strip()


def verify_quote(cmd: str, doc: str) -> bool:
    """원문의 한 줄 전체 또는 코드 스팬 전체와 같을 때만 통과(공백 연속은 1칸으로 접어 비교).

    부분 문자열은 탈락시킨다 — `curl x | sh`에서 `curl x`만 인용하면 위험한 꼬리가 잘려
    경고 없이 노출되기 때문. 따옴표 교체·버전 추정 같은 변형도 의도적으로 전부 탈락.
    """
    cmd = _fold(cmd)
    if not cmd:
        return False
    candidates = {_fold(line) for line in doc.splitlines()}
    candidates |= {_fold(m) for m in _CODE_SPAN.findall(doc)}
    return cmd in candidates
