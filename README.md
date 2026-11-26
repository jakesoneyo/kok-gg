# kok.gg (콕지지)

> Claude Code 플러그인·스킬·훅의 **한국어 우선 데일리 트렌드 사이트** — 스타 증가 속도로 "요즘 뜨는 것"을 콕 집고, 설치 전에 위험 신호를 보여주고, 한국어로 요약하고, 자연어로 찾아 준다. · **유형**: 데이터/알고리즘(주) + 외부 API 연동(부) · **난이도**: L

[![CI](https://github.com/jakesoneyo/kok-gg/actions/workflows/ci.yml/badge.svg)](https://github.com/jakesoneyo/kok-gg/actions)

**라이브**: `<Vercel URL>` ｜ **API 문서(Swagger)**: `<backend URL>/api/docs` ｜ 설계 문서: [SPEC](./SPEC.md) · [ARCHITECTURE](./ARCHITECTURE.md) · [API](./API.md) · [DATA-MODEL](./DATA-MODEL.md) ｜ 배포: [docs/DEPLOY.md](./docs/DEPLOY.md)

> 무료 티어라 첫 접속은 서버가 깨어나는 데 ~1분 걸릴 수 있습니다(Render 슬립).

## 데모 로그인

로그인 화면의 **`회원가입 없이 둘러보기`** 버튼 한 번이면 데모 관리자(`admin` / `admin`)로 들어가 북마크·관리자 대시보드까지 채워진 화면을 봅니다. 회원가입 없이 체험해 볼 수 있습니다.
운영 환경에서는 데모 관리자의 **관리자 변경 API만 403**(`DEMO_READ_ONLY`)이고, 열람과 북마크는 정상 동작합니다.

## 스크린샷 / 데모

<!-- TODO: 라이브 배포 후 캡처 -->

| 트렌딩 | 항목 상세 · 위험 신호 | 자연어 검색 |
| :----: | :-------------------: | :---------: |
| `docs/img/trending.png` | `docs/img/detail.png` | `docs/img/search.png` |

데모 GIF: `docs/img/demo.gif` _(자리표시자)_

## 무엇이 다른가 — 4가지 차별점

| # | 차별점 | 핵심 구현 |
| - | ------ | --------- |
| 1 | **진짜 트렌딩** — 총 스타가 아니라 일일 증가량 | 규모 보정·가속도·급등 보정 점수, 순수 함수 + 표 기반 단위 테스트 |
| 2 | **위험 신호 배지** — 훅이 내 셸에서 뭘 하는지 설치 전에 | LLM 없는 결정적 규칙 엔진 16개, 모든 근거에 `file:line` + GitHub 퍼머링크 |
| 3 | **한국어 사용 요약** | 설치 명령은 원문 부분 문자열로 서버가 검증한 것만 노출, 빈약한 원문은 "정보 부족" |
| 4 | **"이런 거 있어?" 자연어 검색** | Kiwi 형태소 BM25 + Voyage 임베딩(pgvector) → RRF → 재순위 → 근거 인용 답변 |

기타: 카탈로그(정렬 4종 × 종류 × 등급, keyset 커서) · 북마크 + **보안 등급 변경 탭** · 관리자 콘솔(수동 수집·Override·데이터 품질·AI 예산) · 오탐 이의 제기(GitHub Issue 양식 → Override).

## 기술 스택

- **프론트**: Vite · React 19 · TypeScript · Tailwind v4 · Zustand · TanStack Query · Recharts · Zod
- **백엔드**: NestJS 11 · Prisma 7 · Passport-JWT · Swagger · Throttler · Pino
- **AI 서비스**: FastAPI · SQLAlchemy + Alembic · pgvector · Kiwi(kiwipiepy) · Voyage(embed·rerank) · Claude(요약·답변)
- **DB**: Neon Postgres 1개(스키마 `public` = Prisma, `ai` = Alembic)
- **테스트/CI**: Jest + supertest + Testcontainers(pgvector) · pytest + testcontainers · Vitest · GitHub Actions
- **배포(Phase 1)**: Vercel(SPA) · Render Docker 2개(backend, ai) · GitHub Actions 크론(수집 배치) · GHCR

## 아키텍처

```mermaid
flowchart LR
  U([방문자]) --> SPA["Vercel<br/>Vite SPA"]
  SPA -->|"HTTPS /api"| NEST

  subgraph R["Render (Docker, 무료)"]
    NEST["NestJS + Prisma<br/>인증 · 카탈로그 · 트렌딩 · 북마크 · 관리자<br/>보안 규칙 엔진 · 점수 함수(순수)"]
    AI["FastAPI<br/>검색(BM25+벡터+RRF+재순위) · 요약 · 예산 원장"]
  end

  NEST <-->|"X-Internal-Token<br/>(내부 API)"| AI

  subgraph NEON["Neon Postgres (DB 1개)"]
    PUB[("public 스키마<br/>Prisma 소유 · kok_app만 쓰기")]
    AIS[("ai 스키마 + pgvector<br/>Alembic 소유 · kok_ai만 쓰기")]
  end

  NEST -->|kok_app| PUB
  AI -->|"kok_ai (ai 쓰기 / public 3개 테이블 SELECT)"| AIS
  NEST -.->|"계약 뷰 SELECT만"| AIS

  AI --> VOY["Voyage AI<br/>embed · rerank"]
  AI --> CL["Claude API<br/>요약 · 답변"]

  GA["GitHub Actions<br/>cron 18:00 UTC + 수동 dispatch"] -->|"batch 컨테이너<br/>(backend 이미지, GHCR)"| BATCH["node dist/cli.js ingest"]
  BATCH -->|"REST·GraphQL·Search<br/>Star History"| GH["GitHub API"]
  BATCH -->|kok_app| PUB
  BATCH -->|"X-Internal-Token<br/>AI 동기화"| AI
  NEST -.->|"관리자 수동 실행<br/>workflow_dispatch"| GA
```

> **Phase 2 (계획)**: 공개 런칭 전 AWS 이전 — Lightsail(compose + Caddy) + ECS Fargate 예약 배치(NAT 없음) + Cloudflare. 환경변수만 바꿔 옮기도록 설계했고 Terraform·OIDC 배포 계획은 [ARCHITECTURE 12.3](./ARCHITECTURE.md), 이전 전후 측정표는 이전 후 이 README에 추가합니다.

## 트렌드 점수

저장소 단위, 기간 `w ∈ {1, 7, 30}`일. `G` = 기간 증가량, `Gp` = 직전 같은 길이 기간 증가량, `S0` = 기간 시작 스타.

```
N     = G / ( w · √(S0 + 100) )                    # 규모 보정 일평균 속도
A     = clamp( (G + 3) / (max(Gp,0) + 3), 0.5, 4 ) # 평활 가속도 (신규 저장소·데이터 공백이면 1)
pen   = 1 − 0.6 · (c − 0.6) / 0.4   (c > 0.6)      # c = 최대 일 증가량 / G, 급등 집중 감점 (7·30일만)
score = 1000 · N · A^0.5 · pen
```

| 저장소                       | 스타   | 7일 증가       | 점수(7d) | 해석                                                  |
| ---------------------------- | ------ | -------------- | -------- | ----------------------------------------------------- |
| A: 소형 꾸준 성장            | 50     | +40 (균등)     | ≈ 1090   | 작은 저장소의 꾸준한 성장이 위로                      |
| B: 대형                      | 20,000 | +300 (균등)    | ≈ 315    | 총 스타가 커도 규모 보정으로 눌림                     |
| C: 신규 런칭 급등            | 415    | +400, 10, 5, 0 | ≈ 2693   | 3일에 415★는 실제로 뜨는 것 — 감점 후에도 1위(의도)   |
| D: 데이터 공백(커버리지 4/7) | —      | —              | 순위 제외 | 모르는 날을 0이나 누적 차분으로 메우지 않는다         |

모르는 날은 `null`로 두고(가짜 급등 방지), 자격(최소 증가량·활동일·커버리지 80%)을 못 채우면 순위에서 제외합니다. 파라미터는 한 곳(`TREND_PARAMS`)에 두고 `params_version`을 점수와 함께 저장합니다. 상세는 [ARCHITECTURE 5장](./ARCHITECTURE.md).

## 위험 신호 규칙 (규칙셋 `1.1.0`)

판정은 **정적 규칙 엔진만** 합니다(코드는 실행하지 않음). 한 줄이라도 위험 신호면 `DANGER`, 주의 신호만 있으면 `CAUTION`, 없으면 `SAFE` — "안전 인증"이 아니라 "탐지된 위험 신호 없음"입니다. 아래 표는 코드의 `RULE_METAS`와 같은 원천입니다.

| ID | 등급 | 탐지 |
| -- | ---- | ---- |
| `R01_REMOTE_PIPE_EXEC` | DANGER | 원격 스크립트 즉시 실행 |
| `R02_DESTRUCTIVE_RM` | DANGER | 광범위 파괴적 삭제 |
| `R03_SECRET_READ` | CAUTION / DANGER | 비밀 파일 읽기 |
| `R04_NETWORK_SEND` | CAUTION | 외부 데이터 전송 |
| `R05_SECRET_EXFIL` | DANGER | 비밀 정보 유출 의심 (R03 + R04 결합) |
| `R06_OBFUSCATED_EXEC` | CAUTION / DANGER | 난독화된 코드 실행 |
| `R07_DYNAMIC_EVAL` | CAUTION | 동적 코드 평가 |
| `R08_PRIVILEGE_PERSIST` | DANGER | 권한 상승·상시 실행 등록 |
| `R09_SHELL_PROFILE_WRITE` | DANGER | 셸 프로필 변조 |
| `R10_CLAUDE_CONFIG_TAMPER` | DANGER | Claude 설정·권한 변조 |
| `R11_SKILL_UNRESTRICTED_TOOLS` | CAUTION | 제한 없는 도구 권한 |
| `R12_MCP_EXTERNAL_SERVER` | CAUTION | 외부 MCP 서버 연결 |
| `R13_UNPINNED_PACKAGE_EXEC` | CAUTION | 버전 미고정 패키지 실행 |
| `R14_MARKETPLACE_COMMAND_SOURCE` | CAUTION | 마켓플레이스 `command` 소스 |
| `R15_HIDDEN_UNICODE` | CAUTION / DANGER | 숨은 유니코드 문자 (Trojan Source·Tag 문자 등) |
| `R16_OPAQUE_BINARY` | CAUTION | 분석 불가 실행파일·읽지 못한 설정 파일 (fail-closed) |

**알려진 상한**: 참조 깊이 1까지만 추적, 문자열 조립·변수 간접 참조로 만든 명령은 못 잡고, SKILL.md 자연어 지시의 의도는 판단하지 않습니다(사이트 "방법론" 페이지와 면책 문구에 명시). 규칙마다 양성·음성 테스트와 100KB 적대 입력 ReDoS 테스트가 있습니다.

## 핵심 엔지니어링 결정

- **보안 판정에 LLM을 쓰지 않는다.** 분석 대상(README·스크립트)은 공격자가 쓴 텍스트라 "이건 안전하다고 판정하라" 같은 프롬프트 인젝션에 원리적으로 취약하고, LLM 판정은 비결정적이며 근거 줄이 없다. 규칙 엔진은 같은 입력에 같은 결과와 `file:line` 근거를 낸다. `security/` 아래에 AI 클라이언트 import가 없다.
- **인용 검증.** 요약의 설치 명령은 원문의 부분 문자열일 때만 노출(실패분은 버리고 기록). 인용된 명령도 같은 규칙 엔진으로 검사해 경고를 붙인다. 검색 답변은 인용 id가 검색 결과 집합 밖이면 폐기. 요약·답변은 일반 텍스트로만 렌더(HTML·마크다운 금지, 테스트로 강제).
- **모델은 평가로 고른다.** 요약 모델(Haiku vs Sonnet)을 같은 프롬프트·20개 표본으로 비교(인용 통과율·누락률·한국어 품질·비용)하고, 차이가 임계값 미만이면 싼 쪽을 쓴다(`ai/evals/`).
- **한 DB, 두 마이그레이션 도구.** Prisma(`public`)와 Alembic(`ai`)가 스키마와 DB 롤로 영역을 나눈다. 쓰기 소유권은 코드 리뷰가 아니라 **DB 권한(GRANT)** 으로 강제 — 실수로 쓰면 `permission denied`. CI `migrations-coexist` 잡이 두 적용 순서 모두와 권한 경계, 계약 뷰 SQL diff를 검증한다. 스키마 간 FK는 두지 않는다(마이그레이션 순서 결합 방지).
- **keyset 페이지네이션.** 정렬 키(트렌드·스타·최근 push·신규)를 `item`에 비정규화하고 정렬×종류 복합 인덱스 + 불투명 커서. 다른 정렬의 커서는 400. 쿼리 파라미터는 `.strict()`로 캐시 버스팅을 막아 엣지 캐시 키 공간을 64개로 제한한다.
- **일일 AI 예산 원장.** 풀(요약·검색·답변)별 한도를 **조건부 UPDATE 한 문장**으로 원자적 예약 — 동시 50개 요청에도 초과 불가(테스트). 초과 시 호출 자체를 하지 않고 검색은 BM25 절약 모드로 계속 응답한다. 비용 추정은 과대 쪽으로 틀리게(fail-closed).
- **fail-closed 스캔.** 읽지 못한 설정 파일·잘림·파싱 불가·NUL은 `SAFE`가 될 수 없고 `CAUTION`. 데모 관리자 읽기 전용도 `DEMO_ADMIN_READONLY`가 명시적 `false`가 아니면 켜진다.
- **멱등 배치.** GitHub 레이트리밋 예산(리소스별 토큰 버킷) 안에서 단계별 체크포인트로 이어서 실행하고, 같은 `as_of` 재실행은 행 수 변화 0. advisory lock + 자연키 upsert, 강제 종료로 남은 RUNNING은 다음 시작 때 정리한다.
- **스타 이력은 출처 2곳 교차검증.** GitHub 공식 Star History + 자체 일일 스냅샷의 7일 합계를 비교해 불일치는 데이터 품질 이슈로 기록한다(stargazer `starred_at` 백필은 2026년부터 불가).

## 로컬 실행

사전 준비: Docker, Node 22, Python 3.12.

```bash
# 전체 스택(pgvector DB + backend + ai) — 두 /health가 200이면 준비 완료
docker compose -f infra/docker-compose.yml up --build
curl localhost:3000/health && curl localhost:8000/health

# 데모 데이터(가짜 저장소 10 · 항목 20 · 스타 60일 · admin/admin) — GitHub·AI 호출 없이 모든 화면이 채워짐
cd backend && npm ci
DATABASE_URL=postgresql://kok_app:kok_app@localhost:5433/kok \
AI_DATABASE_URL=postgresql://kok_ai:kok_ai@localhost:5433/kok npm run seed:fixtures

# 프론트
cd frontend && cp .env.example .env && npm ci && npm run dev    # http://localhost:5173
```

Swagger: `http://localhost:3000/api/docs`. 외부 키(Anthropic·Voyage) 없이도 동작하며, 키가 없으면 검색은 BM25 절약 모드(`degraded: true`)입니다.

운영용 시드·복원(가짜 데이터 없이 데모 계정만): `npm run seed:admin`(없으면 생성) · `npm run seed:demo-reset`(데모 북마크를 쇼케이스 상태로 복원) — [docs/DEPLOY.md](./docs/DEPLOY.md).

## 환경변수 (이름만 — 값은 `.env` / 플랫폼 시크릿)

| 대상 | 변수 |
| ---- | ---- |
| backend | `DATABASE_URL` `DIRECT_URL` `JWT_SECRET` `CORS_ORIGINS` `TRUST_PROXY` `DEMO_ADMIN_READONLY` `AI_BASE_URL` `INTERNAL_API_TOKEN` `GH_DISPATCH_TOKEN` `GH_DISPATCH_REPO` `GH_DISPATCH_WORKFLOW` `PORT` |
| batch (GitHub Actions) | `DATABASE_URL` `DIRECT_URL` `AI_BASE_URL` `INTERNAL_API_TOKEN` `GITHUB_TOKEN_INGEST`(시크릿명 `INGEST_GH_TOKEN`) `MAX_TRACKED_REPOS` `MAX_ITEMS_PER_REPO` `GITHUB_CORE_RESERVE` `EXTERNAL_STAR_SOURCE` `EXTERNAL_STAR_SOURCE_UNTIL` |
| ai | `AI_DATABASE_URL` `INTERNAL_API_TOKEN` `ANTHROPIC_API_KEY` `VOYAGE_API_KEY` `SUMMARY_MODEL` `ANSWER_MODEL` `EMBED_MODEL` `RERANK_MODEL` `DAILY_AI_BUDGET_USD` `AI_BUDGET_SPLIT` `MODEL_PRICES` `APP_ENV` |
| frontend (Vercel) | `VITE_API_BASE_URL` `VITE_DEMO_ADMIN_READONLY` `VITE_ISSUES_REPO` |

## 테스트

```bash
cd backend  && npm test            # 단위 + 통합(Testcontainers pgvector, 두 DB 롤·권한 경계 포함)
cd ai       && pip install -e ".[dev]" && pytest   # 가짜 제공자 — 외부 API 호출 0
cd frontend && npm test            # Vitest (원문 렌더 금지 규칙 포함)
```

- 순수 모듈(`security/engine`, `trending/algo`)은 IO 없이 표 기반으로 테스트합니다(커버리지 목표 95%+, 리뷰 시점 실측 98~100%).
- 라이브 스모크는 옵트인(`KOK_LIVE_SMOKE=1`, `GITHUB_LIVE_TOKEN`)이라 평소 외부 호출이 없습니다.
- CI 4잡: `backend` · `ai` · `frontend` · `migrations-coexist`.

## 프로젝트 구조

```
kok-gg/
├─ backend/    NestJS 11 + Prisma 7 — API 서버와 배치 CLI가 같은 이미지
│  ├─ src/{auth,catalog,trending,bookmarks,search,admin,security,ingestion,github,health,common}
│  ├─ src/security/engine/    규칙 엔진(순수)    src/trending/algo/   점수·교차검증(순수)
│  ├─ prisma/                 스키마·마이그레이션     scripts/  seed-admin · seed-demo-fixtures · seed-awesome
├─ ai/         FastAPI — app/{search,summary,budget,providers,jobs}, alembic/, evals/
├─ frontend/   Vite + React SPA — src/{pages,components,store,api,shared}
├─ infra/      docker-compose.yml, db/bootstrap.sql (롤·스키마·권한)
├─ docs/       DEPLOY.md        render.yaml  (Render Blueprint)
└─ .github/workflows/  ci · ingest(일일 배치) · publish-image(GHCR)
```

## 알려진 한계

- **보안 판정은 "탐지된 위험 신호 없음"이지 안전 보증이 아님** — 위 규칙 상한 참고.
- **Phase 1은 무료 티어**: Render 슬립(첫 진입 ~1분)·월 750 인스턴스시간(소진 시 월말까지 정지), Neon 5분 무활동 정지. 공개 런칭은 AWS 이전(Phase 2) 이후를 권장합니다.
- OSS Insight(외부 스타 이력)는 2026-12-04 API 종료 공지 → 기본 비활성(`EXTERNAL_STAR_SOURCE=none`).
- 실서비스 GitHub·Claude·Voyage 응답은 키 확보 후 라이브 스모크로 확인 예정(`docs/DEPLOY.md`). 검색 평가(Recall@10·MRR)는 실데이터 색인 후 채웁니다.
- 레이트리밋은 인메모리(인스턴스 1대 전제). 수평 확장 시 저장소를 Postgres/Redis로 교체하는 지점입니다.
- 비범위: MCP 서버 카탈로그, LLM 보안 판정, 동적 실행 샌드박스, 가짜 스타 탐지, 영어 UI 등([SPEC 4장](./SPEC.md)).
