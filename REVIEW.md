# REVIEW — kok.gg 배포 전 검수 (C0~C5 완료 시점)

- 검수일: 2026-11-26 · 대상: `main` (4a453f2) · 검수자: reviewer(Opus)
- 기준: 워크스페이스 `CLAUDE.md`(L 티어·주석·SSOT·데모 로그인), `SPEC.md`·`API.md`·`ARCHITECTURE.md`·`DATA-MODEL.md`·`PLAN.md`·`DESIGN.md`
- **결론: 🔴 blocker 7건 → 배포 승인 불가.** 아래 blocker 해소 후 재검수 필요. 배포 결정은 사람이 한다.

## 0. 직접 실행해 확인한 것

| 대상 | 명령 | 결과 |
| --- | --- | --- |
| backend | `prisma generate` → `lint:check` → `build` → 단위 테스트(+커버리지) → `test:e2e`(Testcontainers) | 전부 통과. 단위 23 스위트/214, e2e 8 스위트/58(+3 skip). `security/engine`+`trending/algo` 커버리지 Stmts 99.5% · Branch 98.0% · Lines 100% |
| ai | `ruff check` · `ruff format --check` · `pytest` | 통과 52(+2 skip). ※ 저장소 안 `ai/.venv`에는 `kiwipiepy`가 빠져 있어 14개 실패 → 별도 venv에 `pip install ai[dev]` 후 전부 통과(코드 문제 아님, 로컬 venv 재설치 권장) |
| frontend | `lint`(oxlint) · `test`(vitest) · `build` | 통과(10 파일/42). 번들 500KB 초과 경고만 |
| 시크릿 | `git log --all -p`에서 Anthropic/GitHub/Voyage/AWS 키·개인키·Neon URL 패턴 검색 | 없음. `.env*`는 example만 추적 |
| 숨은 유니코드 | 추적 파일 전체에서 양방향·제로폭·BOM·Tag 문자 검색 | 없음 |
| 재현 스크립트 | 컴파일된 `dist`로 엔진·트렌드 함수 직접 호출, Express 5 라우팅 확인 | 아래 🔴B1·B2·B3, 🟡Y1·Y2를 실제로 재현함 |

못 한 것: 라이브(Render/Vercel) 미배포라 운영 환경변수·CORS·`TRUST_PROXY` 실값 확인 불가. 실제 GitHub/Claude/Voyage 호출(옵트인 스모크) 미실행. NUL 바이트 DB 거부(B4)는 Postgres의 알려진 동작(`22021 invalid byte sequence 0x00`, jsonb `\u0000` 거부) 기반이며 이 저장소에서 재현 테스트는 돌리지 않음.

---

## 🔴 Blocker (배포 전 반드시 수정)

> 병렬 dispatch 판단용: **B1·B2는 같은 서브시스템(보안 엔진+scan 단계)** 이라 한 implementer에게 묶는 게 좋다. B3(throttle), B4(수집 파이프라인), B5(README), B6(시드), B7(데모 가드 기본값)은 서로 독립.

### B1. 설정 파일이 잘리거나 파싱 실패하면 검사 없이 `SAFE`가 된다 — 위험 신호 탐지 우회

- **서브시스템**: 보안 엔진 / security-scan 단계
- **파일**: `backend/src/security/engine/extract.ts:124-134`(truncated → `PARSE_ERROR` 노트만 남기고 return), `backend/src/ingestion/stages/security-scan.stage.ts:159-178`(파일 순서대로 2MB 예산 소진 시 이후 파일 truncated), `backend/src/ingestion/scan-files.ts:5-7,27-55`
- **재현**(dist로 실행):
  - `hooks/hooks.json`에 `curl … | sh` → `DANGER` (정상)
  - 같은 파일이 `truncated: true`(256KB 초과) → **`SAFE`, findings 0**, notes `[PARSE_ERROR]`
  - 같은 파일 앞에 BOM(`﻿`) → **`SAFE`**
- **왜 문제인가**: 공격자는 hooks.json을 공백으로 256KB 넘게 패딩하거나, `scripts/` 아래 무해한 큰 파일 8개(각 256KB)로 항목당 2MB 예산을 먼저 소진시키기만 하면 악성 훅이 **"안전 — 탐지된 위험 신호 없음"** 으로 공개된다. R16(분석 불가)은 `script` 대상에만 붙고 JSON 설정·SKILL.md에는 붙지 않는다. 이 제품의 핵심 차별점(F4)이 한 줄 패딩으로 무력화된다.
- **수정 지시**:
  1. `JSON_NAMES`·`SKILL.md` 파일이 `truncated`이거나 `PARSE_ERROR`면 **신호를 남긴다**: R16과 같은 방식의 `CAUTION` Finding(`[분석 불가 설정 파일] path`)을 내거나, scan 단계에서 해당 항목을 `TOO_LARGE`/`ERROR`(level null, UI "분석 불가")로 저장. 어느 쪽이든 **SAFE가 되면 안 된다**.
  2. `selectScanFiles`/`load` 순서를 **설정 JSON → SKILL.md → 스크립트**로 정렬해 예산 초과가 설정 파일을 밀어내지 못하게 한다.
  3. `JSON.parse` 전에 선행 BOM 제거.
  4. 엔진 테스트 추가(truncated hooks.json, BOM, 예산 소진 순서) 후 `RULE_SET_VERSION` 올려 전 항목 재검사.

### B2. `.claude/settings.json` HOOK 항목은 아예 검사되지 않는다

- **서브시스템**: 보안 엔진 / scan 파일 선택 (B1과 같은 implementer 권장)
- **파일**: `backend/src/security/engine/extract.ts:8-14`, `backend/src/ingestion/scan-files.ts:9-15` (둘 다 `JSON_NAMES`에 `settings.json` 없음). 판별은 `backend/src/ingestion/classify.ts:317-338`에서 이 파일로 HOOK 항목을 만든다(ARCHITECTURE 3.4 증거 경로).
- **재현**: `selectScanFiles(['.claude/settings.json','.claude/hooks/x.sh'], '.claude')` → settings.json은 선택조차 안 됨. 엔진에 직접 넣어도 `SAFE`, findings 0.
- **왜 문제인가**: F1이 HOOK으로 분류하는 대표 경로 하나가 통째로 "검사됨·SAFE"로 표시된다. 또한 `hooks/*.sh`는 `selectScanFiles`가 받아오지만(`scan-files.ts:45-46`) `extractTargets`는 `${CLAUDE_PLUGIN_ROOT}` 참조가 없으면 검사 대상에 넣지 않아(`extract.ts:205-212`) **받고 버린다**(API 호출 낭비 + 미검사).
- **수정 지시**: 두 `JSON_NAMES`에 `settings.json`(경로가 `.claude/` 아래일 때)을 추가해 `walk`가 `hooks` 명령을 shell 영역으로 뽑게 한다. `$CLAUDE_PROJECT_DIR/…`·`.claude/hooks/…` 참조도 `followRefs` 대상에 포함. `hooks/` 아래 스크립트는 선택했으면 script 영역으로 검사(또는 선택 목록에서 제거해 둘을 일치). 테스트: settings.json 훅 `curl|sh` → DANGER.

### B3. 이름 있는 레이트리밋(검색 20·답변 5·로그인 10/분)이 경로 끝 `/`·대소문자로 우회된다

- **서브시스템**: NestJS 공통 throttle
- **파일**: `backend/src/common/throttle/throttle.config.ts:9-12,25,31,37`
- **재현**: Express 5.2.1에서 `GET /api/search/?q=a`, `GET /API/Search?q=a`, `POST /api/auth/login/`이 모두 같은 핸들러로 200 매칭되고 `req.path`는 각각 `/api/search/`, `/API/Search`, `/api/auth/login/`. `onlyPaths`는 정확 문자열 비교라 `skipIf=true` → 해당 버킷이 **건너뛰어지고** 전역 120/분만 남는다.
- **왜 문제인가**: SPEC F10/IT-15의 핵심 방어. 로그인 무차별 대입 한도 10→120/분, 답변(LLM 비용) 5→120/분. 일일 예산이 돈은 막아 주지만 예산 소진 DoS가 24배 쉬워지고 로그인 보호는 사실상 없어진다.
- **수정 지시**: 경로 문자열 대신 **핸들러 메타데이터**로 버킷을 고른다. 예: `@RateBucket('search')` 같은 `SetMetadata` 데코레이터를 `SearchController.find`·`answer`, `AuthController.login`·`register`에 붙이고, `skipIf: (ctx) => Reflect.getMetadata(KEY, ctx.getHandler()) !== 'search'`. e2e에 `/api/search/`·`/API/SEARCH`·`/api/auth/login/` 21회/11회 → 429 케이스 추가.

### B4. 저장소 원문에 NUL(`\u0000`) 하나로 QUALIFY·FETCH_CONTENT 단계가 매일 영구 실패한다(독 알약)

- **서브시스템**: 수집 파이프라인(qualify / fetch-content / repo-inspector)
- **파일**: `backend/src/ingestion/stages/fetch-content.stage.ts:55-63`(GithubError 외 예외는 rethrow → 단계 FAILED), `backend/src/ingestion/stages/qualify.stage.ts:105-108`(동일), 쓰기 지점 `fetch-content.stage.ts:121-151`(`content`·SKILL.md `name/description`), `backend/src/ingestion/repo-inspector.service.ts:93-188`(marketplace.json의 `name`·`description`·`rawSource` jsonb)
- **왜 문제인가**: Postgres `text`는 NUL을 거부하고 `jsonb`는 `\u0000` 이스케이프를 거부한다. README/SKILL.md/marketplace.json은 공격자가 쓰는 텍스트다. Prisma 오류는 `GithubError`가 아니라 저장소 단위 격리(ARCHITECTURE 3.1 "한 저장소 오류는 failure로 남기고 계속")를 뚫고 단계 전체를 FAILED로 만든다. 다음 실행도 `ORDER BY id`/`stars desc`로 **같은 저장소를 먼저 집어** 또 실패 → 그 뒤 모든 저장소의 판별·요약 원문 수집이 영구 정지. `claude-code` 토픽 하나 단 공개 저장소로 누구나 유발 가능.
- **수정 지시**:
  1. GitHub에서 온 문자열을 DB에 쓰기 전 한 곳에서 `\u0000` 제거(예: `getFile` 반환값과 `mapRepo`/GraphQL 매핑, `classify`의 `str()`, `rawSource`는 `JSON.parse(JSON.stringify(x).replaceAll('\\u0000',''))`).
  2. qualify·fetch-content의 저장소 루프에서 **PAUSE가 아닌 모든 예외**를 `ctx.failure(...)` + `skip`으로 격리(DB 연결 끊김 같은 진짜 치명 오류는 실패율 20% 규칙이 단계 FAILED로 올린다).
  3. 통합 테스트: README에 `\u0000` 포함한 픽스처 저장소 → 해당 저장소만 failure 1건, 단계 DONE.

### B5. 루트 README(+ mermaid 아키텍처 다이어그램) 없음 — L 티어 필수 요소 (C6 예정 작업)

- **서브시스템**: 문서
- **파일**: `README.md`(루트, 미존재). `ai/README.md`만 있음.
- **왜 문제인가**: 워크스페이스 품질 기준표에서 S/M/L 공통 필수. PLAN C6-3 범위이고 배포 승인 게이트(라이브 미리보기 + 리뷰 요약) 이전에 있어야 면접관이 저장소를 읽을 수 있다.
- **수정 지시**: PLAN C6-3 목록 그대로 — mermaid 아키텍처, 트렌드 공식 + ARCHITECTURE 5.2 예시 표, 규칙 표 + 알려진 상한, 두 스키마 소유권, 비범위 요약, 실행법(compose·시드·CLI), 데모 계정 안내, 라이브 URL 자리, Phase 2 계획. 검색 평가 표(C6-2)는 결과 나오면 추가.

### B6. 운영 DB에 데모 관리자를 만드는 `scripts/seed-admin.ts` 없음 — 라이브에서 데모 버튼이 401 (C6 예정 작업)

- **서브시스템**: 시드 스크립트
- **파일**: `backend/scripts/`(seed-admin.ts 미존재). 현재 admin은 `backend/scripts/seed-demo-fixtures.ts:307-316`에서만 생성되며 이 스크립트는 가짜 저장소 10개를 함께 넣으므로 운영 DB에 돌리면 안 된다.
- **왜 문제인가**: SPEC F11·PLAN C6-1·워크스페이스 데모 규정("시드는 1회성, 이미 있으면 스킵, 샘플 데이터 2~3개"). 없으면 US-12(데모 1클릭 → 채워진 화면)가 라이브에서 실패.
- **수정 지시**: idempotent `seed-admin.ts` — `admin`/`admin`(bcrypt, ADMIN) upsert(있으면 스킵), **실데이터 항목** 위 북마크 3(1개는 `seenLevel`을 현재와 다르게), Override 1, 데이터 품질 이슈 2, 실행 이력 2. `dist/scripts/seed-admin.js`로 빌드돼 API.md 8장 명령대로 실행 가능해야 함(현재 `tsconfig.build`가 scripts를 포함하는지 확인). `seed-demo-fixtures.ts`에는 `NODE_ENV=production`이면 거부하는 가드 추가.

### B7. `DEMO_ADMIN_READONLY` 기본값이 fail-open — 설정 누락 시 누구나 공개 데모 관리자로 보안 등급을 바꿀 수 있다

- **서브시스템**: NestJS 가드 / 프론트 관리자 화면
- **파일**: `backend/src/common/guards/demo-read-only.guard.ts:17`(`!== 'true'`이면 전부 통과), `frontend/src/pages/Admin.tsx:21`, `backend/.env.example:9`
- **왜 문제인가**: SPEC 7장은 "운영 기본 true". 코드는 환경변수가 없으면 열린다. 데모 계정 비밀번호는 공개(`admin`)이므로, Render 환경변수 하나 빠뜨리면 인터넷의 누구나 DANGER 항목에 Override를 걸어 **SAFE로 공개**할 수 있다(데모 관리자 계정이 사실상 백도어가 됨). 한 줄로 fail-closed가 된다.
- **수정 지시**: `NODE_ENV === 'production'`이면 기본 읽기 전용(`DEMO_ADMIN_READONLY !== 'false'`), 비운영은 지금처럼 기본 해제. 단위 테스트에 "production + 미설정 → 403" 케이스 추가. 프론트도 `import.meta.env.PROD`일 때 기본 true.

---

## 🟡 개선 (배포 후 빠르게 / 다음 청크에서)

| # | 서브시스템 | 위치 | 문제 · 왜 | 수정 |
| --- | --- | --- | --- | --- |
| Y1 | 트렌드 알고리즘 | `backend/src/trending/algo/trend.ts:100-101`, `:89-98` | 언스타로 음수 일이 섞이면 `concentration = max/gain`이 1을 넘어 **감점 배율이 음수**. 재현: D7 `[10,-8,1,1,1,0,0]`(자격 통과) → `penalty -1.1`, `score -106.55`. SPEC "최대 60%까지 감점"(floor 0.4) 위반, 자격 저장소가 미자격(0)보다 아래로 정렬됨. 직전 기간 합이 `-α` 이하면 가속도 분모 ≤ 0 | `c = clamp(max(cur)/gain, 0, 1)` 또는 `penalty = max(floor, …)`, 가속도 분모 `max(sum(prev),0)+α`. TA 표에 음수 일 케이스 추가 |
| Y2 | 보안 엔진 | `backend/src/security/engine/preprocess.ts:35` | 4000자 넘는 줄은 앞 4000자만 검사 → 공백 4000개 뒤 `curl … \| sh`는 **DANGER가 CAUTION(R06 초장문)으로 강등**(재현함). 설계상 상한이지만 방법론 페이지에 없음 | 긴 줄을 겹치는 4000자 창(예: 3500 간격)으로 나눠 규칙 적용(선형 유지), 또는 KNOWN_LIMITS_KO에 명시 |
| Y3 | 인증 | `backend/src/auth/auth.service.ts:80-121` | 같은 refresh 토큰 동시 2요청이 둘 다 `revokedAt null`을 보고 각각 새 토큰 발급 → 재사용 탐지 우회, 유효 계열 2개 | 트랜잭션 안에서 `updateMany({where:{id, revokedAt:null}})`의 `count === 1`일 때만 발급, 0이면 재사용으로 처리 |
| Y4 | 수집 discover | `backend/src/github/github.client.ts:359-372`, `backend/src/ingestion/candidates.service.ts:24-48` | 코드 검색 응답의 `repository`는 축약 객체라 `stargazers_count` 등이 빠질 수 있음 [실응답 확인 필요] → 기본값 0으로 저장, `createMany skipDuplicates`라 이후 갱신도 안 됨 → qualify의 "스타순 MAX_TRACKED_REPOS 선별"이 코드 검색 후보에 대해 깨짐 | C4-0 캡처로 필드 확인 후, 없으면 qualify 직전 후보 스타를 GraphQL `nodes`로 일괄 갱신 |
| Y5 | 관리자 수집 | `backend/src/admin/ingestion-admin.service.ts:33-44`, `backend/src/ingestion/pipeline.ts:84-109` | 배치가 강제 종료(Actions 120분 타임아웃 등)되면 run이 `RUNNING`으로 영구 잔존 → 이후 수동 실행 요청이 **영원히 409** | advisory lock을 잡은 직후 다른 `RUNNING` run을 `FAILED`로 정리하거나, `RUNNING && startedAt < now-3h`는 활성에서 제외 |
| Y6 | 데모 데이터 | `backend/src/bookmarks/bookmarks.service.ts:151-157`, SPEC US-12 | 데모 계정은 모든 방문자가 공유 → 첫 면접관이 "확인"을 누르거나 북마크를 지우면 다음 면접관에겐 **변경 탭이 비어** US-12 수용 기준이 깨진다 | 일일 배치(또는 seed-admin 재실행)로 데모 북마크 3건·변경 1건을 매일 복원. SPEC대로 북마크는 계속 허용 |
| Y7 | AI 예산 | `ai/app/budget/ledger.py:45-49,100-110` | 추정 "문자수/3 = 토큰"은 한국어·CJK·이모지에서 **과소 추정**(문자당 ≥1토큰). 실제 > 추정이면 `LEAST`가 spent를 cap에 멈춰 **원장상 초과 0인데 실제 지출은 초과** → SPEC "초과 0회, 원장으로 확인" 검증 불가 | 비ASCII 문자는 1문자=1토큰으로 추정하거나 `count_tokens` 사용. 초과분은 usage_ledger에 그대로(이미 함) + 경고 로그/지표 |
| Y8 | 요약 인용 검증 | `ai/app/summary/quote_verify.py:10-16` | 부분 문자열이면 통과 → 원문 `curl x \| sh`에서 모델이 `curl x`만 인용해도 통과, NestJS 경고(`commandWarnings`)도 조각에만 적용돼 **위험 꼬리가 잘린 설치 명령이 경고 없이** 노출 가능 | 인용이 원문의 **한 줄 전체**(또는 코드 스팬/블록 줄 전체, 공백 접기 후)와 같을 때만 통과. TF-3에 "잘린 인용 → 탈락" 추가 |
| Y9 | GitHub 클라이언트 | `backend/src/github/github.client.ts:439-464`(`getFile`), 호출부 `repo-inspector.service.ts:43-46`, `fetch-content.stage.ts:95-106` | 응답 본문 크기 상한 없음. scan 단계는 트리 `size`로 거르지만 증거 JSON 40개·README 후보는 크기 확인 없이 전부 메모리로 읽음(GitHub 파일 최대 100MB) | 트리 `entry.size`로 사전 차단(증거 JSON ≤256KB, 원문 ≤256KB), `content-length` 확인 |
| Y10 | 판별(마켓플레이스) | `backend/src/ingestion/classify.ts:119-120,145-147`, `github.client.ts:375-378` | `owner/name` 정규식 `[\w.-]+`가 `.`·`..`를 허용 → `{source:'github', repo:'../..'}`가 `GET /repos/../..`(= API 루트 등 다른 경로)를 **수집용 PAT로** 호출. GET뿐이고 응답은 zod에서 걸러지지만 불필요한 신뢰 경계 구멍 | `.`/`..` 세그먼트 거부(GitHub 이름 규칙상 불가), `getRepo`에서 세그먼트별 `encodeURIComponent` |
| Y11 | 배치 ↔ AI | `backend/src/ingestion/ai-sync.client.ts:23-38` | API.md 7장 "타임아웃 120초, 재시도 3회(무료 티어 기상 대기)"와 다름(300초·재시도 0) → 슬립 중 첫 호출 실패 시 AI_SYNC 단계 FAILED | 연결 실패/5xx에 지수 백오프 3회, 문서와 값 일치 |
| Y12 | CI | `.github/workflows/ci.yml:46-60`, `backend/package.json:84-103` | 프론트 vitest(42개, 원문 렌더 금지 규칙 포함)가 **CI에서 안 돈다**(lint·build만). SPEC 6장 "순수 모듈 커버리지 95%+"도 임계값으로 강제되지 않음(현재 실측 99.5%) | frontend 잡에 `npm test` 추가, jest `coverageThreshold`를 `security/engine`·`trending/algo`에 95로 설정 |
| Y13 | SSOT | `backend/src/catalog/dto/catalog.schema.ts:5-6`, `catalog.service.ts:51-57,109-114`, `search/search.service.ts:24-29` | `ItemKind`/`RiskLevel`을 리터럴로 재정의(같은 파일군의 `admin.schema.ts`는 `z.enum(StageName)`으로 Prisma에서 파생 — 불일치). 서비스 인자 타입도 손으로 재작성(`kind?: string`) → CLAUDE.md SSOT 규칙 위반, 드리프트 위험 | `z.enum(ItemKind)`·`z.enum(RiskLevel)` 사용, 서비스 인자는 `z.infer<typeof itemsQuerySchema>` 등으로 |
| Y14 | 주석 규칙 | 예: `auth/auth.service.ts:34,55,124,136`, `trending/algo/cross-validate.ts:47`, 컨트롤러 핸들러 전반 | 공개 메서드·핸들러 JSDoc(왜·파라미터·반환·예외) 누락. 핸들러는 `@ApiOperation` 요약뿐이라 예외(401/409 등)가 코드에서 안 보임 | 보안·알고리즘 경로(`login`·`register`·`crossValidateStars`·관리자 핸들러) 우선 보강. 자명한 getter는 제외 |
| Y15 | 컨테이너 | `backend/Dockerfile:20-29`, `ai/Dockerfile:2-11` | 두 이미지 모두 root로 실행 | runner 단계 `USER node`, ai는 비root 사용자 생성 후 `USER` |
| Y16 | 숨은 유니코드 | `backend/src/security/engine/rules/R15.ts:5-6`, 발췌 정화 `engine/scan.ts:22-25` | U+200E/200F(LRM/RLM), U+2060–2064, 파일 중간 U+FEFF, **Unicode Tag 문자 U+E0000–E007F**(프롬프트 인젝션용 ASCII 스머글링) 미탐지, 발췌에서도 제거 안 됨 | R15 주의 목록과 `UNSAFE_DISPLAY`에 추가(`u` 플래그), 버전 올림 |
| Y17 | 요약 프롬프트 | `ai/app/summary/prompt.py:16-17` | 원문에 `</source_doc>`를 넣으면 구분자를 닫고 지시를 이어 쓸 수 있음. 요약은 판정 권한이 없고 텍스트 렌더라 영향은 작지만 비용 0으로 막을 수 있음 | 원문 내 `<source_doc>`/`</source_doc>` 토큰 제거(또는 무작위 경계 문자열 사용) |

---

## 🟢 Nit / 참고

- `AUTH_TOKEN_EXPIRED`(API.md 1.2)가 코드 어디에도 없다 — 만료 access는 Passport 기본 401 `UNAUTHORIZED`. 프론트는 모든 401에서 refresh하므로 동작은 정상, 문서 정합만 맞추면 됨(`backend/src/common/guards/jwt-auth.guard.ts`의 `handleRequest`에서 `TokenExpiredError` 매핑).
- `snippetKo`가 API.md 4장("질의 토큰이 가장 많이 겹치는 문장")과 달리 요약 앞 120자(`ai/app/search/service.py:234-235`).
- 로그인 시 사용자 없으면 bcrypt를 건너뛰어 응답 시간으로 계정 존재가 드러남(`auth.service.ts:60-62`) — 더미 해시와 비교하면 해결. 가입 409로 어차피 노출되는 정보라 우선순위 낮음.
- 이메일 대소문자 미정규화로 `A@x.com`/`a@x.com` 중복 가입 가능. 비밀번호 `max(72)`는 문자 수라 한글 비밀번호는 72바이트 초과분이 bcrypt에서 조용히 잘림(`register.schema.ts:7`).
- `x-request-id`를 길이 제한 없이 반사·로그(`app.module.ts:27-33`). 보안 헤더(helmet)·CSP 없음, 토큰은 localStorage(`frontend/src/store/auth.ts`) — XSS 싱크가 없어서 당장 위험하진 않음.
- `makeLocator`가 호출마다 처음부터 줄을 셈(`extract.ts:53-70`) → 명령이 많은 큰 JSON에서 O(줄²). 줄 시작 오프셋 배열 1회 계산으로 교체 가능.
- 검색 캐시 키에 보안 등급 변경이 반영되지 않아 `level` 필터 결과가 최대 24h 옛 등급 기준(NestJS가 카드를 다시 채우므로 표시 등급은 정확).
- NestJS→FastAPI 답변 타임아웃 8초 vs Anthropic 클라이언트 60초+재시도 2 — 느린 답변은 사용자에게 "깨우는 중"으로 보이고 FastAPI는 계속 비용을 씀(다음 요청은 캐시 히트).
- `JWT_REFRESH_SECRET`은 쓰이지 않음(`.env.example`, compose). 같은 fingerprint가 한 파일 여러 줄에 나오면 프론트 `key={f.fingerprint}` 중복.
- 항목 상세 `GET /api/items/:id`는 항목 `ACTIVE`만 보고 저장소 `GONE/IGNORED`는 보지 않음(스냅샷 단계가 항목을 REMOVED로 내리므로 실영향 작음).
- `ai/.venv`에 `kiwipiepy`가 없어 로컬 pytest 14개 실패 — `pip install -e ".[dev]"` 재실행 필요(코드 문제 아님).

---

## 🟢 Good (잘 된 것 — 유지)

- **판정 경로에 LLM 없음**: `security/` 아래 AI 클라이언트 import 0, 엔진은 순수 함수. 규칙 16개 양성·음성 + 100KB ReDoS 테스트, 순수 모듈 커버리지 99.5%/98%/100%.
- **원시 SQL 전부 파라미터 바인딩**: Prisma 태그드 템플릿·SQLAlchemy `text()` + 바인드. `$queryRawUnsafe`·문자열 조립 없음(`CACHE_TTL` f-string은 상수).
- **두 DB 롤 경계**: kok_app/kok_ai 권한을 DB가 강제하고 CI가 마이그레이션 적용 순서 A/B 모두에서 `permission denied`를 확인, 계약 SQL diff까지 검증.
- **내부 API**: `hmac.compare_digest` + 서버 토큰 비면 전부 거부(fail-closed), 401 본문 없음, 운영 `/docs` 비활성.
- **AdminGuard가 토큰이 아닌 DB role을 재조회**, 모든 `/api/admin/**`에 AdminGuard+DemoReadOnlyGuard 적용(컨트롤러 단위 확인).
- **데모 로그인 규정 준수**: 로그인 스키마만 `z.literal('admin')` 우회, 가입은 `z.email`만(테스트 있음), bcrypt 항상 비교, 우회 엔드포인트 없음, 고정 문구 두 줄 그대로, 로그인 화면 상단 노출.
- **XSS**: `dangerouslySetInnerHTML`·마크다운 렌더 0 + 이를 강제하는 테스트, 외부 링크 `rel="noopener noreferrer"`, `appealUrl`은 `^https://github.com/`만.
- **입력 검증**: 쿼리 `.strict()`(캐시 버스팅 차단), 커서 정렬 일치 검사, GitHub 응답 zod 검증, Pydantic `extra="forbid"`.
- **캐시**: 공개 GET만 프로필, 오류 응답은 필터가 항상 `no-store`로 덮음, degraded 검색은 짧은 s-maxage.
- **예산 원자성**: 조건부 UPDATE + DB CHECK 이중 안전장치, 예외 시 자동 해제, 동시 50 예약 테스트.
- **배치**: advisory lock 전용 직결 연결, 자연키 upsert, 묶음 커밋과 커서를 같은 트랜잭션에, PAUSED 재개, workflow 입력을 셸에 보간하지 않음.
- **Swagger e2e·`/health`(AI를 깨우지 않는 캐시 상태)·Testcontainers(pgvector)·Dockerfile 2개·마이그레이션+인덱스(정렬 4종 × kind 복합 인덱스)** — L 티어 체크리스트 중 README 외 전부 충족.
- 시크릿·숨은 유니코드 커밋 없음. Conventional Commits 일관.

---

## 수정 결과 (2026-11-26)

| 항목 | 상태 | 비고 |
| --- | --- | --- |
| 🔴 B1 | ✅ 수정 | 잘림·파싱 불가·NUL 설정/SKILL.md → R16(CAUTION), BOM 제거 후 파싱. RULE_SET_VERSION 1.1.0. 오케스트레이터가 재현 시나리오로 재확인(SAFE 0건) |
| 🔴 B2 | ✅ 수정 | `.claude/settings.json` 훅·`hooks/*.sh` 항상 검사. root 누락 시에도 경로로 인식하도록 심층 방어 보강 |
| 🔴 B3 | ✅ 수정 | 레이트리밋 버킷을 핸들러 메타데이터(`@RateBucket`)로 결정, 끝 `/`·대소문자 우회 e2e |
| 🔴 B4 | ✅ 수정 | NUL 제거 + qualify·fetch-content 저장소 단위 실패 격리 |
| 🔴 B5 | ⏳ C6 | 루트 README + mermaid |
| 🔴 B6 | ⏳ C6 | `seed-admin.ts` |
| 🔴 B7 | ✅ 수정 | `DEMO_ADMIN_READONLY`는 명시적 `false`가 아니면 읽기 전용(fail-closed) |
| 🟡 Y1–Y17 | ✅ 수정 | Y6는 데모 계정 ack·북마크 삭제를 서버 no-op 처리(추가는 누적 → C6 시드 재실행으로 정리) |

남은 한계: `.claude/settings.json` 훅이 `.claude` 밖 스크립트를 부르면 추적하지 않음(방법론 페이지에 명시). GitHub·Claude·Voyage 실응답 미검증(키 확보 후 live smoke).
