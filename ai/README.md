# kok.gg AI (FastAPI)

요약(인용 검증) · 하이브리드 검색(Kiwi BM25 + pgvector → RRF → 재순위) · 일일 예산 원장. `ai` 스키마의 유일한 쓰기 주체.

```
pip install -e ".[dev]" && pytest      # Docker 필요(Testcontainers pgvector). 외부 API 호출 없음(가짜 제공자)
```

## Kiwi 메모리 측정 (ARCHITECTURE 11장 [미검증] 해소)

`kiwipiepy 0.25.1`, `python:3.12-slim` 컨테이너, `num_workers=1`, 토큰화 100~200회 후 VmRSS/VmHWM.

| 설정 | RSS | 비고 |
| --- | --- | --- |
| 기본(`cong` 모델 + 타이포/다중어 사전) | 514MB (HWM 524MB) | 400MB 목표 초과 |
| `load_typo_dict=False, load_multi_dict=False` | **313MB** (Kiwi만) | 채택 |
| 위 설정 + FastAPI/SQLAlchemy 앱 전체 | **328MB** (HWM 336MB) | 컨테이너 기동·토큰화 후 |

- 설치된 모델은 `cong`뿐이다(`knlm`/`sbg`는 `kiwipiepy-model 0.25`에 없음). macOS 호스트 측정은 Linux보다 100~200MB 크게 나와 판단 근거로 쓰지 않는다.
- 이미지에 torch 없음. `numpy`는 kiwipiepy의 전이 의존성이다.

## 외부 API 키 없이 동작하는 범위

Anthropic·Voyage는 `app/providers/`의 얇은 인터페이스 뒤에 있고 테스트는 `tests/fakes.py`의 결정적 가짜만 쓴다.
키가 없으면 요약은 `FAILED`로 남고(1시간 뒤 재시도) 검색은 BM25만으로 `degraded: true` 응답한다.
