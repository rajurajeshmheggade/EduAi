-- Pravesh — admission forms, the standalone admission application with one-time applicant credentials, and the
-- review workflow (docs: README "Admission forms & the standalone application").
--
-- * A teacher (or an admissions admin) builds a form (student, parent/guardian, academic sections, custom fields,
--   document requirements, instructions), previews it and publishes it. Publishing snapshots an immutable version and
--   gives the form a public slug: /apply/<slug> is a separate app with its own login.
-- * Every applicant signs in with a ONE-TIME credential (unique username + temporary password, bcrypt hash only). It
--   stays valid while the applicant fills in the form; final submission (or the linked admission test's submission)
--   wipes the hash, revokes the credential and ends every applicant session. A corrections request issues a fresh one.
-- * All new tables live in schema `admission`: org_code + row-level security ENABLED and FORCED, tenant_isolation like
--   Milestone 1, plus RESTRICTIVE policies per role:
--     staff (orgadmin, superadmin, counsellor)  whole school
--     teacher                                   own forms and their applications only
--     applicant  (app.user_code = application)  own application, its documents / visible history, published forms
--     applicant_gate (pre-authentication)       published forms, credential lookup / sessions for login, new recovery
--                                               requests (insert only)
--     admission_system                          server-side sync after a submission (never carried by any token)
--     anything else (parent, reviewer, unknown) nothing — fail closed
--   The Milestone 1 policies read "everyone but a parent is staff", so the new roles get explicit restrictive
--   policies on those tables too.

-- ---------------------------------------------------------------- institution branding for the standalone app
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS brand_display_name VARCHAR(200);
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS brand_logo_key TEXT;
ALTER TABLE public.organizations ADD COLUMN IF NOT EXISTS brand_accent VARCHAR(7);
ALTER TABLE public.organizations DROP CONSTRAINT IF EXISTS organizations_brand_accent_check;
ALTER TABLE public.organizations ADD CONSTRAINT organizations_brand_accent_check
    CHECK (brand_accent IS NULL OR brand_accent ~ '^#[0-9A-Fa-f]{6}$');

-- ---------------------------------------------------------------- admission test sessions started from the applicant app
ALTER TABLE public.admission_sessions ADD COLUMN IF NOT EXISTS origin VARCHAR(16) NOT NULL DEFAULT 'teacher';
ALTER TABLE public.admission_sessions DROP CONSTRAINT IF EXISTS admission_sessions_origin_check;
ALTER TABLE public.admission_sessions ADD CONSTRAINT admission_sessions_origin_check CHECK (origin IN ('teacher', 'applicant'));

-- ---------------------------------------------------------------- Milestone 1 tables: pre-primary grades, applicant-app consent
-- -2 Nursery, -1 LKG, 0 UKG, 1..12 Class 1..12
ALTER TABLE admission.applicants DROP CONSTRAINT IF EXISTS applicants_grade_applying_check;
ALTER TABLE admission.applicants ADD CONSTRAINT applicants_grade_applying_check CHECK (grade_applying BETWEEN -2 AND 12);
ALTER TABLE admission.consents DROP CONSTRAINT IF EXISTS consents_method_check;
ALTER TABLE admission.consents ADD CONSTRAINT consents_method_check CHECK (method IN ('parent_portal', 'in_person', 'applicant_app'));

-- ---------------------------------------------------------------- forms
CREATE TABLE IF NOT EXISTS admission.forms (
    form_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    title VARCHAR(200) NOT NULL,
    description TEXT CHECK (description IS NULL OR length(description) <= 2000),
    academic_year VARCHAR(20),
    definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),   -- working copy (validated by the API)
    grades INT[] NOT NULL DEFAULT '{}',
    status VARCHAR(12) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'published', 'closed', 'archived')),
    slug VARCHAR(80) UNIQUE CHECK (slug IS NULL OR slug ~ '^[a-z0-9][a-z0-9-]{5,79}$'),
    published_version INT,
    has_unpublished_changes BOOLEAN NOT NULL DEFAULT FALSE,
    opens_at TIMESTAMPTZ,
    closes_at TIMESTAMPTZ,
    credential_valid_days INT NOT NULL DEFAULT 30 CHECK (credential_valid_days BETWEEN 1 AND 365),
    linked_test_id UUID REFERENCES public.admission_tests(test_id) ON DELETE SET NULL,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    published_at TIMESTAMPTZ,
    published_by VARCHAR(64),
    CHECK (status = 'draft' OR (slug IS NOT NULL AND published_version IS NOT NULL)),
    CHECK (opens_at IS NULL OR closes_at IS NULL OR closes_at > opens_at),
    CHECK (grades <@ ARRAY[-2,-1,0,1,2,3,4,5,6,7,8,9,10,11,12])
);
CREATE INDEX IF NOT EXISTS idx_adm_forms_org ON admission.forms(org_code, status);
CREATE INDEX IF NOT EXISTS idx_adm_forms_owner ON admission.forms(org_code, created_by);

-- Immutable published snapshots: an application is always read against the version it was submitted with.
CREATE TABLE IF NOT EXISTS admission.form_versions (
    version_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    form_id UUID NOT NULL REFERENCES admission.forms(form_id) ON DELETE CASCADE,
    version INT NOT NULL CHECK (version > 0),
    definition JSONB NOT NULL CHECK (jsonb_typeof(definition) = 'object'),   -- {title, description, grades, instructions, sections, documents, declaration}
    published_by VARCHAR(64) NOT NULL,
    published_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (form_id, version)
);

-- ---------------------------------------------------------------- applications
CREATE TABLE IF NOT EXISTS admission.applications (
    application_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    form_id UUID NOT NULL REFERENCES admission.forms(form_id) ON DELETE RESTRICT,
    version_id UUID REFERENCES admission.form_versions(version_id),
    reference_no VARCHAR(20) NOT NULL UNIQUE CHECK (reference_no ~ '^APP-[A-Z0-9]{4}-[A-Z0-9]{4}$'),
    status VARCHAR(24) NOT NULL DEFAULT 'draft' CHECK (status IN (
        'draft',                 -- applicant filling in (credential live)
        'test_pending',          -- application final, the linked admission test is still to be taken (credential live)
        'submitted',             -- in the school's review queue (credential removed)
        'under_review', 'correction_requested', 'resubmitted', 'approved', 'rejected')),
    answers JSONB NOT NULL DEFAULT '{}'::jsonb CHECK (jsonb_typeof(answers) = 'object'),
    student_name VARCHAR(200),
    date_of_birth DATE,
    grade_applying INT CHECK (grade_applying IS NULL OR grade_applying BETWEEN -2 AND 12),
    applicant_id UUID REFERENCES admission.applicants(applicant_id) ON DELETE SET NULL,   -- CRM record, synced on submission
    exam_candidate_id UUID REFERENCES public.admission_candidates(candidate_id) ON DELETE SET NULL,
    exam_session_id UUID REFERENCES public.admission_sessions(session_id) ON DELETE SET NULL,
    label VARCHAR(120),                                   -- staff-only note: who the credential was handed to
    submission_count INT NOT NULL DEFAULT 0 CHECK (submission_count >= 0),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_saved_at TIMESTAMPTZ,
    submitted_at TIMESTAMPTZ,
    decided_at TIMESTAMPTZ,
    decided_by VARCHAR(64),
    CHECK (status = 'draft' OR (student_name IS NOT NULL AND date_of_birth IS NOT NULL AND grade_applying IS NOT NULL))
);
CREATE INDEX IF NOT EXISTS idx_adm_applications_form ON admission.applications(org_code, form_id, status);
CREATE INDEX IF NOT EXISTS idx_adm_applications_exam ON admission.applications(exam_session_id) WHERE exam_session_id IS NOT NULL;

-- ---------------------------------------------------------------- one-time applicant credentials
CREATE TABLE IF NOT EXISTS admission.applicant_credentials (
    credential_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    form_id UUID NOT NULL REFERENCES admission.forms(form_id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES admission.applications(application_id) ON DELETE CASCADE,
    username VARCHAR(32) NOT NULL UNIQUE CHECK (username ~ '^[A-Z0-9]{2,8}-[A-Z0-9]{8}$'),
    password_hash TEXT,                                  -- bcrypt; NULL once the credential is removed
    status VARCHAR(12) NOT NULL DEFAULT 'issued' CHECK (status IN ('issued', 'in_use', 'submitted', 'revoked', 'expired')),
    purpose VARCHAR(12) NOT NULL DEFAULT 'new' CHECK (purpose IN ('new', 'reissue', 'correction')),
    replaces_credential_id UUID REFERENCES admission.applicant_credentials(credential_id) ON DELETE SET NULL,
    expires_at TIMESTAMPTZ NOT NULL,
    issued_by VARCHAR(64) NOT NULL,
    issued_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(64),
    acknowledged_ip INET,
    acknowledged_items TEXT[] NOT NULL DEFAULT '{}' CHECK (acknowledged_items <@ ARRAY['username', 'password', 'all']),
    first_login_at TIMESTAMPTZ,
    last_login_at TIMESTAMPTZ,
    failed_attempts INT NOT NULL DEFAULT 0 CHECK (failed_attempts >= 0),
    locked_until TIMESTAMPTZ,
    revoked_at TIMESTAMPTZ,
    revoked_by VARCHAR(64),
    revoke_reason VARCHAR(16) CHECK (revoke_reason IS NULL OR revoke_reason IN
        ('submitted', 'test_submitted', 'teacher', 'reissued', 'correction', 'expired')),
    -- only a live credential can hold a password hash: removal is not just a status flag
    CHECK (status IN ('issued', 'in_use') OR password_hash IS NULL),
    CHECK (status NOT IN ('issued', 'in_use') OR password_hash IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_adm_credentials_form ON admission.applicant_credentials(org_code, form_id, status);
CREATE INDEX IF NOT EXISTS idx_adm_credentials_app ON admission.applicant_credentials(application_id);
-- one live credential per application
CREATE UNIQUE INDEX IF NOT EXISTS uq_adm_credentials_live ON admission.applicant_credentials(application_id)
    WHERE status IN ('issued', 'in_use');

-- Applicant sign-ins. The access token is a short JWT (own audience + key) naming this row; the refresh token is 32
-- random bytes stored as SHA-256 and rotated on every use. Removing the credential revokes every row.
CREATE TABLE IF NOT EXISTS admission.applicant_sessions (
    session_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    credential_id UUID NOT NULL REFERENCES admission.applicant_credentials(credential_id) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES admission.applications(application_id) ON DELETE CASCADE,
    refresh_hash CHAR(64) NOT NULL UNIQUE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_seen_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    expires_at TIMESTAMPTZ NOT NULL,
    revoked_at TIMESTAMPTZ,
    revoke_reason VARCHAR(16),
    ip INET,
    user_agent VARCHAR(300)
);
CREATE INDEX IF NOT EXISTS idx_adm_app_sessions_app ON admission.applicant_sessions(application_id) WHERE revoked_at IS NULL;

-- ---------------------------------------------------------------- documents, history, staff comments, recovery requests
CREATE TABLE IF NOT EXISTS admission.application_documents (
    document_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES admission.applications(application_id) ON DELETE CASCADE,
    requirement_key VARCHAR(40) NOT NULL,
    filename VARCHAR(160) NOT NULL,
    mime VARCHAR(32) NOT NULL CHECK (mime IN ('application/pdf', 'image/jpeg', 'image/png')),
    size_bytes INT NOT NULL CHECK (size_bytes BETWEEN 1 AND 10485760),
    sha256 CHAR(64) NOT NULL CHECK (sha256 ~ '^[0-9a-f]{64}$'),
    storage_key TEXT NOT NULL UNIQUE,
    uploaded_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_app_docs ON admission.application_documents(application_id, requirement_key);

-- Append-only timeline. `note` on a corrections request is shown to the applicant; other notes are staff-only.
CREATE TABLE IF NOT EXISTS admission.application_status_history (
    history_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES admission.applications(application_id) ON DELETE CASCADE,
    from_status VARCHAR(24),
    to_status VARCHAR(24) NOT NULL,
    actor_code VARCHAR(64) NOT NULL,
    actor_role VARCHAR(16) NOT NULL,
    note TEXT CHECK (note IS NULL OR length(note) <= 4000),
    visible_to_applicant BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_app_history ON admission.application_status_history(application_id, created_at);

-- Reviewer comments (staff only, append-only).
CREATE TABLE IF NOT EXISTS admission.application_comments (
    comment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    application_id UUID NOT NULL REFERENCES admission.applications(application_id) ON DELETE CASCADE,
    author_code VARCHAR(64) NOT NULL,
    author_role VARCHAR(16) NOT NULL,
    body TEXT NOT NULL CHECK (length(body) BETWEEN 1 AND 4000),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_adm_app_comments ON admission.application_comments(application_id, created_at);

-- "Forgot password?" on the applicant login: the school resolves a request by reissuing a one-time credential.
CREATE TABLE IF NOT EXISTS admission.recovery_requests (
    request_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    form_id UUID NOT NULL REFERENCES admission.forms(form_id) ON DELETE CASCADE,
    username VARCHAR(32) NOT NULL,
    credential_id UUID REFERENCES admission.applicant_credentials(credential_id) ON DELETE SET NULL,   -- matched by the server
    application_id UUID REFERENCES admission.applications(application_id) ON DELETE SET NULL,
    contact VARCHAR(255) NOT NULL,
    message VARCHAR(1000),
    status VARCHAR(12) NOT NULL DEFAULT 'open' CHECK (status IN ('open', 'resolved', 'dismissed')),
    ip INET,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    resolved_at TIMESTAMPTZ,
    resolved_by VARCHAR(64),
    new_credential_id UUID REFERENCES admission.applicant_credentials(credential_id) ON DELETE SET NULL
);
CREATE INDEX IF NOT EXISTS idx_adm_recovery_form ON admission.recovery_requests(org_code, form_id, status);

-- ---------------------------------------------------------------- integrity rules the database enforces itself
CREATE OR REPLACE FUNCTION admission.is_staff() RETURNS BOOLEAN LANGUAGE sql STABLE AS $$
    SELECT COALESCE(admission.current_actor_role(), '') IN ('orgadmin', 'superadmin', 'counsellor', 'admission_system')
$$;

-- Status machine. Submissions are made by the applicant (or the system when the linked test ends); decisions by staff.
CREATE OR REPLACE FUNCTION admission.application_guard() RETURNS trigger LANGUAGE plpgsql AS $$
DECLARE
    r TEXT := COALESCE(admission.current_actor_role(), '');
    pair TEXT;
BEGIN
    IF TG_OP = 'INSERT' THEN
        IF NEW.status <> 'draft' AND current_user = 'admission_app' THEN
            RAISE EXCEPTION 'A new application starts as a draft' USING ERRCODE = 'check_violation';
        END IF;
        RETURN NEW;
    END IF;
    NEW.updated_at := NOW();
    IF NEW.org_code IS DISTINCT FROM OLD.org_code OR NEW.form_id IS DISTINCT FROM OLD.form_id
       OR NEW.reference_no IS DISTINCT FROM OLD.reference_no OR NEW.created_by IS DISTINCT FROM OLD.created_by THEN
        RAISE EXCEPTION 'Application identity cannot change' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.status IS DISTINCT FROM OLD.status THEN
        pair := OLD.status || '>' || NEW.status;
        IF pair NOT IN ('draft>test_pending', 'draft>submitted', 'test_pending>submitted', 'correction_requested>resubmitted',
                        'submitted>under_review', 'submitted>approved', 'submitted>rejected', 'submitted>correction_requested',
                        'resubmitted>under_review', 'resubmitted>approved', 'resubmitted>rejected', 'resubmitted>correction_requested',
                        'under_review>approved', 'under_review>rejected', 'under_review>correction_requested') THEN
            RAISE EXCEPTION 'Application status cannot change from % to %', OLD.status, NEW.status USING ERRCODE = 'check_violation';
        END IF;
        IF pair IN ('draft>test_pending', 'draft>submitted', 'correction_requested>resubmitted') AND r NOT IN ('applicant', 'admission_system') THEN
            RAISE EXCEPTION 'Only the applicant submits an application' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF pair = 'test_pending>submitted' AND r <> 'admission_system' THEN
            RAISE EXCEPTION 'The application is submitted when the admission test ends' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF OLD.status IN ('submitted', 'resubmitted', 'under_review') AND r NOT IN ('orgadmin', 'superadmin', 'counsellor', 'teacher', 'admission_system') THEN
            RAISE EXCEPTION 'Only the school decides on an application' USING ERRCODE = 'insufficient_privilege';
        END IF;
    END IF;
    IF r = 'applicant' THEN
        IF OLD.status NOT IN ('draft', 'correction_requested') THEN
            RAISE EXCEPTION 'This application can no longer be changed' USING ERRCODE = 'insufficient_privilege';
        END IF;
        IF NEW.applicant_id IS DISTINCT FROM OLD.applicant_id OR NEW.exam_candidate_id IS DISTINCT FROM OLD.exam_candidate_id
           OR NEW.exam_session_id IS DISTINCT FROM OLD.exam_session_id OR NEW.label IS DISTINCT FROM OLD.label
           OR NEW.decided_at IS DISTINCT FROM OLD.decided_at OR NEW.decided_by IS DISTINCT FROM OLD.decided_by THEN
            RAISE EXCEPTION 'Applicants may change their answers only' USING ERRCODE = 'insufficient_privilege';
        END IF;
    ELSIF NEW.answers IS DISTINCT FROM OLD.answers AND r <> 'admission_system' THEN
        RAISE EXCEPTION 'Only the applicant changes the answers' USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_application_guard ON admission.applications;
CREATE TRIGGER trg_application_guard BEFORE INSERT OR UPDATE ON admission.applications
    FOR EACH ROW EXECUTE FUNCTION admission.application_guard();

-- A removed credential never comes back (no new hash, no return to issued / in use).
CREATE OR REPLACE FUNCTION admission.credential_guard() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF OLD.status NOT IN ('issued', 'in_use') AND (NEW.status IS DISTINCT FROM OLD.status OR NEW.password_hash IS NOT NULL) THEN
        RAISE EXCEPTION 'A removed credential cannot be reactivated; issue a new one' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.password_hash IS DISTINCT FROM OLD.password_hash AND NEW.password_hash IS NOT NULL THEN
        RAISE EXCEPTION 'A one-time password cannot be replaced; issue a new credential' USING ERRCODE = 'check_violation';
    END IF;
    IF NEW.username IS DISTINCT FROM OLD.username OR NEW.application_id IS DISTINCT FROM OLD.application_id
       OR NEW.form_id IS DISTINCT FROM OLD.form_id OR NEW.issued_by IS DISTINCT FROM OLD.issued_by THEN
        RAISE EXCEPTION 'Credential identity cannot change' USING ERRCODE = 'check_violation';
    END IF;
    RETURN NEW;
END $$;
DROP TRIGGER IF EXISTS trg_credential_guard ON admission.applicant_credentials;
CREATE TRIGGER trg_credential_guard BEFORE UPDATE ON admission.applicant_credentials
    FOR EACH ROW EXECUTE FUNCTION admission.credential_guard();

-- Append-only for the application role (cascaded deletes of an erased application are allowed; the database owner,
-- e.g. a retention job, is not affected). A row trigger, so statements that match no row are not errors.
CREATE OR REPLACE FUNCTION admission.append_only() RETURNS trigger LANGUAGE plpgsql AS $$
BEGIN
    IF current_user = 'admission_app' AND (TG_OP = 'UPDATE' OR pg_trigger_depth() <= 1) THEN
        RAISE EXCEPTION 'admission.% is append-only', TG_TABLE_NAME USING ERRCODE = 'insufficient_privilege';
    END IF;
    RETURN CASE WHEN TG_OP = 'DELETE' THEN OLD ELSE NEW END;
END $$;
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['form_versions', 'application_status_history', 'application_comments'] LOOP
        EXECUTE format('DROP TRIGGER IF EXISTS trg_append_only ON admission.%I', t);
        EXECUTE format('CREATE TRIGGER trg_append_only BEFORE UPDATE OR DELETE ON admission.%I '
                       'FOR EACH ROW EXECUTE FUNCTION admission.append_only()', t);
    END LOOP;
END $$;

-- ---------------------------------------------------------------- pre-authentication lookups (SECURITY DEFINER, minimal output)
-- The public app knows only the slug in its URL. This returns the school and form of a published slug and nothing
-- else, so the API can open a tenant transaction for it.
CREATE OR REPLACE FUNCTION admission.resolve_form_slug(p_slug TEXT)
RETURNS TABLE (org_code VARCHAR, form_id UUID) LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT f.org_code, f.form_id FROM admission.forms f
    WHERE f.slug = p_slug AND f.status IN ('published', 'closed')
$$;
-- Public tracking: reference number + date of birth -> status only (never answers, names or notes).
CREATE OR REPLACE FUNCTION admission.lookup_application_status(p_form UUID, p_reference TEXT, p_dob DATE)
RETURNS TABLE (status VARCHAR, submitted_at TIMESTAMPTZ, updated_at TIMESTAMPTZ)
LANGUAGE sql STABLE SECURITY DEFINER SET search_path = pg_catalog, pg_temp AS $$
    SELECT a.status, a.submitted_at, a.updated_at FROM admission.applications a
    WHERE a.org_code = admission.current_org() AND a.form_id = p_form AND a.reference_no = p_reference
      AND a.date_of_birth = p_dob AND a.status <> 'draft'
$$;
REVOKE ALL ON FUNCTION admission.resolve_form_slug(TEXT) FROM PUBLIC;
REVOKE ALL ON FUNCTION admission.lookup_application_status(UUID, TEXT, DATE) FROM PUBLIC;
GRANT EXECUTE ON FUNCTION admission.resolve_form_slug(TEXT) TO admission_app;
GRANT EXECUTE ON FUNCTION admission.lookup_application_status(UUID, TEXT, DATE) TO admission_app;

-- ---------------------------------------------------------------- row-level security: new tables
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['forms', 'form_versions', 'applications', 'applicant_credentials', 'applicant_sessions',
                             'application_documents', 'application_status_history', 'application_comments',
                             'recovery_requests'] LOOP
        EXECUTE format('ALTER TABLE admission.%I ENABLE ROW LEVEL SECURITY', t);
        EXECUTE format('ALTER TABLE admission.%I FORCE ROW LEVEL SECURITY', t);
        EXECUTE format('DROP POLICY IF EXISTS tenant_isolation ON admission.%I', t);
        EXECUTE format('CREATE POLICY tenant_isolation ON admission.%I USING (org_code = admission.current_org()) '
                       'WITH CHECK (org_code = admission.current_org())', t);
        EXECUTE format('DROP POLICY IF EXISTS actor_scope ON admission.%I', t);
    END LOOP;
END $$;

-- forms: teachers their own; the applicant app only published (or closed) forms, read-only.
CREATE POLICY actor_scope ON admission.forms AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() = 'teacher' THEN created_by = admission.current_actor()
                WHEN admission.current_actor_role() IN ('applicant', 'applicant_gate') THEN status IN ('published', 'closed')
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() = 'teacher' THEN created_by = admission.current_actor()
                     ELSE FALSE END);

-- versions follow the visibility of their form (nested RLS); writes as for forms.
CREATE POLICY actor_scope ON admission.form_versions AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() IN ('teacher', 'applicant', 'applicant_gate')
                    THEN form_id IN (SELECT f.form_id FROM admission.forms f)
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() = 'teacher' THEN form_id IN (SELECT f.form_id FROM admission.forms f)
                     ELSE FALSE END);

-- applications: teachers those of their own forms; an applicant exactly one (app.user_code = application id).
CREATE POLICY actor_scope ON admission.applications AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() = 'teacher' THEN form_id IN (SELECT f.form_id FROM admission.forms f)
                WHEN admission.current_actor_role() = 'applicant' THEN application_id::text = admission.current_actor()
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() = 'teacher' THEN form_id IN (SELECT f.form_id FROM admission.forms f)
                     WHEN admission.current_actor_role() = 'applicant' THEN application_id::text = admission.current_actor()
                     ELSE FALSE END);

-- credentials: the login gate looks a username up; otherwise they follow the visible applications.
CREATE POLICY actor_scope ON admission.applicant_credentials AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() OR admission.current_actor_role() = 'applicant_gate' THEN TRUE
                WHEN admission.current_actor_role() IN ('teacher', 'applicant')
                    THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() OR admission.current_actor_role() = 'applicant_gate' THEN TRUE
                     WHEN admission.current_actor_role() IN ('teacher', 'applicant')
                         THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                     ELSE FALSE END);

-- sessions: never visible to teachers; an applicant only their own.
CREATE POLICY actor_scope ON admission.applicant_sessions AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() OR admission.current_actor_role() = 'applicant_gate' THEN TRUE
                WHEN admission.current_actor_role() = 'applicant' THEN application_id::text = admission.current_actor()
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() OR admission.current_actor_role() = 'applicant_gate' THEN TRUE
                     WHEN admission.current_actor_role() = 'applicant' THEN application_id::text = admission.current_actor()
                     ELSE FALSE END);

CREATE POLICY actor_scope ON admission.application_documents AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() IN ('teacher', 'applicant')
                    THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() = 'applicant'
                         THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                     ELSE FALSE END);

-- history: an applicant sees only entries meant for them (a corrections request).
CREATE POLICY actor_scope ON admission.application_status_history AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() = 'teacher'
                    THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                WHEN admission.current_actor_role() = 'applicant'
                    THEN visible_to_applicant AND application_id IN (SELECT a.application_id FROM admission.applications a)
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() IN ('teacher', 'applicant')
                         THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                     ELSE FALSE END);

CREATE POLICY actor_scope ON admission.application_comments AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() = 'teacher'
                    THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() = 'teacher'
                         THEN application_id IN (SELECT a.application_id FROM admission.applications a)
                     ELSE FALSE END);

-- recovery requests: the public gate may only file a new, open one (it can never read or change any).
CREATE POLICY actor_scope ON admission.recovery_requests AS RESTRICTIVE
    USING (CASE WHEN admission.is_staff() THEN TRUE
                WHEN admission.current_actor_role() = 'teacher' THEN form_id IN (SELECT f.form_id FROM admission.forms f)
                ELSE FALSE END)
    WITH CHECK (CASE WHEN admission.is_staff() THEN TRUE
                     WHEN admission.current_actor_role() = 'teacher' THEN form_id IN (SELECT f.form_id FROM admission.forms f)
                     WHEN admission.current_actor_role() = 'applicant_gate' THEN status = 'open' AND resolved_by IS NULL
                     ELSE FALSE END);

-- Read-only / no-delete rules per role (RESTRICTIVE, per command).
DO $$
DECLARE spec TEXT[];
BEGIN
    -- {table, roles that may not INSERT, roles that may not UPDATE, roles that may not DELETE}
    FOREACH spec SLICE 1 IN ARRAY ARRAY[
        ARRAY['forms',                      'applicant,applicant_gate', 'applicant,applicant_gate', 'applicant,applicant_gate'],
        ARRAY['form_versions',              'applicant,applicant_gate', 'applicant,applicant_gate', 'applicant,applicant_gate'],
        ARRAY['applications',               'applicant',                '',                         'applicant'],
        ARRAY['applicant_credentials',      'applicant,applicant_gate', '',                         'applicant,applicant_gate'],
        ARRAY['applicant_sessions',         'applicant',                '',                         'applicant,applicant_gate'],
        ARRAY['application_documents',      'teacher',                  'teacher,applicant',        'teacher'],
        ARRAY['application_status_history', '',                         'teacher,applicant',        'teacher,applicant'],
        ARRAY['application_comments',       '',                         'teacher',                  'teacher'],
        ARRAY['recovery_requests',          '',                         '',                         'teacher,applicant_gate']] LOOP
        EXECUTE format('DROP POLICY IF EXISTS role_no_insert ON admission.%I', spec[1]);
        EXECUTE format('DROP POLICY IF EXISTS role_no_update ON admission.%I', spec[1]);
        EXECUTE format('DROP POLICY IF EXISTS role_no_delete ON admission.%I', spec[1]);
        IF spec[2] <> '' THEN
            EXECUTE format('CREATE POLICY role_no_insert ON admission.%I AS RESTRICTIVE FOR INSERT '
                           'WITH CHECK (COALESCE(admission.current_actor_role(), '''') <> ALL (string_to_array(%L, '','')))', spec[1], spec[2]);
        END IF;
        IF spec[3] <> '' THEN
            EXECUTE format('CREATE POLICY role_no_update ON admission.%I AS RESTRICTIVE FOR UPDATE '
                           'USING (COALESCE(admission.current_actor_role(), '''') <> ALL (string_to_array(%L, '','')))', spec[1], spec[3]);
        END IF;
        IF spec[4] <> '' THEN
            EXECUTE format('CREATE POLICY role_no_delete ON admission.%I AS RESTRICTIVE FOR DELETE '
                           'USING (COALESCE(admission.current_actor_role(), '''') <> ALL (string_to_array(%L, '','')))', spec[1], spec[4]);
        END IF;
    END LOOP;
END $$;

-- ---------------------------------------------------------------- row-level security: Milestone 1 tables vs the new roles
-- Teachers, applicants and the login gate never touch the CRM / DPDP tables directly (a submission is copied into
-- applicants / guardians / consents by the server as `admission_system`).
DO $$
DECLARE t TEXT;
BEGIN
    FOREACH t IN ARRAY ARRAY['applicants', 'guardians', 'applicant_guardians', 'consents', 'data_requests',
                             'retention_policies', 'breach_log'] LOOP
        EXECUTE format('DROP POLICY IF EXISTS forms_roles_excluded ON admission.%I', t);
        EXECUTE format('CREATE POLICY forms_roles_excluded ON admission.%I AS RESTRICTIVE '
                       'USING (COALESCE(admission.current_actor_role(), '''') NOT IN (''teacher'', ''applicant'', ''applicant_gate'')) '
                       'WITH CHECK (COALESCE(admission.current_actor_role(), '''') NOT IN (''teacher'', ''applicant'', ''applicant_gate''))', t);
    END LOOP;
END $$;
-- The consent notice is readable in the applicant app (it is consented to before submitting); nobody new writes it.
DROP POLICY IF EXISTS forms_roles_read ON admission.consent_versions;
CREATE POLICY forms_roles_read ON admission.consent_versions AS RESTRICTIVE FOR SELECT
    USING (COALESCE(admission.current_actor_role(), '') NOT IN ('teacher', 'applicant_gate'));
DROP POLICY IF EXISTS forms_roles_insert ON admission.consent_versions;
CREATE POLICY forms_roles_insert ON admission.consent_versions AS RESTRICTIVE FOR INSERT
    WITH CHECK (COALESCE(admission.current_actor_role(), '') NOT IN ('teacher', 'applicant', 'applicant_gate'));
DROP POLICY IF EXISTS forms_roles_update ON admission.consent_versions;
CREATE POLICY forms_roles_update ON admission.consent_versions AS RESTRICTIVE FOR UPDATE
    USING (COALESCE(admission.current_actor_role(), '') NOT IN ('teacher', 'applicant', 'applicant_gate'));
DROP POLICY IF EXISTS forms_roles_delete ON admission.consent_versions;
CREATE POLICY forms_roles_delete ON admission.consent_versions AS RESTRICTIVE FOR DELETE
    USING (COALESCE(admission.current_actor_role(), '') NOT IN ('teacher', 'applicant', 'applicant_gate'));
-- Their actions are audited (insert), but they cannot read the audit log.
DROP POLICY IF EXISTS forms_roles_no_read ON admission.audit_log;
CREATE POLICY forms_roles_no_read ON admission.audit_log AS RESTRICTIVE FOR SELECT
    USING (COALESCE(admission.current_actor_role(), '') NOT IN ('teacher', 'applicant', 'applicant_gate'));

-- ---------------------------------------------------------------- privileges for the application role
GRANT SELECT, INSERT, UPDATE, DELETE ON admission.forms, admission.form_versions, admission.applications,
    admission.applicant_credentials, admission.applicant_sessions, admission.application_documents,
    admission.application_status_history, admission.application_comments, admission.recovery_requests TO admission_app;
GRANT USAGE, SELECT ON SEQUENCE admission.application_status_history_history_id_seq TO admission_app;
