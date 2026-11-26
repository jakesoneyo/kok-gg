# API — kok.gg

브라우저가 아는 서버는 **NestJS 하나**다. Base `https://<backend-host>` · 프리픽스 `/api` · Swagger `/api/docs`(nestjs-zod로 Zod 스키마 → OpenAPI).
FastAPI는 내부 API(7장)만 가지며 전부 `X-Internal-Token` 필요. 용어는 [UBIQUITOUS_LANGUAGE.md](./UBIQUITOUS_LANGUAGE.md), 동작 배경은 [ARCHITECTURE.md](./ARCHITECTURE.md).

## 1. 공통 규약

- **인증**: `Authorization: Bearer <accessToken>`(15분). 권한 표기 `Public` / `Bearer`(로그인) / `ADMIN`.
- **공개 읽기(`Public`)는 Authorization 헤더를 아예 읽지 않는다** — 응답에 사용자별 데이터가 없어 공유 캐시에 안전. 북마크 여부는 `/api/me/bookmarks/ids`로 따로.
- **검증**: 모든 params/query/body를 Zod로 파싱. 쿼리 스키마는 `.strict()` → **알 수 없는 파라미터는 400**(캐시 버스팅 차단). 실패 시 400 + `details`(필드별 메시지).
- **페이지네이션**: keyset. `?cursor=<opaque>&limit=N` → `{ items, nextCursor: string | null }`. 커서는 정렬별 토큰(DATA-MODEL.md 6.3), 다른 정렬의 커서는 400 `INVALID_CURSOR`.
- **시각**: ISO-8601 UTC. 날짜만은 `YYYY-MM-DD`(UTC).
- **데모 관리자**: `DEMO_ADMIN_READONLY=true`이면 `admin` 계정의 `/api/admin/**` 비-GET 요청은 403 `DEMO_READ_ONLY`.
- **에러 포맷**(runboard와 동일)

```json
{
  "statusCode": 400,
  "code": "INVALID_CURSOR",
  "message": "정렬 방식과 맞지 않는 커서입니다.",
  "details": null
}
```

### 1.1 캐시 프로필 (`@PublicCacheable(profile)`)

| 프로필   | `Cache-Control`                                                    | 적용                                                          |
| -------- | ------------------------------------------------------------------ | ------------------------------------------------------------- |
| `daily`  | `public, max-age=60, s-maxage=1800, stale-while-revalidate=86400`  | 트렌딩, 항목/저장소 상세                                      |
| `list`   | `public, max-age=60, s-maxage=600, stale-while-revalidate=86400`   | 카탈로그 목록                                                 |
| `series` | `public, max-age=300, s-maxage=3600, stale-while-revalidate=86400` | 스타 시계열                                                   |
| `search` | `public, max-age=0, s-maxage=300, stale-while-revalidate=3600`     | 검색 · 답변                                                   |
| `static` | `public, max-age=3600, s-maxage=86400`                             | 보안 규칙 목록, 통계                                          |
| (기본)   | `private, no-store`                                                | `/api/auth/**`, `/api/me/**`, `/api/admin/**`, 모든 오류 응답 |

- Express 기본 약한 ETag → `If-None-Match` 304 자동.
- 4xx/5xx는 항상 `no-store`(오류가 엣지에 박히지 않게). 검색이 `degraded: true`면 `s-maxage=60`으로 낮춘다(예산 회복 후 빨리 정상 결과로).

### 1.2 에러 코드

| code                       | status | 상황                                                         |
| -------------------------- | ------ | ------------------------------------------------------------ |
| `VALIDATION_FAILED`        | 400    | Zod 실패(알 수 없는 쿼리 파라미터 포함)                      |
| `INVALID_CURSOR`           | 400    | 디코드 실패, 정렬 불일치, 값 타입 불일치                     |
| `AUTH_INVALID_CREDENTIALS` | 401    | 로그인 실패(존재 여부 비노출)                                |
| `AUTH_TOKEN_EXPIRED`       | 401    | access 만료 → 클라이언트 refresh                             |
| `AUTH_REFRESH_REUSE`       | 401    | 폐기된 refresh 재사용 → 계열 전체 폐기                       |
| `AUTH_REFRESH_INVALID`     | 401    | refresh 없음/만료                                            |
| `AUTH_EMAIL_TAKEN`         | 409    | 가입 이메일 중복                                             |
| `FORBIDDEN`                | 403    | ADMIN 아님                                                   |
| `DEMO_READ_ONLY`           | 403    | 운영 환경 데모 관리자의 관리자 변경 요청                     |
| `NOT_FOUND`                | 404    | 리소스 없음                                                  |
| `FINDING_NOT_FOUND`        | 404    | Override 대상 fingerprint가 현재 검사에 없음                 |
| `OVERRIDE_EXISTS`          | 409    | 같은 (항목, fingerprint)에 활성 Override 존재                |
| `RUN_ALREADY_ACTIVE`       | 409    | REQUESTED/RUNNING 실행이 이미 있음                           |
| `RATE_LIMITED`             | 429    | Throttler 초과(`Retry-After` 포함)                           |
| `SEARCH_WARMING`           | 503    | FastAPI 미응답(무료 티어 슬립 기상 중 등), `Retry-After: 30` |
| `SEARCH_UNAVAILABLE`       | 503    | FastAPI 오류(내부 토큰 불일치 포함 — 상세는 로그에만)        |

---

## 2. 인증 (`/api/auth`) — runboard 재사용

| Method | Path             | 권한   | 요청                                             | 응답                                      |
| ------ | ---------------- | ------ | ------------------------------------------------ | ----------------------------------------- |
| POST   | `/auth/register` | Public | `{ email(z.email), password(8~72), name(1~40) }` | 201 `{ user, accessToken, refreshToken }` |
| POST   | `/auth/login`    | Public | `{ email: 'admin' 리터럴 \| z.email, password }` | 200 `{ user, accessToken, refreshToken }` |
| POST   | `/auth/refresh`  | Public | `{ refreshToken }`                               | 200 `{ accessToken, refreshToken }`(회전) |
| POST   | `/auth/logout`   | Bearer | `{ refreshToken }`                               | 204                                       |
| GET    | `/auth/me`       | Bearer | –                                                | 200 `{ id, email, name, role, isDemo }`   |

- `user = { id, email, name, role }`. `isDemo`는 `email === 'admin'` — 프론트가 운영 환경에서 관리자 변경 버튼을 비활성화하는 데 쓴다(서버 가드가 진짜 방어).
- 로그인 throttler `auth` 10/분/IP. 비밀번호는 항상 bcrypt 비교, 우회 경로 없음.

---

## 3. 공개 카탈로그 (`Public`)

### 3.1 `GET /api/items` — 카탈로그 목록 (정렬 · 필터) · 캐시 `list`

| Query    | 타입 / 검증                                   | 기본       | 설명                                                                                        |
| -------- | --------------------------------------------- | ---------- | ------------------------------------------------------------------------------------------- |
| `sort`   | `'trending' \| 'stars' \| 'updated' \| 'new'` | `trending` | 트렌딩(7일 점수) / 총 스타순 / 최근 업데이트순(저장소 push) / 신규 등록순(kok.gg 최초 발견) |
| `kind`   | `'PLUGIN' \| 'SKILL' \| 'HOOK'`               | 전체       | 어떤 `sort`와도 조합 가능                                                                   |
| `level`  | `'SAFE' \| 'CAUTION' \| 'DANGER'`             | 전체       | 어떤 `sort`와도 조합. 지정 시 미분석 항목 제외                                              |
| `limit`  | 정수 1~50 (`z.coerce.number().int()`)         | 24         |                                                                                             |
| `cursor` | base64url 문자열 ≤ 200자                      | –          | 같은 `sort`로 받은 `nextCursor`만 유효                                                      |

```
Zod: z.object({ sort, kind, level, limit, cursor }).strict()
```

200

```json
{
  "asOf": "2026-11-24",
  "sort": "trending",
  "items": [
    {
      "id": 812,
      "kind": "HOOK",
      "name": "pre-pr-lint",
      "description": "Runs lint before Claude opens a PR",
      "repo": {
        "id": 77,
        "fullName": "someone/claude-hooks",
        "stars": 342,
        "pushedAt": "2026-11-23T09:12:00Z",
        "sparkline7d": [2, 3, null, 5, 8, 12, 9]
      },
      "trendRank7d": 3,
      "rankDelta": 2,
      "isNew": false,
      "currentLevel": "CAUTION",
      "hasExternalMcp": false,
      "trendScore7d": 1088.4,
      "firstSeenAt": "2026-11-02T18:04:11Z",
      "components": {}
    }
  ],
  "nextCursor": "eyJzIjoidHJlbmRpbmciLCJ2IjoxMDg4LjQsImlkIjo4MTJ9"
}
```

- **`ItemCard`**(목록·검색·북마크 공용 행) 추가 필드: `repo.sparkline7d`(`(int|null)[7]`, 오래된 날→오늘, `null` = 모름 → 차트 끊김. Zod `z.array(z.number().int().nullable()).length(7)`), `trendRank7d`(`int|null`, 미자격 `null`), `rankDelta`(`int|null`, 전일 순위 − 오늘 순위 → 양수 ▲ · 음수 ▼ · 0 변동 없음, NEW·미자격은 `null`), `isNew`(`trendRank7d != null && 전일 순위 없음`). 전부 배치가 미리 쓴 컬럼이라 추가 쿼리 없음(DATA-MODEL.md 6.1).
- 정렬 키 동률은 `id DESC`로 결정적. `trending`에서 미자격 항목은 `trendScore7d = 0`으로 뒤에 붙는다.
- 프론트는 쿼리 파라미터를 **`kind, level, sort, cursor, limit` 고정 순서**로 직렬화(엣지 캐시 키 정규화). 기본값과 같은 파라미터는 생략.

### 3.2 `GET /api/trending` — 저장소 순위표 · 캐시 `daily`

| Query    | 검증                                    | 기본 |
| -------- | --------------------------------------- | ---- |
| `window` | `'D1' \| 'D7' \| 'D30'`                 | `D7` |
| `kind`   | ItemKind (그 종류 Item을 가진 저장소만) | 전체 |
| `limit`  | 1~50                                    | 20   |
| `cursor` | rank 커서                               | –    |

200 `{ asOf, window, items: [TrendRow], nextCursor }`

```json
{
  "rank": 1,
  "prevRank": 4,
  "isNew": false,
  "repo": {
    "id": 77,
    "fullName": "someone/claude-hooks",
    "description": "…",
    "stars": 342,
    "pushedAt": "…",
    "sparkline7d": [2, 3, null, 5, 8, 12, 9]
  },
  "score": 1088.4,
  "gain": 40,
  "acceleration": 4.0,
  "spikePenalty": 1.0,
  "kinds": { "PLUGIN": 0, "SKILL": 2, "HOOK": 5 },
  "worstLevel": "CAUTION",
  "topItems": [
    {
      "id": 812,
      "kind": "HOOK",
      "name": "pre-pr-lint",
      "currentLevel": "CAUTION"
    }
  ]
}
```

- `rankDelta`는 클라이언트가 `prevRank − rank`로 계산(`isNew`면 NEW 표시). `repo.sparkline7d`는 기간(`window`)과 무관하게 항상 최근 7일.
- 쿼리 3회 고정(DATA-MODEL.md 5장). `topItems` ≤ 3, `worstLevel`은 저장소 Item 중 최악(미분석 제외).

### 3.3 항목 · 저장소 상세

| Method | Path                      | 캐시     | 응답 요약                                                                                                                                                         |
| ------ | ------------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/items/:id`          | `daily`  | `ItemDetail` (아래)                                                                                                                                               |
| GET    | `/api/items/:id/stars`    | `series` | `?days=30\|90\|180`(기본 90) → `{ repoId, series: [{ day, gain, total, source: 'SNAPSHOT' \| 'OFFICIAL' \| null }] }` — `gain: null` = 모름(차트에 끊김으로 표시) |
| GET    | `/api/repos/:owner/:name` | `daily`  | `{ repo, items: ItemCard[], trend: { D1, D7, D30: { score, rank } \| null }, marketplaces: [{ path, name, pluginCount }] }`                                       |

`:id`는 양의 정수(`z.coerce.number().int().positive()`), `:owner/:name`은 GitHub 이름 규칙 정규식(`^[A-Za-z0-9_.-]{1,100}$`)으로 검증 후 소문자 조회.

`ItemDetail`

```json
{
  "item": {
    "id": 812,
    "kind": "HOOK",
    "name": "pre-pr-lint",
    "path": "hooks/pre-pr",
    "description": "…",
    "sourceType": "IN_REPO",
    "components": {},
    "hasExternalMcp": false,
    "firstSeenAt": "…"
  },
  "repo": {
    "id": 77,
    "fullName": "someone/claude-hooks",
    "url": "https://github.com/someone/claude-hooks",
    "stars": 342,
    "pushedAt": "…",
    "defaultBranch": "main",
    "headSha": "9f2c…",
    "archived": false
  },
  "marketplaces": [
    { "repoFullName": "someone/claude-hooks", "name": "someone-hooks" }
  ],
  "security": {
    "status": "ANALYZED",
    "level": "CAUTION",
    "rawLevel": "DANGER",
    "ruleSetVersion": "1.0.0",
    "headSha": "9f2c…",
    "scannedAt": "…",
    "findings": [
      {
        "ruleId": "R04_NETWORK_SEND",
        "titleKo": "외부로 데이터 전송",
        "severity": "CAUTION",
        "filePath": "hooks/pre-pr/notify.sh",
        "line": 12,
        "excerpt": "curl -X POST https://hooks.slack.com/…",
        "fingerprint": "3b1f…",
        "suppressed": false,
        "override": null
      },
      {
        "ruleId": "R02_DESTRUCTIVE_RM",
        "titleKo": "위험한 삭제 명령",
        "severity": "DANGER",
        "filePath": "hooks/pre-pr/clean.sh",
        "line": 3,
        "excerpt": "rm -rf \"$BUILD_DIR\"/",
        "fingerprint": "a90c…",
        "suppressed": true,
        "override": {
          "reason": "BUILD_DIR는 2행에서 고정값으로 설정됨",
          "appealUrl": "https://github.com/…/issues/14",
          "createdAt": "…"
        }
      }
    ],
    "disclaimerKo": "규칙 기반 위험 신호 탐지 결과이며 안전을 보증하지 않습니다. …"
  },
  "summary": {
    "status": "OK",
    "summaryKo": "…",
    "useCasesKo": ["…"],
    "installCommands": [
      { "command": "/plugin install pre-pr-lint@someone-hooks", "warnings": [] }
    ],
    "requirementsKo": ["…"],
    "model": "claude-haiku-5-5",
    "generatedAt": "…"
  },
  "trend": {
    "D1": null,
    "D7": { "score": 1088.4, "rank": 1 },
    "D30": { "score": 402.1, "rank": 9 }
  }
}
```

- `security.status`가 `UNSUPPORTED`/`TOO_LARGE`/`ERROR`면 `level: null`, `findings: []` → UI "분석 불가". 검사 전이면 `security: null`.
- `summary`는 계약 뷰 `ai.v_item_summary_public`에서 읽음. 없으면 `null`(요약 생성 대기), `status: 'INSUFFICIENT'`면 "정보 부족".
- `installCommands[].warnings`: NestJS가 같은 규칙 엔진의 shell 규칙을 명령 문자열에 적용한 결과(ruleId 배열).
- 퍼머링크는 프론트가 `repo.url + /blob/{security.headSha}/{filePath}#L{line}`로 조립.

### 3.4 기타 공개

| Method | Path                  | 캐시     | 응답                                                                                                                                                  |
| ------ | --------------------- | -------- | ----------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/security/rules` | `static` | `{ ruleSetVersion, disclaimerKo, knownLimitsKo[], rules: [{ id, titleKo, descriptionKo, severities[], regions[] }] }` — 규칙 메타 상수에서 생성(SSOT) |
| GET    | `/api/stats/overview` | `static` | `{ asOf, counts: { PLUGIN, SKILL, HOOK }, trackedRepos, lastRun: { finishedAt, status } }`                                                            |
| GET    | `/health`             | no-store | `{ status: 'ok', db: 'ok' \| 'down', ai: 'ok' \| 'down' \| 'unknown' }` — DB `SELECT 1`, ai는 캐시된 마지막 상태(헬스체크가 FastAPI를 깨우지 않게)    |

---

## 4. 검색 (`Public`) — NestJS가 FastAPI로 프록시

| Method | Path                 | Throttle          | 캐시     | 요청(query)                                                                       | 응답                                                                                                                                       |
| ------ | -------------------- | ----------------- | -------- | --------------------------------------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/api/search`        | `search` 20/분/IP | `search` | `q`(1~~200자, trim 후 빈 문자열 400), `kind?`, `level?`, `limit?`(1~~10, 기본 10) | `{ query, degraded, indexVersion, items: [{ item: ItemCard, score, ranks: { bm25, vector }, snippetKo }] }`                                |
| GET    | `/api/search/answer` | `answer` 5/분/IP  | `search` | `q`, `kind?`, `level?`                                                            | `{ answerKo: string \| null, citedItemIds: number[], degraded, reason: null \| 'BUDGET_EXHAUSTED' \| 'NO_RESULTS' \| 'CITATION_INVALID' }` |

- 둘 다 GET — 엣지 캐시 가능하게(캐시 히트는 원본 레이트리밋·AI 예산을 소비하지 않음).
- `degraded: true` = 예산 소진으로 BM25만 사용. `ranks.vector`는 `null`.
- `snippetKo`: 매칭 근거로 보여줄 요약 문장 1개(LLM 생성 아님 — 저장된 요약에서 질의 토큰이 가장 많이 겹치는 문장).
- NestJS → FastAPI 타임아웃 8초. 초과/연결 실패는 503 `SEARCH_WARMING`, FastAPI 4xx/5xx는 503 `SEARCH_UNAVAILABLE`.

---

## 5. 내 북마크 (`Bearer`, 캐시 `no-store`)

| Method | Path                                     | 요청 / 응답                                                                                                                                                          |
| ------ | ---------------------------------------- | -------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/me/bookmarks`                      | `?cursor&limit(1~50)` → `{ items: [{ item: ItemCard, seenLevel, createdAt }], nextCursor }` (최근 저장순)                                                            |
| GET    | `/api/me/bookmarks/ids`                  | `{ itemIds: number[] }` — 공개 목록 화면의 북마크 표시용(최대 1000)                                                                                                  |
| PUT    | `/api/me/bookmarks/:itemId`              | 멱등. 없으면 생성(201), 있으면 200. `seenLevel = item.currentLevel`. 없는 항목 404                                                                                   |
| DELETE | `/api/me/bookmarks/:itemId`              | 204 (없어도 204)                                                                                                                                                     |
| GET    | `/api/me/bookmarks/security-changes`     | `{ items: [{ item: ItemCard, seenLevel, currentLevel, levelChangedAt, newFindings: [{ ruleId, titleKo, severity }] }] }` — `currentLevel IS DISTINCT FROM seenLevel` |
| POST   | `/api/me/bookmarks/security-changes/ack` | `{ itemIds?: number[] }`(생략 = 전부) → 204, `seenLevel = currentLevel`                                                                                              |

---

## 6. 관리자 (`ADMIN`, 캐시 `no-store`)

비-GET은 운영 환경 데모 관리자에게 403 `DEMO_READ_ONLY`.

### 6.1 수집

| Method | Path                            | 요청 / 응답                                                                                                                                                         |
| ------ | ------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| POST   | `/api/admin/ingestion/runs`     | `{ stages?: StageName[] }`(중복 불가, 빈 배열 = 전체) → 202 `{ runId, dispatched: boolean }`. 활성 실행 있으면 409 `RUN_ALREADY_ACTIVE`                             |
| GET    | `/api/admin/ingestion/runs`     | `?cursor&limit` → `[{ id, trigger, asOf, status, stages, startedAt, finishedAt, failureCount }]`                                                                    |
| GET    | `/api/admin/ingestion/runs/:id` | `{ run, stages: [{ stage, status, cursor, stats, error, startedAt, finishedAt }], failures: [{ stage, repoFullName, code, message, createdAt }] }`(실패 최근 100건) |

### 6.2 데이터 품질

| Method | Path                                 | 요청 / 응답                                                                                                                                                                                                                  |
| ------ | ------------------------------------ | ---------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/data-quality/summary`    | `{ openByKind: { STAR_SOURCE_MISMATCH: n, … }, lastRun: { id, status, ghCoreUsed, ghSearchUsed, ghCodeSearchUsed }, aiUsageToday: [{ pool, capUsd, spentUsd, reservedUsd, calls }], externalSource: { name, activeUntil } }` |
| GET    | `/api/admin/data-quality/issues`     | `?status(기본 OPEN)&kind&cursor&limit` → `[{ id, kind, repo: { id, fullName }, windowStart, windowEnd, values, diff, status, note, createdAt }]`                                                                             |
| PATCH  | `/api/admin/data-quality/issues/:id` | `{ status: 'RESOLVED' \| 'IGNORED', note(1~500) }` → 200                                                                                                                                                                     |

### 6.3 보안 예외 처리(Override)

| Method | Path                                       | 요청 / 응답                                                                                                                                                                                                                                         |
| ------ | ------------------------------------------ | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| GET    | `/api/admin/security/overrides`            | `?itemId&active(true\|false)&cursor` → `[{ id, item: { id, name }, ruleId, fingerprint, reason, appealUrl, createdBy, createdAt, revokedAt }]`                                                                                                      |
| POST   | `/api/admin/security/overrides`            | `{ itemId, fingerprint(64 hex), reason(10~500), appealUrl?(^https://github\.com/ 로 시작하는 URL) }` → 201 `{ override, item: { currentLevel, levelChangedAt } }`. 현재 검사에 없는 fingerprint 404 `FINDING_NOT_FOUND`, 중복 409 `OVERRIDE_EXISTS` |
| POST   | `/api/admin/security/overrides/:id/revoke` | `{ reason?(≤500) }` → 200 `{ override, item: { currentLevel } }`. 기록은 남는다(DELETE가 아닌 이유)                                                                                                                                                 |

- 생성·철회는 한 트랜잭션에서 Finding `suppressed` → 검사 `level` → 항목 `currentLevel`/`levelChangedAt`까지 갱신(ARCHITECTURE 6.4).

---

## 7. FastAPI 내부 API (`X-Internal-Token`, 상수 시간 비교)

브라우저에서 직접 호출하지 않는다. 호출자: NestJS 검색 프록시, 배치 `ai-sync` 단계.

| Method | Path                      | 요청                                                | 응답                                                                                                                                                         |
| ------ | ------------------------- | --------------------------------------------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| GET    | `/health`                 | (토큰 불필요)                                       | `{ status, db, indexVersion, docCount, kiwi: 'loaded' }`                                                                                                     |
| POST   | `/internal/search`        | `{ q, kind?, level?, limit }` (Pydantic, 같은 제약) | `{ query, degraded, indexVersion, items: [{ itemId, score, ranks: { bm25, vector }, snippetKo }] }` — NestJS가 `itemId`로 `ItemCard`를 1쿼리(`id IN`)로 채움 |
| POST   | `/internal/search/answer` | `{ q, kind?, level? }`                              | `{ answerKo, citedItemIds, degraded, reason }`                                                                                                               |
| POST   | `/internal/jobs/sync`     | `{ maxItems: 1~50 }`(기본 20)                       | `{ processed, insufficient, failed, remaining, budgetExhausted, indexVersion }` — 요약·임베딩·검색 문서 갱신 후 BM25 재구축                                  |

- 토큰 불일치 401(본문 없음). 배치 클라이언트: 타임아웃 120초, 재시도 3회(무료 티어 기상 대기), `remaining = 0` 또는 `budgetExhausted`까지 반복.
- FastAPI의 OpenAPI(`/docs`)는 운영에서 비활성(`docs_url=None`), 로컬에서만 노출.

---

## 8. 배치 CLI (참고 — HTTP 아님)

```
node dist/cli.js ingest [--as-of YYYY-MM-DD] [--run-id N] [--stages discover,qualify,…]
node dist/scripts/seed-admin.js          # idempotent
node dist/scripts/seed-awesome.js        # 1회 시드
```

종료 코드: 0 = SUCCEEDED/PARTIAL 또는 다른 실행이 락 보유 중, 1 = FAILED(Actions가 실패로 표시). 단계별 결과는 `ingestion_stage`와 표준출력(Pino JSON).
