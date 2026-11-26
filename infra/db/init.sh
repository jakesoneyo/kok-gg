#!/bin/sh
# postgres 이미지의 /docker-entrypoint-initdb.d 훅: bootstrap.sql은 psql 변수가 필요해 .sql로 직접 못 둔다.
# compose와 Testcontainers가 같은 경로로 마운트해 로컬/CI/운영 권한 모델을 일치시킨다.
set -e
psql -v ON_ERROR_STOP=1 \
  -v app_password="${KOK_APP_PASSWORD:-kok_app}" \
  -v ai_password="${KOK_AI_PASSWORD:-kok_ai}" \
  -U "$POSTGRES_USER" -d "$POSTGRES_DB" -f /bootstrap/bootstrap.sql
