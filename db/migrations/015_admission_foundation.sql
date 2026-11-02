-- Pravesh (Admissions) — Milestone 1 foundation.
--
-- * New login roles: counsellor, reviewer (integrity), parent. Principal/owner = orgadmin; question-setter = teacher.
-- * Schema `admission`: every table carries org_code (the "school_id" of the Pravesh brief) and has row-level
--   security ENABLED and FORCED. The API runs admissions queries over the login role `admission_login`, switched to
--   the non-superuser role `admission_app` inside a transaction that sets app.org_code / app.user_code /
--   app.user_role, so Postgres itself enforces:
--     - tenant isolation: a session only sees and writes rows of its own school;
--     - family isolation: a parent only sees their own children, guardians, consents and requests;
--     - parents never see staff-only tables (retention, audit log, breach log).
-- * DPDP Act 2023 / Rules 2025 core: versioned consent texts, append-only consent records (granted / withdrawn) with
--   time + IP, data-principal requests, retention timers, append-only audit log, breach log.

-- ---------------------------------------------------------------- roles
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_user_role_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_user_role_check
    CHECK (user_role IN ('superadmin', 'orgadmin', 'teacher', 'student', 'counsellor', 'reviewer', 'parent'));

-- ---------------------------------------------------------------- schema, app role, session context
CREATE SCHEMA IF NOT EXISTS admission;
DO $$ BEGIN
    CREATE ROLE admission_app NOLOGIN;   -- not a superuser, owns nothing, no BYPASSRLS
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
-- The API connects for admissions queries as admission_login (like Supabase's `authenticator`): it is not a
-- superuser, inherits nothing, and may only SET ROLE admission_app. So even SQL running in that session cannot switch
-- to the owner / superuser (SET ROLE is checked against the login role). Production: ALTER ROLE admission_login
-- PASSWORD '...' and set ADMISSION_DATABASE_URL; local dev uses trust authentication.
DO $$ BEGIN
    CREATE ROLE admission_login LOGIN NOINHERIT;
EXCEPTION WHEN duplicate_object THEN NULL;
END $$;
GRANT admission_app TO admission_login;
GRANT USAGE ON SCHEMA admission TO admission_app;

CREATE OR REPLACE FUNCTION admission.current_org() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.org_code', true), '')
$$;
CREATE OR REPLACE FUNCTION admission.current_actor() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_code', true), '')
$$;
CREATE OR REPLACE FUNCTION admission.current_actor_role() RETURNS TEXT LANGUAGE sql STABLE AS $$
    SELECT NULLIF(current_setting('app.user_role', true), '')
$$;

-- ---------------------------------------------------------------- people (minimal fields: data minimisation)
CREATE TABLE IF NOT EXISTS admission.applicants (
    applicant_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    full_name VARCHAR(200) NOT NULL,
    date_of_birth DATE,
    gender VARCHAR(16) CHECK (gender IN ('female', 'male', 'other', 'undisclosed')),
    grade_applying INT NOT NULL CHECK (grade_applying BETWEEN 6 AND 12),
    previous_school VARCHAR(200),
    preferred_language VARCHAR(8) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'kn', 'ta')),
    status VARCHAR(24) NOT NULL DEFAULT 'enquiry',
    created_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_applicants_org ON admission.applicants(org_code, grade_applying);

CREATE TABLE IF NOT EXISTS admission.guardians (
    guardian_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    user_code VARCHAR(64),                     -- parent login (public.app_users) when the guardian has one
    full_name VARCHAR(200) NOT NULL,
    relationship VARCHAR(16) NOT NULL CHECK (relationship IN ('mother', 'father', 'guardian')),
    phone VARCHAR(20),
    email VARCHAR(255),
    preferred_language VARCHAR(8) NOT NULL DEFAULT 'en' CHECK (preferred_language IN ('en', 'hi', 'kn', 'ta')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_guardians_user ON admission.guardians(org_code, user_code);

CREATE TABLE IF NOT EXISTS admission.applicant_guardians (
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    applicant_id UUID NOT NULL REFERENCES admission.applicants(applicant_id) ON DELETE CASCADE,
    guardian_id UUID NOT NULL REFERENCES admission.guardians(guardian_id) ON DELETE CASCADE,
    is_primary BOOLEAN NOT NULL DEFAULT TRUE,
    PRIMARY KEY (applicant_id, guardian_id)
);

-- ---------------------------------------------------------------- consent (DPDP: verifiable parental consent)
CREATE TABLE IF NOT EXISTS admission.consent_versions (
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    version INT NOT NULL CHECK (version > 0),
    language VARCHAR(8) NOT NULL CHECK (language IN ('en', 'hi', 'kn', 'ta')),
    title VARCHAR(200) NOT NULL,
    body TEXT NOT NULL,
    purposes TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_code, version, language)
);

-- Append-only: a withdrawal is a new row. Applicant / guardian links are cleared on erasure, the evidence stays.
CREATE TABLE IF NOT EXISTS admission.consents (
    consent_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    applicant_id UUID REFERENCES admission.applicants(applicant_id) ON DELETE SET NULL,
    guardian_id UUID REFERENCES admission.guardians(guardian_id) ON DELETE SET NULL,
    version_id UUID NOT NULL REFERENCES admission.consent_versions(version_id),
    version INT NOT NULL,
    language VARCHAR(8) NOT NULL,
    decision VARCHAR(12) NOT NULL CHECK (decision IN ('granted', 'withdrawn')),
    method VARCHAR(16) NOT NULL CHECK (method IN ('parent_portal', 'in_person')),
    ip INET,
    user_agent VARCHAR(300),
    recorded_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_consents_applicant ON admission.consents(org_code, applicant_id, created_at DESC);

-- ---------------------------------------------------------------- data-principal requests, retention, audit, breach
CREATE TABLE IF NOT EXISTS admission.data_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    applicant_id UUID REFERENCES admission.applicants(applicant_id) ON DELETE SET NULL,
    guardian_id UUID REFERENCES admission.guardians(guardian_id) ON DELETE SET NULL,
    kind VARCHAR(24) NOT NULL CHECK (kind IN ('access', 'correction', 'erasure', 'consent_withdrawal', 'grievance')),
    details TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'in_progress', 'completed', 'rejected')),
    due_at TIMESTAMPTZ NOT NULL,
    resolved_at TIMESTAMPTZ,
    resolution_note TEXT,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_data_requests_org ON admission.data_requests(org_code, status, due_at);

CREATE TABLE IF NOT EXISTS admission.retention_policies (
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    data_class VARCHAR(32) NOT NULL CHECK (data_class IN ('proctor_snapshots', 'proctor_events', 'unsuccessful_applicants',
                                                          'withdrawn_enquiries', 'audit_log')),
    retain_days INT NOT NULL CHECK (retain_days BETWEEN 1 AND 3650),
    updated_by VARCHAR(64),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_code, data_class)
);

-- Append-only for the application role. Details must not contain personal data (ids and field names only).
CREATE TABLE IF NOT EXISTS admission.audit_log (
    log_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    actor_code VARCHAR(64) NOT NULL,
    actor_role VARCHAR(16) NOT NULL,
    action VARCHAR(64) NOT NULL,
    entity VARCHAR(48) NOT NULL,
    entity_id VARCHAR(64),
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_audit_org_time ON admission.audit_log(org_code, created_at DESC);

CREATE TABLE IF NOT EXISTS admission.breach_log (
    breach_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    detected_at TIMESTAMPTZ NOT NULL,
    nature TEXT NOT NULL,
    data_affected TEXT,
    affected_count INT CHECK (affected_count >= 0),
    actions_taken TEXT,
    board_notified_at TIMESTAMPTZ,
    principals_notified_at TIMESTAMPTZ,
    status VARCHAR(16) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'reported', 'closed')),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- row-level security
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['applicants', 'guardians', 'applicant_guardians', 'consent_versions', 'consents',
                             'data_requests', 'retention_policies', 'audit_log', 'breach_log'] LOOP
        EXECUTE format('ALTER TABLE admission.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE admission.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON admission.%I', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON admission.%I USING (org_code = admission.current_org()) '
                       'WITH CHECK (org_code = admission.current_org())', t);
    END LOOP;
END $$;

-- Family isolation for parents (RESTRICTIVE = ANDed with tenant_isolation).
DROP POLICY IF EXISTS parent_scope ON admission.guardians;
CREATE POLICY parent_scope ON admission.guardians AS RESTRICTIVE
    USING (admission.current_actor_role() IS DISTINCT FROM 'parent' OR user_code = admission.current_actor());

DROP POLICY IF EXISTS parent_scope ON admission.applicant_guardians;
CREATE POLICY parent_scope ON admission.applicant_guardians AS RESTRICTIVE
    USING (admission.current_actor_role() IS DISTINCT FROM 'parent'
           OR guardian_id IN (SELECT g.guardian_id FROM admission.guardians g WHERE g.user_code = admission.current_actor()));

DROP POLICY IF EXISTS parent_scope ON admission.applicants;
CREATE POLICY parent_scope ON admission.applicants AS RESTRICTIVE
    USING (admission.current_actor_role() IS DISTINCT FROM 'parent'
           OR applicant_id IN (SELECT ag.applicant_id FROM admission.applicant_guardians ag));

DROP POLICY IF EXISTS parent_scope ON admission.consents;
CREATE POLICY parent_scope ON admission.consents AS RESTRICTIVE
    USING (admission.current_actor_role() IS DISTINCT FROM 'parent'
           OR applicant_id IN (SELECT ag.applicant_id FROM admission.applicant_guardians ag));

DROP POLICY IF EXISTS parent_scope ON admission.data_requests;
CREATE POLICY parent_scope ON admission.data_requests AS RESTRICTIVE
    USING (admission.current_actor_role() IS DISTINCT FROM 'parent'
           OR guardian_id IN (SELECT g.guardian_id FROM admission.guardians g WHERE g.user_code = admission.current_actor()));

-- Staff-only tables: parents can neither read nor write them ...
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['retention_policies', 'breach_log'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS staff_only ON admission.%I', t);
        EXECUTE format('CREATE POLICY staff_only ON admission.%I AS RESTRICTIVE '
                       'USING (admission.current_actor_role() IS DISTINCT FROM ''parent'')', t);
    END LOOP;
END $$;
-- ... while the audit log records parents' own actions (insert) but is readable by staff only.
DROP POLICY IF EXISTS staff_only ON admission.audit_log;
CREATE POLICY staff_only ON admission.audit_log AS RESTRICTIVE FOR SELECT
    USING (admission.current_actor_role() IS DISTINCT FROM 'parent');

-- ---------------------------------------------------------------- privileges for the application role
GRANT SELECT, INSERT, UPDATE, DELETE ON ALL TABLES IN SCHEMA admission TO admission_app;
GRANT USAGE, SELECT ON ALL SEQUENCES IN SCHEMA admission TO admission_app;
-- Evidence tables are append-only for the application (only the retention job, as owner, may purge).
REVOKE UPDATE, DELETE ON admission.audit_log FROM admission_app;
REVOKE UPDATE, DELETE ON admission.consents FROM admission_app;
