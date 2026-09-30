-- Coupang AI Detail Maker - 데이터베이스 스키마 (PostgreSQL 17)
-- 근거: docs/7-erd.md v0.1.7 (2장 메인 ERD, 4장 테이블 정의, 5장 제약·인덱스, 6장 열거 값)
-- 문서 간 정합성 재점검(2026-09-30): 근거 ERD 버전과 범위 표기(2일 MVP → MVP)만 갱신했고 DDL은 바꾸지 않았다. ERD 4~6장과 대조해 컬럼·NULL·기본값·CHECK·인덱스 일치를 확인했다.
-- DEC-04: projects 카운트 CHECK는 하한(>= 0)만 둔다. 상한(3, 6)은 config 값의 조건부 UPDATE가 강제한다(ERD E-1).
-- 범위: M(MVP) 테이블 11개. S/W 테이블(payments, extension_tokens, plans, subscriptions)은
--       해당 기능 구현 때 새 마이그레이션으로 추가한다(ERD 3장, 구조 원칙 PP-10).
-- FK는 모두 기본값(NO ACTION)이다(ERD 5.4). gen_random_uuid()는 PostgreSQL 13+ 내장 함수다.

BEGIN;

-- 4.1 users
CREATE TABLE users (
    id             uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    email          text        NOT NULL UNIQUE,
    password_hash  text,                                   -- bcrypt. OAuth 전용 계정은 NULL
    email_verified boolean     NOT NULL DEFAULT false,     -- BR-04
    name           text,
    status         text        NOT NULL DEFAULT 'ACTIVE',
    created_at     timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT users_status_ck CHECK (status IN ('ACTIVE', 'SUSPENDED'))
);

-- 4.2 user_providers (실사용은 FR-02, S)
CREATE TABLE user_providers (
    user_id          uuid NOT NULL REFERENCES users (id),
    provider         text NOT NULL,
    provider_user_id text NOT NULL,
    PRIMARY KEY (provider, provider_user_id),
    CONSTRAINT user_providers_provider_ck CHECK (provider IN ('google', 'kakao', 'naver'))
);

-- 4.3 refresh_tokens (PRD 5.8)
CREATE TABLE refresh_tokens (
    jti         uuid        PRIMARY KEY,                   -- JWT jti 클레임
    user_id     uuid        NOT NULL REFERENCES users (id),
    family_id   uuid        NOT NULL,
    token_hash  text        NOT NULL UNIQUE,               -- SHA-256
    expires_at  timestamptz NOT NULL,
    revoked_at  timestamptz,
    replaced_by uuid,                                      -- 새 jti. 만료 행 삭제와 충돌하지 않도록 FK 없음
    created_at  timestamptz NOT NULL DEFAULT now()
);
CREATE INDEX refresh_tokens_user_id_idx   ON refresh_tokens (user_id);
CREATE INDEX refresh_tokens_family_id_idx ON refresh_tokens (family_id);

-- 4.4 credit_wallets (가입 TX에서 생성, BR-05)
CREATE TABLE credit_wallets (
    user_id              uuid    PRIMARY KEY REFERENCES users (id),
    subscription_balance integer NOT NULL DEFAULT 0,
    topup_balance        integer NOT NULL DEFAULT 0,
    CONSTRAINT credit_wallets_subscription_balance_ck CHECK (subscription_balance >= 0),  -- BR-14
    CONSTRAINT credit_wallets_topup_balance_ck        CHECK (topup_balance >= 0)
);

-- 4.6 projects
CREATE TABLE projects (
    id                    uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id               uuid        NOT NULL REFERENCES users (id),
    status                text        NOT NULL DEFAULT 'DRAFT',
    version               integer     NOT NULL DEFAULT 1,         -- 낙관적 잠금(BR-48)
    form                  jsonb       NOT NULL DEFAULT '{}',      -- productName, category, intro, toneGuide
    selected_usps         jsonb       NOT NULL DEFAULT '[]',
    draft_html            text,                                   -- 서버 전용(BR-32)
    final_html            text,                                   -- 퍼블리시 TX에서만 저장
    regen_count           integer     NOT NULL DEFAULT 0,
    ai_edit_count         integer     NOT NULL DEFAULT 0,
    ai_edit_fail_count    integer     NOT NULL DEFAULT 0,
    analyze_count         integer     NOT NULL DEFAULT 0,
    active_job_type       text,
    active_job_started_at timestamptz,
    published_at          timestamptz,
    created_at            timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT projects_status_ck CHECK (status IN ('DRAFT', 'ANALYZED', 'GENERATED', 'EDITING', 'PUBLISHED')),
    CONSTRAINT projects_active_job_type_ck CHECK (active_job_type IN ('ANALYZE', 'GENERATE', 'REGEN', 'AI_EDIT')),
    CONSTRAINT projects_version_ck CHECK (version >= 1),
    -- 상한값(D-5, D-20, D-27)은 CHECK에 두지 않는다(ERD E-1, DEC-04)
    CONSTRAINT projects_regen_count_ck        CHECK (regen_count >= 0),
    CONSTRAINT projects_analyze_count_ck      CHECK (analyze_count >= 0),
    CONSTRAINT projects_ai_edit_count_ck      CHECK (ai_edit_count >= 0),
    CONSTRAINT projects_ai_edit_fail_count_ck CHECK (ai_edit_fail_count >= 0),
    CONSTRAINT projects_active_job_pair_ck CHECK ((active_job_type IS NULL) = (active_job_started_at IS NULL)),
    CONSTRAINT projects_published_ck CHECK (status <> 'PUBLISHED' OR (final_html IS NOT NULL AND published_at IS NOT NULL))
);
CREATE INDEX projects_user_id_idx ON projects (user_id);

-- 4.5 credit_ledger (불변 원장)
CREATE TABLE credit_ledger (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id    uuid        NOT NULL REFERENCES users (id),
    project_id uuid        REFERENCES projects (id),              -- DEDUCT에만 채움
    delta      integer     NOT NULL,
    reason     text        NOT NULL,
    source     text        NOT NULL,
    pg_tx_id   text        UNIQUE,                                -- 운영자 지급은 NULL(NULL은 중복 허용)
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT credit_ledger_reason_ck CHECK (reason IN ('PURCHASE', 'GRANT', 'EXPIRE', 'DEDUCT', 'REFUND')),
    CONSTRAINT credit_ledger_source_ck CHECK (source IN ('SUBSCRIPTION', 'TOPUP')),
    CONSTRAINT credit_ledger_deduct_project_ck CHECK (reason <> 'DEDUCT' OR project_id IS NOT NULL)
);
-- 프로젝트당 DEDUCT 1건(멱등성, BR-13)
CREATE UNIQUE INDEX credit_ledger_project_deduct_uq ON credit_ledger (project_id) WHERE reason = 'DEDUCT';

-- 4.7 assets
CREATE TABLE assets (
    id           uuid    PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id   uuid    NOT NULL REFERENCES projects (id),
    original_key text    NOT NULL,                                -- 비공개 버킷. 응답 금지
    preview_key  text    NOT NULL,                                -- 비공개 버킷, 390px 워터마크 사본
    public_key   text,                                            -- 퍼블리시 커밋 뒤 복사. NULL이면 미완료
    mime         text    NOT NULL,
    size         integer NOT NULL
);
CREATE INDEX assets_project_id_idx ON assets (project_id);

-- 4.8 analysis_results (프로젝트당 1행, 크롤링 원문 컬럼 없음 BR-22)
CREATE TABLE analysis_results (
    project_id     uuid        PRIMARY KEY REFERENCES projects (id),
    source_url     text        NOT NULL,
    usp_candidates jsonb       NOT NULL,
    analyzed_at    timestamptz NOT NULL DEFAULT now()
);

-- 4.9 edit_operations
CREATE TABLE edit_operations (
    id         uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    project_id uuid        NOT NULL REFERENCES projects (id),
    type       text        NOT NULL,
    block_id   text        NOT NULL,
    payload    jsonb       NOT NULL,
    created_at timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT edit_operations_type_ck CHECK (type IN ('MANUAL', 'AI'))
);

-- 4.10 publish_records
CREATE TABLE publish_records (
    project_id       uuid        PRIMARY KEY REFERENCES projects (id),
    final_html_hash  text        NOT NULL,
    inject_status    text        NOT NULL DEFAULT 'PENDING',
    last_reported_at timestamptz,
    CONSTRAINT publish_records_inject_status_ck CHECK (inject_status IN ('PENDING', 'INJECTED', 'FAILED'))
);

-- 4.11 llm_usage_logs (실패 호출도 기록)
CREATE TABLE llm_usage_logs (
    id            uuid        PRIMARY KEY DEFAULT gen_random_uuid(),
    user_id       uuid        NOT NULL REFERENCES users (id),
    project_id    uuid        REFERENCES projects (id),
    role          text        NOT NULL,
    provider      text        NOT NULL,
    model_id      text        NOT NULL,
    tokens_in     integer,
    tokens_out    integer,
    cached        boolean     NOT NULL DEFAULT false,
    latency_ms    integer     NOT NULL,
    cost_estimate numeric,
    success       boolean     NOT NULL,
    created_at    timestamptz NOT NULL DEFAULT now(),
    CONSTRAINT llm_usage_logs_role_ck CHECK (role IN ('LIGHT', 'MAIN'))
);
-- 계정 일일 상한 집계(FR-29)
CREATE INDEX llm_usage_logs_user_id_created_at_idx ON llm_usage_logs (user_id, created_at);

COMMIT;
