-- 003: 블록 재생성 횟수, 작업 종류 허용값
ALTER TABLE projects ADD COLUMN block_regen_count integer NOT NULL DEFAULT 0;
ALTER TABLE projects ADD CONSTRAINT projects_block_regen_count_ck CHECK (block_regen_count >= 0);
ALTER TABLE projects DROP CONSTRAINT projects_active_job_type_ck;
ALTER TABLE projects ADD CONSTRAINT projects_active_job_type_ck
    CHECK (active_job_type IN ('ANALYZE', 'GENERATE', 'REGEN', 'AI_EDIT', 'AI_IMAGE', 'BLOCK_REGEN'));

