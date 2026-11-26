-- FastAPI(kok_ai)가 읽는 public 테이블 3개만 SELECT 허용(DATA-MODEL.md 7장). 쓰기·그 외 테이블은 권한 없음 — IT-12가 증명.
-- Prisma가 만드는 테이블이므로 권한도 이 마이그레이션이 소유한다(bootstrap.sql은 테이블이 생기기 전에 실행됨).
GRANT SELECT ON public.item, public.repo, public.item_source_doc TO kok_ai;
