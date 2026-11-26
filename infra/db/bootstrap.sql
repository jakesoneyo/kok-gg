-- DB 소유자(슈퍼유저)가 1회 실행: psql -v app_password=... -v ai_password=... -f bootstrap.sql
-- 롤은 클러스터 전역이라 같은 클러스터의 두 번째 DB(CI 역순 검증 등)에서도 재실행 가능하도록 \gexec로 "없을 때만" 만든다.
-- 쓰기 소유권(kok_app=public, kok_ai=ai)을 DB 권한으로 강제하는 것이 이 파일의 목적(DATA-MODEL.md 1·7장).
SELECT format('CREATE ROLE kok_app LOGIN PASSWORD %L', :'app_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kok_app') \gexec
SELECT format('CREATE ROLE kok_ai LOGIN PASSWORD %L', :'ai_password')
 WHERE NOT EXISTS (SELECT 1 FROM pg_roles WHERE rolname = 'kok_ai') \gexec

CREATE EXTENSION IF NOT EXISTS vector; -- Neon: 확장 생성 권한 있는 롤로 실행 [미검증: 콘솔 생성 롤 권한]
CREATE SCHEMA IF NOT EXISTS ai AUTHORIZATION kok_ai;

-- public: kok_app이 소유·마이그레이션
GRANT USAGE, CREATE ON SCHEMA public TO kok_app;
REVOKE CREATE ON SCHEMA public FROM PUBLIC;

-- kok_ai의 public 3개 테이블 SELECT는 테이블이 생긴 뒤여야 하므로 Prisma 마이그레이션(grants)이 건다.
GRANT USAGE ON SCHEMA public TO kok_ai;
GRANT USAGE ON SCHEMA ai TO kok_app; -- 뷰 접근용(테이블 SELECT 권한은 없음)
