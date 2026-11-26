-- 계약 뷰 컬럼 검사(CI migrations-coexist): NestJS가 읽는 뷰의 컬럼이 DATA-MODEL.md 4장과 일치해야 한다.
-- 컬럼 "추가"는 허용(뷰는 expand-only)이라 필수 컬럼이 모두 존재하는지만 본다. 실패 시 예외로 psql이 비정상 종료.
DO $$
DECLARE
  missing text;
BEGIN
  SELECT string_agg(v.view_name || '.' || v.col, ', ') INTO missing
  FROM (VALUES
    ('v_item_summary_public', 'item_id'), ('v_item_summary_public', 'status'),
    ('v_item_summary_public', 'summary_ko'), ('v_item_summary_public', 'use_cases_ko'),
    ('v_item_summary_public', 'install_commands'), ('v_item_summary_public', 'requirements_ko'),
    ('v_item_summary_public', 'model'), ('v_item_summary_public', 'generated_at'),
    ('v_ai_usage_daily', 'day'), ('v_ai_usage_daily', 'pool'), ('v_ai_usage_daily', 'cap_micros'),
    ('v_ai_usage_daily', 'spent_micros'), ('v_ai_usage_daily', 'reserved_micros'),
    ('v_ai_usage_daily', 'input_tokens'), ('v_ai_usage_daily', 'output_tokens'), ('v_ai_usage_daily', 'calls')
  ) AS v(view_name, col)
  WHERE NOT EXISTS (
    SELECT 1 FROM information_schema.columns c
    WHERE c.table_schema = 'ai' AND c.table_name = v.view_name AND c.column_name = v.col
  );
  IF missing IS NOT NULL THEN
    RAISE EXCEPTION '계약 뷰 컬럼 누락: %', missing;
  END IF;
END $$;
