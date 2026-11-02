-- Unified AI proctoring for student flows (Online Tests, Virtual Labs, AI Classroom): one session per student per
-- exam, an append-only log of proctoring FLAGS, teacher remarks / warnings / reviews / session ends, and per-school,
-- per-module thresholds. See backend/app/services/proctoring/.
--
-- FLAGS ONLY (product decision): detection runs on the student's device. No video, audio, snapshot or image ever
-- reaches the server; an event is a code, a severity, timestamps and a few small scalar details (e.g. "faces: 2").
-- This changes the count-only policy of migrations 023 / 024: per-flag detail is now stored here (for the assigned
-- teachers' review, with a retention purge: python -m scripts.proctoring_retention). The proctor_flag_count columns
-- of virtual_lab_attempts / evaluation_candidate_scripts are still kept up to date for the existing screens.

-- ---------------------------------------------------------------- settings (defaults live in code)
-- Only the overrides an admin saved; services/proctoring/config.py merges them over the per-module defaults.
CREATE TABLE IF NOT EXISTS public.proctor_settings (
    org_code VARCHAR(64) NOT NULL,
    module VARCHAR(16) NOT NULL CHECK (module IN ('ONLINE_TEST', 'VIRTUAL_LAB', 'AI_CLASSROOM')),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,
    updated_by VARCHAR(64),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_code, module)
);

-- ---------------------------------------------------------------- sessions
-- module + ref_id identify the exam: ONLINE_TEST = evaluation_tests.eval_test_id, VIRTUAL_LAB =
-- virtual_lab_assignments.assignment_id, AI_CLASSROOM = 'nlp/<class>/<subject>/<chapter>' or 'textbook/<subject_code>'.
-- teacher_codes = the assigned teachers (notified, allowed to monitor), resolved when the session is prepared.
CREATE TABLE IF NOT EXISTS public.proctor_sessions (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    module VARCHAR(16) NOT NULL CHECK (module IN ('ONLINE_TEST', 'VIRTUAL_LAB', 'AI_CLASSROOM')),
    ref_id VARCHAR(400) NOT NULL,
    ref_title VARCHAR(300) NOT NULL,
    student_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64),
    subject_code VARCHAR(64),
    teacher_codes TEXT[] NOT NULL DEFAULT '{}',
    -- PRECHECK: preparation window open · ACTIVE · INTERRUPTED: left the page / stopped reporting ·
    -- SUBMITTED: exam handed in · ENDED_BY_TEACHER · CLOSED: an AI Classroom session the student closed
    status VARCHAR(20) NOT NULL DEFAULT 'PRECHECK'
        CHECK (status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED', 'SUBMITTED', 'ENDED_BY_TEACHER', 'CLOSED')),
    settings JSONB NOT NULL DEFAULT '{}'::jsonb,       -- effective thresholds when the session was prepared
    rules_version VARCHAR(32),
    rules_acknowledged_at TIMESTAMPTZ,
    checks JSONB,                                     -- pre-exam check results reported by the device
    camera_label VARCHAR(200),
    mic_label VARCHAR(200),
    started_at TIMESTAMPTZ,
    resumed_count INT NOT NULL DEFAULT 0,
    last_heartbeat_at TIMESTAMPTZ,
    last_status JSONB,                                -- camera / mic / full screen / faces at the last heartbeat
    ended_at TIMESTAMPTZ,
    end_reason VARCHAR(32),
    ended_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
-- At most one open session per student per exam (a reload resumes it).
CREATE UNIQUE INDEX IF NOT EXISTS idx_proctor_sessions_open ON public.proctor_sessions(org_code, module, ref_id, student_code)
    WHERE status IN ('PRECHECK', 'ACTIVE', 'INTERRUPTED');
CREATE INDEX IF NOT EXISTS idx_proctor_sessions_exam ON public.proctor_sessions(org_code, module, ref_id, status);
CREATE INDEX IF NOT EXISTS idx_proctor_sessions_student ON public.proctor_sessions(org_code, student_code, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_proctor_sessions_teachers ON public.proctor_sessions USING GIN (teacher_codes);
CREATE INDEX IF NOT EXISTS idx_proctor_sessions_live ON public.proctor_sessions(status, last_heartbeat_at)
    WHERE status = 'ACTIVE';

-- ---------------------------------------------------------------- events (append-only)
-- Severity is decided by the server from its catalogue (never by the client). seq makes client retries idempotent.
CREATE TABLE IF NOT EXISTS public.proctor_events (
    event_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.proctor_sessions(session_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    seq INT,                                          -- NULL for server-raised events
    code VARCHAR(32) NOT NULL,
    severity VARCHAR(10) NOT NULL CHECK (severity IN ('Info', 'Low', 'Medium', 'High', 'Critical')),
    category VARCHAR(16) NOT NULL,                    -- suspicious | camera | presence | session
    client_ts TIMESTAMPTZ,
    server_ts TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    duration_ms INT NOT NULL DEFAULT 0 CHECK (duration_ms >= 0),
    confidence NUMERIC(4, 3),
    details JSONB,                                    -- small scalars only (validated by the API)
    source VARCHAR(8) NOT NULL DEFAULT 'client' CHECK (source IN ('client', 'server'))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_proctor_events_seq ON public.proctor_events(session_id, seq) WHERE seq IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proctor_events_session ON public.proctor_events(session_id, server_ts);
CREATE INDEX IF NOT EXISTS idx_proctor_events_org_time ON public.proctor_events(org_code, server_ts DESC);

-- ---------------------------------------------------------------- staff actions (append-only audit trail)
-- REMARK (private note) · WARNING (shown to the student; delivered_at / acknowledged_at are the only columns that may
-- change later) · END_SESSION · REVIEW (of one event: DISMISSED / NOTED / CONCERN) · VIEW (session opened).
CREATE TABLE IF NOT EXISTS public.proctor_actions (
    action_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.proctor_sessions(session_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    actor_code VARCHAR(64) NOT NULL,
    actor_role VARCHAR(32) NOT NULL,
    action VARCHAR(16) NOT NULL CHECK (action IN ('REMARK', 'WARNING', 'END_SESSION', 'REVIEW', 'VIEW')),
    event_id UUID REFERENCES public.proctor_events(event_id) ON DELETE CASCADE,
    outcome VARCHAR(16) CHECK (outcome IS NULL OR outcome IN ('DISMISSED', 'NOTED', 'CONCERN')),
    message TEXT,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    delivered_at TIMESTAMPTZ,
    acknowledged_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_proctor_actions_session ON public.proctor_actions(session_id, created_at);
CREATE INDEX IF NOT EXISTS idx_proctor_actions_event ON public.proctor_actions(event_id, created_at DESC) WHERE event_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_proctor_actions_pending ON public.proctor_actions(session_id)
    WHERE action = 'WARNING' AND acknowledged_at IS NULL;

-- Events and actions cannot be edited or deleted, except: a warning's delivery / acknowledgement times, and the
-- retention purge (which sets eduai.proctor_purge = 'on' for its own transaction).
CREATE OR REPLACE FUNCTION public.proctor_append_only() RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
    IF TG_OP = 'DELETE' AND current_setting('eduai.proctor_purge', true) = 'on' THEN
        RETURN OLD;
    END IF;
    IF TG_OP = 'UPDATE' AND TG_TABLE_NAME = 'proctor_actions'
       AND (to_jsonb(NEW) - 'delivered_at' - 'acknowledged_at') = (to_jsonb(OLD) - 'delivered_at' - 'acknowledged_at') THEN
        RETURN NEW;
    END IF;
    RAISE EXCEPTION '% is append-only', TG_TABLE_NAME;
END;
$$;

DROP TRIGGER IF EXISTS trg_proctor_events_append_only ON public.proctor_events;
CREATE TRIGGER trg_proctor_events_append_only BEFORE UPDATE OR DELETE ON public.proctor_events
    FOR EACH ROW EXECUTE FUNCTION public.proctor_append_only();
DROP TRIGGER IF EXISTS trg_proctor_actions_append_only ON public.proctor_actions;
CREATE TRIGGER trg_proctor_actions_append_only BEFORE UPDATE OR DELETE ON public.proctor_actions
    FOR EACH ROW EXECUTE FUNCTION public.proctor_append_only();

-- ---------------------------------------------------------------- notifications: severity + structured payload
-- Additive: existing usp_notify callers are unchanged (both columns stay NULL for them).
ALTER TABLE public.notifications
    ADD COLUMN IF NOT EXISTS severity VARCHAR(10),
    ADD COLUMN IF NOT EXISTS payload JSONB;

CREATE OR REPLACE FUNCTION public.usp_notify_with_payload(
    p_org_code VARCHAR, p_user_code VARCHAR, p_notif_type VARCHAR, p_title VARCHAR, p_body TEXT, p_link TEXT,
    p_dedup_key VARCHAR, p_severity VARCHAR, p_payload JSONB
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    v_id := public.usp_notify(p_org_code, p_user_code, p_notif_type, p_title, p_body, p_link, p_dedup_key);
    IF v_id IS NOT NULL THEN
        UPDATE public.notifications SET severity = p_severity, payload = p_payload WHERE notification_id = v_id;
    END IF;
    RETURN v_id;
END;
$$;
