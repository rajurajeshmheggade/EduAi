-- 005: Institution administration (FR-AUTH, RBAC matrix 2.2) + attendance (FR-T3-01, FR-T3-02, FR-S4-04)
--
-- Hierarchy enforced by the API:
--   superadmin -> onboards institutions (organizations) and their first orgadmin
--   orgadmin   -> creates teachers and classes, assigns the class teacher and a teacher per class subject
--   teacher    -> the CLASS TEACHER creates students for their own class only;
--                 class teacher (any subject of the class) or SUBJECT TEACHER (their subject) marks attendance
--   student    -> reads own subject-wise, month-wise attendance

-- ---------------------------------------------------------------- tenant settings
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS attendance_threshold NUMERIC(5,2) NOT NULL DEFAULT 75,
    ADD COLUMN IF NOT EXISTS current_year_code VARCHAR(32) NOT NULL DEFAULT '2026-27',
    ADD COLUMN IF NOT EXISTS current_cycle_code VARCHAR(32) NOT NULL DEFAULT 'Term-1',
    ADD COLUMN IF NOT EXISTS city VARCHAR(100),
    ADD COLUMN IF NOT EXISTS contact_email VARCHAR(255),
    ADD COLUMN IF NOT EXISTS contact_phone VARCHAR(32),
    ADD COLUMN IF NOT EXISTS is_active BOOLEAN NOT NULL DEFAULT TRUE;

-- ---------------------------------------------------------------- user profile fields
ALTER TABLE public.app_users
    ADD COLUMN IF NOT EXISTS phone VARCHAR(32),
    ADD COLUMN IF NOT EXISTS roll_number VARCHAR(32),
    ADD COLUMN IF NOT EXISTS guardian_name VARCHAR(200),
    ADD COLUMN IF NOT EXISTS guardian_phone VARCHAR(32),
    ADD COLUMN IF NOT EXISTS created_by VARCHAR(64);

CREATE INDEX IF NOT EXISTS idx_app_users_org_role ON public.app_users(org_code, user_role, class_code);

-- ---------------------------------------------------------------- classes & subject teachers
CREATE TABLE IF NOT EXISTS public.classes (
    class_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    class_code VARCHAR(64) NOT NULL,
    class_name VARCHAR(200) NOT NULL,
    year_code VARCHAR(32) NOT NULL,
    cycle_code VARCHAR(32) NOT NULL,
    class_teacher_code VARCHAR(64),             -- app_users.user_code of the class teacher
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (org_code, class_code)
);

CREATE TABLE IF NOT EXISTS public.class_subjects (
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    subject_name VARCHAR(200) NOT NULL,
    teacher_code VARCHAR(64),                   -- subject teacher (app_users.user_code)
    created_at TIMESTAMPTZ DEFAULT NOW(),
    PRIMARY KEY (org_code, class_code, subject_code),
    FOREIGN KEY (org_code, class_code) REFERENCES public.classes(org_code, class_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_class_subjects_teacher ON public.class_subjects(org_code, teacher_code);

-- ---------------------------------------------------------------- attendance audit + lookups
ALTER TABLE public.attendance_records ADD COLUMN IF NOT EXISTS updated_at TIMESTAMPTZ DEFAULT NOW();
CREATE INDEX IF NOT EXISTS idx_attendance_class_subject_date
    ON public.attendance_records(org_code, class_code, subject_code, attendance_date);
CREATE INDEX IF NOT EXISTS idx_attendance_student_date
    ON public.attendance_records(org_code, student_user_code, attendance_date);

-- Login by email OR user code (admission / employee number) — younger students often have no email.
CREATE OR REPLACE FUNCTION public.usp_get_user_by_email(p_email VARCHAR, p_org_code VARCHAR DEFAULT NULL)
RETURNS SETOF public.app_users
LANGUAGE sql
AS $$
    SELECT u.* FROM public.app_users u
    LEFT JOIN public.organizations o ON o.org_code = u.org_code
    WHERE (u.email = lower(p_email) OR upper(u.user_code) = upper(p_email))
      AND u.is_active = TRUE
      AND COALESCE(o.is_active, TRUE) = TRUE
      AND (p_org_code IS NULL OR u.org_code = p_org_code)
    LIMIT 1;
$$;

-- ================================================================ organizations (superadmin)
CREATE OR REPLACE FUNCTION public.usp_create_org(
    p_org_code VARCHAR, p_customer_code VARCHAR, p_org_name VARCHAR, p_level VARCHAR,
    p_city VARCHAR, p_contact_email VARCHAR, p_contact_phone VARCHAR, p_year VARCHAR, p_cycle VARCHAR
)
RETURNS VOID
LANGUAGE sql
AS $$
    INSERT INTO public.organizations(org_code, customer_code, org_name, institution_level, city,
                                     contact_email, contact_phone, current_year_code, current_cycle_code)
    VALUES (p_org_code, p_customer_code, p_org_name, p_level, p_city, p_contact_email, p_contact_phone, p_year, p_cycle);
$$;

CREATE OR REPLACE FUNCTION public.usp_list_orgs()
RETURNS TABLE (org_code VARCHAR, org_name VARCHAR, institution_level VARCHAR, city VARCHAR,
               contact_email VARCHAR, is_active BOOLEAN, teachers BIGINT, students BIGINT, classes BIGINT,
               created_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT o.org_code, o.org_name, o.institution_level, o.city, o.contact_email, o.is_active,
        (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = o.org_code AND u.user_role = 'teacher'),
        (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = o.org_code AND u.user_role = 'student'),
        (SELECT COUNT(*) FROM public.classes c WHERE c.org_code = o.org_code),
        o.created_at
    FROM public.organizations o
    ORDER BY o.created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.usp_update_org_settings(
    p_org_code VARCHAR, p_org_name VARCHAR, p_level VARCHAR, p_threshold NUMERIC, p_year VARCHAR, p_cycle VARCHAR,
    p_is_active BOOLEAN
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_n INT;
BEGIN
    UPDATE public.organizations SET
        org_name = COALESCE(p_org_name, org_name),
        institution_level = COALESCE(p_level, institution_level),
        attendance_threshold = COALESCE(p_threshold, attendance_threshold),
        current_year_code = COALESCE(p_year, current_year_code),
        current_cycle_code = COALESCE(p_cycle, current_cycle_code),
        is_active = COALESCE(p_is_active, is_active)
    WHERE org_code = p_org_code;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- ================================================================ users
-- Strict create (no upsert): a duplicate user_code/email raises unique_violation -> HTTP 409.
CREATE OR REPLACE FUNCTION public.usp_create_member(
    p_user_code VARCHAR, p_org_code VARCHAR, p_customer_code VARCHAR, p_full_name VARCHAR, p_email VARCHAR,
    p_password_hash TEXT, p_user_role VARCHAR, p_year_code VARCHAR, p_cycle_code VARCHAR, p_class_code VARCHAR,
    p_allowed_subjects TEXT[], p_phone VARCHAR, p_roll_number VARCHAR, p_guardian_name VARCHAR,
    p_guardian_phone VARCHAR, p_created_by VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.app_users(user_code, org_code, customer_code, full_name, email, password_hash, user_role,
        year_code, cycle_code, class_code, allowed_subjects, phone, roll_number, guardian_name, guardian_phone, created_by)
    VALUES (p_user_code, p_org_code, p_customer_code, p_full_name, lower(p_email), p_password_hash, p_user_role,
        p_year_code, p_cycle_code, p_class_code, COALESCE(p_allowed_subjects, '{}'), p_phone, p_roll_number,
        p_guardian_name, p_guardian_phone, p_created_by)
    RETURNING user_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_list_members(p_org_code VARCHAR, p_role VARCHAR, p_class_code VARCHAR DEFAULT NULL)
RETURNS TABLE (user_id UUID, user_code VARCHAR, full_name VARCHAR, email VARCHAR, user_role VARCHAR,
               class_code VARCHAR, roll_number VARCHAR, phone VARCHAR, guardian_name VARCHAR,
               guardian_phone VARCHAR, allowed_subjects TEXT[], is_active BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT user_id, user_code, full_name, email, user_role, class_code, roll_number, phone, guardian_name,
           guardian_phone, allowed_subjects, is_active, created_at
    FROM public.app_users
    WHERE org_code = p_org_code AND user_role = p_role
      AND (p_class_code IS NULL OR class_code = p_class_code)
    ORDER BY
        CASE WHEN roll_number ~ '^[0-9]+$' THEN lpad(roll_number, 12, '0') ELSE COALESCE(roll_number, '~') END,
        full_name;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_member(p_org_code VARCHAR, p_user_code VARCHAR)
RETURNS SETOF public.app_users
LANGUAGE sql
AS $$
    SELECT * FROM public.app_users WHERE org_code = p_org_code AND user_code = p_user_code;
$$;

CREATE OR REPLACE FUNCTION public.usp_update_member(
    p_org_code VARCHAR, p_user_code VARCHAR, p_full_name VARCHAR, p_phone VARCHAR, p_roll_number VARCHAR,
    p_guardian_name VARCHAR, p_guardian_phone VARCHAR, p_is_active BOOLEAN, p_password_hash TEXT
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_n INT;
BEGIN
    UPDATE public.app_users SET
        full_name = COALESCE(p_full_name, full_name),
        phone = COALESCE(p_phone, phone),
        roll_number = COALESCE(p_roll_number, roll_number),
        guardian_name = COALESCE(p_guardian_name, guardian_name),
        guardian_phone = COALESCE(p_guardian_phone, guardian_phone),
        is_active = COALESCE(p_is_active, is_active),
        password_hash = COALESCE(p_password_hash, password_hash)
    WHERE org_code = p_org_code AND user_code = p_user_code;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- A teacher's allowed_subjects (JWT claim used for textbooks/RAG) = subjects they are assigned to teach.
CREATE OR REPLACE FUNCTION public.usp_refresh_teacher_subjects(p_org_code VARCHAR, p_teacher_code VARCHAR)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE public.app_users SET allowed_subjects = COALESCE((
        SELECT array_agg(DISTINCT cs.subject_code ORDER BY cs.subject_code)
        FROM public.class_subjects cs
        WHERE cs.org_code = p_org_code AND cs.teacher_code = p_teacher_code
    ), '{}')
    WHERE org_code = p_org_code AND user_code = p_teacher_code AND user_role = 'teacher';
$$;

-- ================================================================ classes
CREATE OR REPLACE FUNCTION public.usp_create_class(
    p_org_code VARCHAR, p_class_code VARCHAR, p_class_name VARCHAR, p_year VARCHAR, p_cycle VARCHAR,
    p_class_teacher_code VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.classes(org_code, class_code, class_name, year_code, cycle_code, class_teacher_code)
    VALUES (p_org_code, p_class_code, p_class_name, p_year, p_cycle, p_class_teacher_code)
    RETURNING class_id INTO v_id;
    RETURN v_id;
END;
$$;

-- Full replace of editable fields (p_class_teacher_code NULL clears the class teacher).
CREATE OR REPLACE FUNCTION public.usp_update_class(
    p_org_code VARCHAR, p_class_code VARCHAR, p_class_name VARCHAR, p_class_teacher_code VARCHAR, p_is_active BOOLEAN
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_n INT;
BEGIN
    UPDATE public.classes SET class_name = p_class_name, class_teacher_code = p_class_teacher_code,
                              is_active = p_is_active
    WHERE org_code = p_org_code AND class_code = p_class_code;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_list_classes(p_org_code VARCHAR)
RETURNS TABLE (class_id UUID, class_code VARCHAR, class_name VARCHAR, year_code VARCHAR, cycle_code VARCHAR,
               class_teacher_code VARCHAR, class_teacher_name VARCHAR, is_active BOOLEAN, student_count BIGINT,
               subjects JSONB)
LANGUAGE sql
AS $$
    SELECT c.class_id, c.class_code, c.class_name, c.year_code, c.cycle_code, c.class_teacher_code,
        t.full_name, c.is_active,
        (SELECT COUNT(*) FROM public.app_users s
         WHERE s.org_code = c.org_code AND s.class_code = c.class_code AND s.user_role = 'student' AND s.is_active),
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('subject_code', cs.subject_code, 'subject_name', cs.subject_name,
                     'teacher_code', cs.teacher_code, 'teacher_name', st.full_name) ORDER BY cs.subject_code)
            FROM public.class_subjects cs
            LEFT JOIN public.app_users st ON st.org_code = cs.org_code AND st.user_code = cs.teacher_code
            WHERE cs.org_code = c.org_code AND cs.class_code = c.class_code
        ), '[]'::jsonb)
    FROM public.classes c
    LEFT JOIN public.app_users t ON t.org_code = c.org_code AND t.user_code = c.class_teacher_code
    WHERE c.org_code = p_org_code
    ORDER BY c.class_code;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_class(p_org_code VARCHAR, p_class_code VARCHAR)
RETURNS SETOF public.classes
LANGUAGE sql
AS $$
    SELECT * FROM public.classes WHERE org_code = p_org_code AND class_code = p_class_code;
$$;

-- Add/replace a class subject and its teacher; students of the class gain the subject.
CREATE OR REPLACE FUNCTION public.usp_upsert_class_subject(
    p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR, p_subject_name VARCHAR, p_teacher_code VARCHAR
)
RETURNS VOID
LANGUAGE plpgsql
AS $$
DECLARE v_old VARCHAR;
BEGIN
    SELECT teacher_code INTO v_old FROM public.class_subjects
    WHERE org_code = p_org_code AND class_code = p_class_code AND subject_code = p_subject_code;

    INSERT INTO public.class_subjects(org_code, class_code, subject_code, subject_name, teacher_code)
    VALUES (p_org_code, p_class_code, p_subject_code, p_subject_name, p_teacher_code)
    ON CONFLICT (org_code, class_code, subject_code)
    DO UPDATE SET subject_name = EXCLUDED.subject_name, teacher_code = EXCLUDED.teacher_code;

    UPDATE public.app_users SET allowed_subjects = array_append(allowed_subjects, p_subject_code)
    WHERE org_code = p_org_code AND class_code = p_class_code AND user_role = 'student'
      AND NOT (p_subject_code = ANY(allowed_subjects));

    IF v_old IS NOT NULL AND v_old IS DISTINCT FROM p_teacher_code THEN
        PERFORM public.usp_refresh_teacher_subjects(p_org_code, v_old);
    END IF;
    IF p_teacher_code IS NOT NULL THEN
        PERFORM public.usp_refresh_teacher_subjects(p_org_code, p_teacher_code);
    END IF;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_delete_class_subject(p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_old VARCHAR; v_n INT;
BEGIN
    DELETE FROM public.class_subjects
    WHERE org_code = p_org_code AND class_code = p_class_code AND subject_code = p_subject_code
    RETURNING teacher_code INTO v_old;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    IF v_n = 0 THEN RETURN 0; END IF;

    UPDATE public.app_users SET allowed_subjects = array_remove(allowed_subjects, p_subject_code)
    WHERE org_code = p_org_code AND class_code = p_class_code AND user_role = 'student';
    IF v_old IS NOT NULL THEN
        PERFORM public.usp_refresh_teacher_subjects(p_org_code, v_old);
    END IF;
    RETURN v_n;
END;
$$;

-- Classes a teacher works with: as class teacher (all subjects markable) or as subject teacher (own subjects).
CREATE OR REPLACE FUNCTION public.usp_teacher_classes(p_org_code VARCHAR, p_teacher_code VARCHAR)
RETURNS TABLE (class_code VARCHAR, class_name VARCHAR, year_code VARCHAR, cycle_code VARCHAR,
               is_class_teacher BOOLEAN, student_count BIGINT, subjects JSONB)
LANGUAGE sql
AS $$
    SELECT c.class_code, c.class_name, c.year_code, c.cycle_code,
        (c.class_teacher_code = p_teacher_code),
        (SELECT COUNT(*) FROM public.app_users s
         WHERE s.org_code = c.org_code AND s.class_code = c.class_code AND s.user_role = 'student' AND s.is_active),
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('subject_code', cs.subject_code, 'subject_name', cs.subject_name,
                     'teacher_code', cs.teacher_code,
                     'is_mine', cs.teacher_code = p_teacher_code) ORDER BY cs.subject_code)
            FROM public.class_subjects cs
            WHERE cs.org_code = c.org_code AND cs.class_code = c.class_code
              AND (c.class_teacher_code = p_teacher_code OR cs.teacher_code = p_teacher_code)
        ), '[]'::jsonb)
    FROM public.classes c
    WHERE c.org_code = p_org_code AND c.is_active
      AND (c.class_teacher_code = p_teacher_code OR EXISTS (
            SELECT 1 FROM public.class_subjects cs
            WHERE cs.org_code = c.org_code AND cs.class_code = c.class_code AND cs.teacher_code = p_teacher_code))
    ORDER BY c.class_code;
$$;

CREATE OR REPLACE FUNCTION public.usp_can_mark_attendance(
    p_org_code VARCHAR, p_teacher_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR
)
RETURNS BOOLEAN
LANGUAGE sql
AS $$
    SELECT EXISTS (
        SELECT 1 FROM public.class_subjects cs
        JOIN public.classes c ON c.org_code = cs.org_code AND c.class_code = cs.class_code
        WHERE cs.org_code = p_org_code AND cs.class_code = p_class_code AND cs.subject_code = p_subject_code
          AND c.is_active
          AND (cs.teacher_code = p_teacher_code OR c.class_teacher_code = p_teacher_code)
    );
$$;

-- ================================================================ attendance
-- Upsert a batch: p_records = [{"student_user_code": "...", "status": "present|absent|late|excused", "remarks": "..."}]
-- Only active students of the class are written. Returns the number of rows saved.
CREATE OR REPLACE FUNCTION public.usp_save_attendance(
    p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR, p_date DATE, p_session_slot VARCHAR,
    p_teacher_code VARCHAR, p_records JSONB
)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_n INT; v_year VARCHAR; v_cycle VARCHAR;
BEGIN
    SELECT year_code, cycle_code INTO v_year, v_cycle FROM public.classes
    WHERE org_code = p_org_code AND class_code = p_class_code;

    INSERT INTO public.attendance_records(org_code, year_code, cycle_code, class_code, subject_code,
        student_user_code, attendance_date, session_slot, status, marked_by_teacher, remarks)
    SELECT p_org_code, v_year, v_cycle, p_class_code, p_subject_code, r.student_user_code, p_date,
           p_session_slot, r.status, p_teacher_code, NULLIF(r.remarks, '')
    FROM jsonb_to_recordset(p_records) AS r(student_user_code VARCHAR, status VARCHAR, remarks TEXT)
    JOIN public.app_users u ON u.org_code = p_org_code AND u.user_code = r.student_user_code
         AND u.class_code = p_class_code AND u.user_role = 'student' AND u.is_active
    ON CONFLICT (org_code, subject_code, student_user_code, attendance_date, session_slot)
    DO UPDATE SET status = EXCLUDED.status, remarks = EXCLUDED.remarks,
                  marked_by_teacher = EXCLUDED.marked_by_teacher, updated_at = NOW();
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

-- Roster for one class/subject/day with any saved marks.
CREATE OR REPLACE FUNCTION public.usp_attendance_day(
    p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR, p_date DATE, p_session_slot VARCHAR
)
RETURNS TABLE (student_user_code VARCHAR, full_name VARCHAR, roll_number VARCHAR, status VARCHAR, remarks TEXT,
               marked_by_teacher VARCHAR, updated_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT u.user_code, u.full_name, u.roll_number, a.status, a.remarks, a.marked_by_teacher, a.updated_at
    FROM public.app_users u
    LEFT JOIN public.attendance_records a
        ON a.org_code = u.org_code AND a.student_user_code = u.user_code AND a.subject_code = p_subject_code
       AND a.attendance_date = p_date AND a.session_slot = p_session_slot
    WHERE u.org_code = p_org_code AND u.class_code = p_class_code AND u.user_role = 'student' AND u.is_active
    ORDER BY
        CASE WHEN u.roll_number ~ '^[0-9]+$' THEN lpad(u.roll_number, 12, '0') ELSE COALESCE(u.roll_number, '~') END,
        u.full_name;
$$;

-- Raw marks for a class/subject in a date range (the API pivots them into a monthly register).
CREATE OR REPLACE FUNCTION public.usp_attendance_range(
    p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR, p_from DATE, p_to DATE
)
RETURNS TABLE (student_user_code VARCHAR, attendance_date DATE, session_slot VARCHAR, status VARCHAR)
LANGUAGE sql
AS $$
    SELECT student_user_code, attendance_date, session_slot, status
    FROM public.attendance_records
    WHERE org_code = p_org_code AND class_code = p_class_code AND subject_code = p_subject_code
      AND attendance_date BETWEEN p_from AND p_to
    ORDER BY attendance_date, session_slot;
$$;

-- A student's own marks across all subjects in a date range.
CREATE OR REPLACE FUNCTION public.usp_student_attendance(
    p_org_code VARCHAR, p_student_code VARCHAR, p_from DATE, p_to DATE
)
RETURNS TABLE (subject_code VARCHAR, attendance_date DATE, session_slot VARCHAR, status VARCHAR, remarks TEXT)
LANGUAGE sql
AS $$
    SELECT subject_code, attendance_date, session_slot, status, remarks
    FROM public.attendance_records
    WHERE org_code = p_org_code AND student_user_code = p_student_code
      AND attendance_date BETWEEN p_from AND p_to
    ORDER BY attendance_date, session_slot;
$$;

-- Institution-wide subject percentages for a date range (admin view).
CREATE OR REPLACE FUNCTION public.usp_org_attendance_summary(p_org_code VARCHAR, p_from DATE, p_to DATE)
RETURNS TABLE (class_code VARCHAR, subject_code VARCHAR, present BIGINT, absent BIGINT, late BIGINT,
               excused BIGINT, sessions BIGINT)
LANGUAGE sql
AS $$
    SELECT class_code, subject_code,
        COUNT(*) FILTER (WHERE status = 'present'),
        COUNT(*) FILTER (WHERE status = 'absent'),
        COUNT(*) FILTER (WHERE status = 'late'),
        COUNT(*) FILTER (WHERE status = 'excused'),
        COUNT(DISTINCT (attendance_date, session_slot))
    FROM public.attendance_records
    WHERE org_code = p_org_code AND attendance_date BETWEEN p_from AND p_to
    GROUP BY class_code, subject_code
    ORDER BY class_code, subject_code;
$$;
