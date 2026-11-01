-- Admission test with AI proctoring and an HQ report (docs: README "Admission tests").
-- A teacher builds a test from questions of their own Assignments / Online tests (snapshotted) plus an HQ section,
-- launches it for a candidate on a device where they are signed in, and reads a server-computed report.
-- Separate from the Pravesh admissions CRM (schema `admission`): these tables live in `public` with an
-- `admission_` prefix and every row carries org_code.

CREATE TABLE IF NOT EXISTS public.admission_tests (
    test_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL,
    title VARCHAR(300) NOT NULL,
    grade_applying VARCHAR(64) NOT NULL,
    instructions TEXT,
    duration_minutes INT NOT NULL DEFAULT 60 CHECK (duration_minutes BETWEEN 5 AND 300),
    sections JSONB NOT NULL DEFAULT '[]'::jsonb,           -- [{key, title, kind: ACADEMIC|APTITUDE|LANGUAGE|HQ}]
    shuffle JSONB NOT NULL DEFAULT '{"questions": true, "options": true}'::jsonb,
    proctoring_config JSONB NOT NULL DEFAULT '{}'::jsonb,  -- preset + per-rule toggles
    scoring_config JSONB NOT NULL DEFAULT '{}'::jsonb,     -- weights + cut-offs
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED', 'ARCHIVED')),
    created_by VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code),
    published_at TIMESTAMPTZ,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_tests_org ON public.admission_tests(org_code, status);
CREATE INDEX IF NOT EXISTS idx_adm_tests_owner ON public.admission_tests(created_by);

CREATE TABLE IF NOT EXISTS public.admission_questions (
    question_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES public.admission_tests(test_id) ON DELETE CASCADE,
    section VARCHAR(32) NOT NULL,
    qtype VARCHAR(16) NOT NULL CHECK (qtype IN ('MCQ', 'MULTI', 'NUMERICAL', 'SHORT', 'DESCRIPTIVE', 'SJT', 'REFLECTIVE', 'IDEAS')),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer_key JSONB,                                      -- never sent to candidates
    rubric JSONB NOT NULL DEFAULT '[]'::jsonb,             -- [{criterion, marks}]
    model_answer TEXT,
    marks NUMERIC(6, 2) NOT NULL DEFAULT 1 CHECK (marks >= 0),
    topic VARCHAR(200),
    difficulty VARCHAR(16) CHECK (difficulty IS NULL OR difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    hq_dimension VARCHAR(4) CHECK (hq_dimension IS NULL OR hq_dimension IN ('IQ', 'EQ', 'SQ', 'AQ', 'CQ')),
    origin VARCHAR(16) NOT NULL CHECK (origin IN ('IMPORTED', 'HQ_BANK', 'AI_DRAFT', 'MANUAL')),
    source_eval_test_id UUID REFERENCES public.evaluation_tests(eval_test_id) ON DELETE SET NULL,
    source_master_q_id UUID REFERENCES public.evaluation_master_questions(master_q_id) ON DELETE SET NULL,
    source_label VARCHAR(400),                             -- "Physics · Light – Unit Test 2"
    hq_item_id VARCHAR(40),
    status VARCHAR(16) NOT NULL DEFAULT 'APPROVED' CHECK (status IN ('DRAFT', 'APPROVED')),
    display_order INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_questions_test ON public.admission_questions(test_id, display_order);

CREATE TABLE IF NOT EXISTS public.admission_hq_bank (
    item_id VARCHAR(40) PRIMARY KEY,
    age_band VARCHAR(8) NOT NULL,
    qtype VARCHAR(16) NOT NULL CHECK (qtype IN ('SJT', 'REFLECTIVE', 'IDEAS')),
    prompt TEXT NOT NULL,
    options JSONB NOT NULL DEFAULT '[]'::jsonb,
    answer_key JSONB,
    hq_dimension VARCHAR(4) NOT NULL
);

CREATE TABLE IF NOT EXISTS public.admission_candidates (
    candidate_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL,
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(254),
    phone VARCHAR(32),
    dob DATE NOT NULL,
    grade_applying VARCHAR(64) NOT NULL,
    guardian_name VARCHAR(200),
    guardian_email VARCHAR(254),
    guardian_phone VARCHAR(32),
    accommodations JSONB NOT NULL DEFAULT '{}'::jsonb,     -- {extra_time_minutes, disable_voice_flag}
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_candidates_org ON public.admission_candidates(org_code, created_by);

CREATE TABLE IF NOT EXISTS public.admission_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    test_id UUID NOT NULL REFERENCES public.admission_tests(test_id) ON DELETE CASCADE,
    candidate_id UUID NOT NULL REFERENCES public.admission_candidates(candidate_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    launched_by VARCHAR(64) NOT NULL,
    exam_token_hash CHAR(64) UNIQUE,                       -- SHA-256 of the one-time exam token
    token_expires_at TIMESTAMPTZ,
    device_id VARCHAR(64),
    status VARCHAR(16) NOT NULL DEFAULT 'LAUNCHED'
        CHECK (status IN ('LAUNCHED', 'CONFIRMED', 'CHECKED', 'IN_PROGRESS', 'SUBMITTED', 'ENDED', 'LOCKED')),
    dob_attempts INT NOT NULL DEFAULT 0,
    consent_at TIMESTAMPTZ,
    consent_version VARCHAR(16),
    guardian_consent JSONB,                                -- {guardian_name, relationship, method, confirmed_by, confirmed_at}
    id_photo_key TEXT,
    client_info JSONB NOT NULL DEFAULT '{}'::jsonb,        -- system check + environment
    question_order JSONB,                                  -- [{question_id, options: [original indices]}]
    seed BIGINT,
    started_at TIMESTAMPTZ,
    deadline_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    submit_reason VARCHAR(20) CHECK (submit_reason IS NULL OR submit_reason IN ('MANUAL', 'TIME_UP', 'AUTO_VIOLATION', 'ENDED_BY_TEACHER')),
    warnings_count INT NOT NULL DEFAULT 0,
    critical_count INT NOT NULL DEFAULT 0,
    integrity_score INT NOT NULL DEFAULT 100,
    integrity_band VARCHAR(16) NOT NULL DEFAULT 'High',
    last_heartbeat_at TIMESTAMPTZ,
    last_status JSONB NOT NULL DEFAULT '{}'::jsonb,        -- latest heartbeat: fullscreen, visible, faces, camera, screen, online
    active_page_id VARCHAR(64),
    page_seen_at TIMESTAMPTZ,                              -- last request from the active page (second-tab lock)
    page_claims INT NOT NULL DEFAULT 0,
    paused JSONB,
    launched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_sessions_org ON public.admission_sessions(org_code, status);
CREATE INDEX IF NOT EXISTS idx_adm_sessions_launcher ON public.admission_sessions(launched_by, status);
CREATE INDEX IF NOT EXISTS idx_adm_sessions_test ON public.admission_sessions(test_id);
-- at most one open session per (test, candidate)
CREATE UNIQUE INDEX IF NOT EXISTS uq_adm_session_open ON public.admission_sessions(test_id, candidate_id)
    WHERE status IN ('LAUNCHED', 'CONFIRMED', 'CHECKED', 'IN_PROGRESS', 'LOCKED');

CREATE TABLE IF NOT EXISTS public.admission_answers (
    session_id UUID NOT NULL REFERENCES public.admission_sessions(session_id) ON DELETE CASCADE,
    question_id UUID NOT NULL REFERENCES public.admission_questions(question_id) ON DELETE CASCADE,
    answer JSONB,
    saved_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    time_spent_ms BIGINT NOT NULL DEFAULT 0,
    auto_score NUMERIC(6, 2),
    ai_score NUMERIC(6, 2),
    ai_result JSONB,
    final_score NUMERIC(6, 2),
    PRIMARY KEY (session_id, question_id)
);

-- Append-only: rows are inserted, never updated except to attach an evidence key or purge details after retention.
CREATE TABLE IF NOT EXISTS public.admission_proctor_events (
    event_id BIGSERIAL PRIMARY KEY,
    session_id UUID NOT NULL REFERENCES public.admission_sessions(session_id) ON DELETE CASCADE,
    seq INT,                                               -- client sequence (NULL for server-raised events)
    code VARCHAR(32) NOT NULL,
    severity VARCHAR(8) NOT NULL,
    points NUMERIC(6, 2) NOT NULL DEFAULT 0,
    client_ts TIMESTAMPTZ,
    server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms BIGINT NOT NULL DEFAULT 0,
    confidence NUMERIC(4, 3),
    details JSONB,
    evidence_key TEXT,
    calibration BOOLEAN NOT NULL DEFAULT FALSE,
    UNIQUE (session_id, seq)
);
CREATE INDEX IF NOT EXISTS idx_adm_events_session ON public.admission_proctor_events(session_id, server_ts);

CREATE TABLE IF NOT EXISTS public.admission_reports (
    session_id UUID PRIMARY KEY REFERENCES public.admission_sessions(session_id) ON DELETE CASCADE,
    status VARCHAR(16) NOT NULL DEFAULT 'PENDING' CHECK (status IN ('PENDING', 'RUNNING', 'READY', 'FAILED')),
    report_json JSONB,
    ai_sources JSONB,
    error TEXT,
    generated_at TIMESTAMPTZ,
    version INT NOT NULL DEFAULT 0
);

CREATE TABLE IF NOT EXISTS public.admission_test_audit (
    audit_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL,
    actor_code VARCHAR(64),
    actor_role VARCHAR(32),
    action VARCHAR(48) NOT NULL,
    test_id UUID,
    session_id UUID,
    details JSONB,
    at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_audit_org ON public.admission_test_audit(org_code, at DESC);
