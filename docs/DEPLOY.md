# DEPLOY — Phase 1 (Neon + Render + Vercel + GitHub Actions)

무료 티어 기준 배포 체크리스트. 구성·근거는 [ARCHITECTURE.md 12장](../ARCHITECTURE.md). 값(시크릿)은 이 문서·저장소에 쓰지 않고 각 플랫폼 시크릿에만 넣는다.
**배포 승인 게이트**: 6단계에서 라이브 미리보기와 리뷰 요약으로 최종 승인을 받은 뒤 규모를 키우고 크론을 켠다.

## 0. 준비물

- 키: Anthropic API, Voyage AI, GitHub fine-grained PAT(공개 저장소 읽기 전용, 수집용)
- 값 3개를 미리 정한다: `INTERNAL_API_TOKEN`(긴 랜덤, backend·ai·Actions 동일), `KOK_APP_PASSWORD`, `KOK_AI_PASSWORD`(DB 롤 비밀번호)

## 1. Neon DB

1. 프로젝트 생성(리전 `aws-ap-southeast-1` — Render `singapore`와 맞춤), DB 1개.
2. 소유자 롤로 `infra/db/bootstrap.sql` **1회** 실행(롤·`ai` 스키마·pgvector·권한):
   ```bash
   psql "$NEON_OWNER_DIRECT_URL" -v ON_ERROR_STOP=1 \
     -v app_password="$KOK_APP_PASSWORD" -v ai_password="$KOK_AI_PASSWORD" \
     -f infra/db/bootstrap.sql
   ```
   (`CREATE EXTENSION vector` 권한 오류가 나면 Neon 콘솔에서 확장을 먼저 켠다.)
3. 접속 문자열을 정리한다(비밀번호는 위 두 값):
   - `DATABASE_URL` = `kok_app` + **풀러** 호스트(`-pooler`) + `?sslmode=require`
   - `DIRECT_URL` = `kok_app` + **직결** 호스트 + `?sslmode=require` (마이그레이션·배치 advisory lock용, 풀러 불가)
   - `AI_DATABASE_URL` = `postgresql+psycopg://kok_ai:…@<직결 호스트>/<db>?sslmode=require`

## 2. 마이그레이션 + 데모 계정 시드 (로컬에서 1회)

두 도구는 서로 다른 스키마만 관리해 순서와 무관하게 적용된다(CI `migrations-coexist`가 양쪽 순서를 검증). 첫 배포는 아래 순서로 한다.

```bash
# public 스키마 (Prisma, kok_app)
cd backend && npm ci && DIRECT_URL="$DIRECT_URL" npx prisma migrate deploy
# ai 스키마 (Alembic, kok_ai)
cd ../ai && pip install -e . && AI_DATABASE_URL="$AI_DATABASE_URL" alembic upgrade head
# 데모 계정 admin/admin (이미 있으면 건너뜀)
cd ../backend && DATABASE_URL="$DIRECT_URL" npm run seed:admin
```

이후 서비스는 기동 시 각자 `prisma migrate deploy` / `alembic upgrade head`를 다시 실행한다(멱등).

> `npm run seed:fixtures`(가짜 저장소 10개)는 **운영에 쓰지 않는다**. 로컬·CI 전용.

## 3. Render (Blueprint)

1. Render → New → Blueprint → 이 저장소 선택 → `render.yaml` 적용(`kok-gg-backend`, `kok-gg-ai`, 무료 플랜).
2. `sync: false` 항목을 대시보드에서 입력:

| 서비스         | 변수                                                                                                                                                    |
| -------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------- |
| backend        | `DATABASE_URL` · `DIRECT_URL` · `CORS_ORIGINS`(= Vercel 오리진, 예 `https://kok-gg.vercel.app`) · `AI_BASE_URL`(= ai 서비스 URL) · `INTERNAL_API_TOKEN` |
| backend (선택) | `GH_DISPATCH_TOKEN`(Actions 쓰기 PAT) — 관리자 콘솔 수동 실행용                                                                                         |
| ai             | `AI_DATABASE_URL` · `INTERNAL_API_TOKEN` · `ANTHROPIC_API_KEY` · `VOYAGE_API_KEY`                                                                       |

3. `render.yaml`로 이미 고정된 값 확인: `DEMO_ADMIN_READONLY=true`, `TRUST_PROXY=1`, `NODE_ENV=production`, ai `APP_ENV=production`·`PORT=8000`.
4. 수동 Deploy(자동 배포는 꺼 둠). 무료 플랜은 15분 무활동 시 슬립, 기동 ~1분.

## 4. Vercel (프론트)

`frontend/vercel.json`은 SPA 라우팅 rewrite(`/(.*)` → `/index.html`)만 가진다. 빌드는 Vite 프리셋이 자동 감지(`npm run build` → `dist`).

1. Import 저장소, **Root Directory = `frontend`**.
2. 환경변수(Production):
   - `VITE_API_BASE_URL` = backend 서비스 URL(프리픽스 `/api`는 코드가 붙임)
   - `VITE_DEMO_ADMIN_READONLY` = `true` (서버 값과 동일 — 데모 admin의 변경 버튼 비활성)
   - `VITE_ISSUES_REPO` = `jakesoneyo/kok-gg` (기본값과 같아 생략 가능)
3. 배포 후 오리진을 backend `CORS_ORIGINS`에 반영(없으면 브라우저 호출이 막힘) → backend 재배포.

## 5. GHCR 이미지 + GitHub Actions 수집 배치

1. `Publish backend image` 워크플로를 **수동 실행**(Actions 탭 → Run workflow). 저장소 변수 `PUBLISH_IMAGE=true`를 켜면 `backend/**` 푸시마다 자동 게시. 결과: `ghcr.io/jakesoneyo/kok-gg-backend:latest`(API 서버와 배치가 같은 이미지).
2. 첫 게시 후 패키지가 저장소(`kok-gg`)와 연결됐는지 확인(워크플로가 `org.opencontainers.image.source` 라벨을 달아 자동 연결). `ingest.yml`의 `GITHUB_TOKEN`(packages: read)이 pull 한다.
3. Settings → Secrets and variables → Actions:
   - **Secrets**: `INGEST_GH_TOKEN` · `DATABASE_URL` · `DIRECT_URL` · `AI_BASE_URL` · `INTERNAL_API_TOKEN`
   - **Variables**(선택): `MAX_TRACKED_REPOS`(첫 실행은 `50`으로 작게) · `MAX_ITEMS_PER_REPO` · `INGEST_CORE_RESERVE` · `EXTERNAL_STAR_SOURCE`(기본 `none`) · `EXTERNAL_STAR_SOURCE_UNTIL`
   - 시크릿 이름이 `INGEST_GH_TOKEN`인 이유: Actions는 `GITHUB_` 접두어 시크릿을 허용하지 않는다(워크플로가 컨테이너 안에서 `GITHUB_TOKEN_INGEST`로 변환).

## 6. 라이브 스모크 → 첫 수집 → 승인 → 크론

외부 API는 키가 생긴 뒤에만. 모두 옵트인이라 평소 CI·로컬 테스트는 외부 호출 0건이다.

```bash
# GitHub 실응답 캡처·계약 확인 (ARCHITECTURE의 [미검증] 해소 → 픽스처 커밋)
cd backend && GITHUB_LIVE_TOKEN="<PAT>" npx jest --config ./test/jest-e2e.json github-live
# Voyage·Claude 계약 확인
cd ai && KOK_LIVE_SMOKE=1 ANTHROPIC_API_KEY=… VOYAGE_API_KEY=… pytest tests/test_live_smoke.py
```

1. 첫 수집(소규모): Actions → Ingest → Run workflow(입력 비움) 또는 `gh workflow run ingest.yml`. 완주 확인: 로그의 단계별 DONE, 관리자 콘솔 실행 목록.
2. 즉시 한 번 더 실행 → 외부 호출 최소·행 수 불변(멱등) 확인.
3. 데모 북마크 복원: `cd backend && DATABASE_URL="$DIRECT_URL" npm run seed:demo-reset` (실데이터가 생긴 뒤 — 북마크 3개 + 등급 변경 1건).
4. 검색 평가: `ai/evals/search_eval.yaml`의 `relevant` 라벨을 실데이터 기준으로 채운 뒤 지표를 README에 기록(아래 "남은 작업").
5. **승인 게이트**: 라이브 URL·리뷰 요약을 보고 승인 → `MAX_TRACKED_REPOS` 상향. 크론(`0 18 * * *` UTC)은 워크플로가 기본 브랜치에 있으면 자동으로 돈다(끄려면 Actions에서 Ingest 워크플로 Disable).

## 7. 배포 후 점검

- [ ] `curl https://<backend>/health` → `{"status":"ok","db":"ok",…}` (슬립이면 첫 응답 ~1분)
- [ ] `curl https://<ai>/health` → 200 (ai `/docs`는 404여야 함)
- [ ] 프론트에서 `회원가입 없이 둘러보기` 1클릭 → 트렌딩·카탈로그·상세 위험 신호·검색 답변·북마크 변경 탭·관리자 대시보드
- [ ] 읽기 전용: 데모 admin 토큰으로 관리자 변경 API가 403
  ```bash
  TOKEN=$(curl -s -X POST https://<backend>/api/auth/login -H 'content-type: application/json' \
    -d '{"email":"admin","password":"admin"}' | jq -r .accessToken)
  curl -i -X POST https://<backend>/api/admin/ingestion/runs -H "authorization: Bearer $TOKEN" \
    -H 'content-type: application/json' -d '{}'   # 403 DEMO_READ_ONLY
  ```
- [ ] 프론트 도메인이 아닌 오리진의 CORS 요청 거부
- [ ] 비밀값이 로그·저장소에 없음, ai `/internal/*`은 토큰 없이 401

## 8. 운영 메모

- 데모 방문자가 북마크를 쌓으므로 주기적으로 `npm run seed:demo-reset`(데모 계정의 북마크만 초기화).
- Render 무료는 워크스페이스당 월 750시간 — 소진되면 월말까지 정지(README 한계에 명시). 공개 런칭은 Phase 2(AWS) 이후 권장(PLAN C8).

## 남은 작업 (키·승인 필요)

- Neon·Render·Vercel 프로비저닝, GHCR 첫 게시, Actions 시크릿 등록
- 라이브 스모크 2종(GitHub·Voyage/Claude), 첫 수집 완주·멱등 확인
- 검색 평가 정답 라벨(`ai/evals/search_eval.yaml`)과 지표 표(BM25 / 벡터 / 하이브리드 / +재순위 Recall@10·MRR) — 실데이터 색인과 Voyage 키 필요
- C7 요약 모델 평가 결과 반영 후 `SUMMARY_MODEL`·`ANSWER_MODEL` 확정
- 스크린샷·데모 GIF, 라이브 URL을 README에 반영
