-- 002: AI 이미지 변환 횟수, 작업 종류·LLM role 허용값, 에셋 정렬
ALTER TABLE projects ADD COLUMN ai_image_count integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD CONSTRAINT projects_ai_image_count_ck CHECK (ai_image_count >= 0);
ALTER TABLE projects DROP CONSTRAINT projects_active_job_type_ck;
ALTER TABLE projects ADD CONSTRAINT projects_active_job_type_ck
    CHECK (active_job_type IN ('ANALYZE', 'GENERATE', 'REGEN', 'AI_EDIT', 'AI_IMAGE'));
ALTER TABLE llm_usage_logs DROP CONSTRAINT llm_usage_logs_role_ck;
ALTER TABLE llm_usage_logs ADD CONSTRAINT llm_usage_logs_role_ck CHECK (role IN ('LIGHT', 'MAIN', 'IMAGE'));
ALTER TABLE assets ADD COLUMN created_at timestamptz NOT NULL DEFAULT now();

