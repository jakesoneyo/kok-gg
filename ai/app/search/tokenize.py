"""Kiwi 형태소 토큰화 — BM25 인덱스와 질의가 같은 함수를 써야 토큰이 맞물린다.

메모리: 기본 설정은 RSS ≈ 516MB, 타이포·다중어 사전을 끄면 ≈ 398MB(ai/README 표). 후자로 고정한다.
"""

import unicodedata
from functools import lru_cache

# 명사·동사·형용사·외국어·숫자·어근. VV/VA는 Kiwi가 어간(원형)을 돌려준다.
KEEP_TAGS = {"NNG", "NNP", "VV", "VA", "SL", "SN", "XR"}
# 의미 없는 1글자 용언 어간("하다"·"있다"…)은 BM25 잡음이라 제거
STOP_VERBS = {"하", "있", "되", "않", "이"}


@lru_cache
def get_kiwi():
    from kiwipiepy import Kiwi

    return Kiwi(num_workers=1, load_typo_dict=False, load_multi_dict=False)


def kiwi_loaded() -> bool:
    return get_kiwi.cache_info().currsize > 0


def tokenize(text: str) -> list[str]:
    text = unicodedata.normalize("NFKC", text)
    return [
        t.form.lower()
        for t in get_kiwi().tokenize(text)
        if t.tag in KEEP_TAGS and not (t.tag in ("VV", "VA") and t.form in STOP_VERBS)
    ]
