BEGIN;

CREATE TABLE ai.alembic_version (
    version_num VARCHAR(32) NOT NULL, 
    CONSTRAINT alembic_version_pkc PRIMARY KEY (version_num)
);

-- Running upgrade  -> 0001

CREATE TABLE ai.item_summary (
  item_id              integer PRIMARY KEY,                -- public.item.id 논리 참조(FK 없음)
  source_sha256        char(64)    NOT NULL,               -- 재요약 판단 키
  prompt_version       integer     NOT NULL,
  model                text        NOT NULL,
  status               text        NOT NULL CHECK (status IN ('OK','INSUFFICIENT','FAILED')),
  summary_ko           text,
  use_cases_ko         jsonb       NOT NULL DEFAULT '[]',
  install_commands     jsonb       NOT NULL DEFAULT '[]',  -- 검증 통과한 원문 인용만
  requirements_ko      jsonb       NOT NULL DEFAULT '[]',
  rejected_quote_count integer     NOT NULL DEFAULT 0,
  input_tokens         integer,
  output_tokens        integer,
  error                text,
  generated_at         timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.item_embedding (
  item_id      integer PRIMARY KEY,
  input_sha256 char(64)     NOT NULL,                      -- 임베딩 입력(이름+설명+요약+원문 앞부분) 해시
  model        text         NOT NULL,
  embedding    vector(1024) NOT NULL,                      -- voyage-4 기본 차원
  updated_at   timestamptz  NOT NULL DEFAULT now()
);

CREATE INDEX item_embedding_hnsw ON ai.item_embedding USING hnsw (embedding vector_cosine_ops);

CREATE TABLE ai.search_doc (                               -- BM25 인메모리 인덱스의 원천
  item_id      integer PRIMARY KEY,
  tokens       text[]      NOT NULL,                       -- Kiwi 토큰(소문자, 품사 필터 후)
  input_sha256 char(64)    NOT NULL,
  updated_at   timestamptz NOT NULL DEFAULT now()
);

CREATE TABLE ai.index_meta (                               -- 단일 행: 캐시 키에 들어가는 인덱스 버전
  id            smallint PRIMARY KEY CHECK (id = 1),
  index_version bigint      NOT NULL DEFAULT 0,
  rebuilt_at    timestamptz
);

CREATE TABLE ai.search_cache (
  cache_key     char(64)    PRIMARY KEY,                   -- sha256(kind|q_norm|filters|index_version)
  kind          text        NOT NULL CHECK (kind IN ('SEARCH','ANSWER')),
  query_norm    text        NOT NULL,
  filters       jsonb       NOT NULL DEFAULT '{}',
  index_version bigint      NOT NULL,
  result        jsonb       NOT NULL,
  created_at    timestamptz NOT NULL DEFAULT now(),
  expires_at    timestamptz NOT NULL
);

CREATE INDEX search_cache_expires ON ai.search_cache (expires_at);

CREATE TABLE ai.budget_day (
  day             date   NOT NULL,
  pool            text   NOT NULL CHECK (pool IN ('SUMMARY','SEARCH','ANSWER')),
  cap_micros      bigint NOT NULL,                         -- 1 USD = 1,000,000
  reserved_micros bigint NOT NULL DEFAULT 0 CHECK (reserved_micros >= 0),
  spent_micros    bigint NOT NULL DEFAULT 0 CHECK (spent_micros >= 0),
  PRIMARY KEY (day, pool),
  CHECK (spent_micros + reserved_micros <= cap_micros)     -- 이중 안전장치: 코드 버그가 있어도 DB가 초과를 거부
);

CREATE TABLE ai.usage_ledger (
  id            bigserial   PRIMARY KEY,
  day           date        NOT NULL,
  pool          text        NOT NULL,
  provider      text        NOT NULL CHECK (provider IN ('anthropic','voyage')),
  model         text        NOT NULL,
  purpose       text        NOT NULL,                      -- 'summary' | 'embed_doc' | 'embed_query' | 'rerank' | 'answer'
  input_tokens  integer     NOT NULL DEFAULT 0,
  output_tokens integer     NOT NULL DEFAULT 0,
  cost_micros   bigint      NOT NULL,
  item_id       integer,
  created_at    timestamptz NOT NULL DEFAULT now()
);

CREATE INDEX usage_ledger_day_pool ON ai.usage_ledger (day, pool);

-- ── NestJS가 읽는 계약 뷰(컬럼 추가만 허용, 변경·삭제는 _v2 신설) ──
CREATE VIEW ai.v_item_summary_public AS
  SELECT item_id, status, summary_ko, use_cases_ko, install_commands, requirements_ko, model, generated_at
    FROM ai.item_summary;

CREATE VIEW ai.v_ai_usage_daily AS
  SELECT b.day, b.pool, b.cap_micros, b.spent_micros, b.reserved_micros,
         COALESCE(SUM(l.input_tokens), 0)  AS input_tokens,
         COALESCE(SUM(l.output_tokens), 0) AS output_tokens,
         COUNT(l.id)                       AS calls
    FROM ai.budget_day b
    LEFT JOIN ai.usage_ledger l ON l.day = b.day AND l.pool = b.pool
   GROUP BY b.day, b.pool, b.cap_micros, b.spent_micros, b.reserved_micros;

GRANT SELECT ON ai.v_item_summary_public, ai.v_ai_usage_daily TO kok_app;

INSERT INTO ai.alembic_version (version_num) VALUES ('0001') RETURNING ai.alembic_version.version_num;

COMMIT;

