-- 006: FRD v3 — institution profile & AI modules (FR-SA-01..03), subject types / room / teacher qualification
-- (FR-AD-03..05), weekly timetable with teacher double-booking guard (FR-AD-07, FR-TE-01, FR-ST-03),
-- period-wise attendance (FR-TE-03) and homework (FR-TE-04, FR-ST-04).

-- ---------------------------------------------------------------- institution profile (FR-SA-02)
ALTER TABLE public.organizations
    ADD COLUMN IF NOT EXISTS board_or_affiliation VARCHAR(120),
    ADD COLUMN IF NOT EXISTS address TEXT,
    ADD COLUMN IF NOT EXISTS max_students INT CHECK (max_students IS NULL OR max_students > 0),
    ADD COLUMN IF NOT EXISTS ai_modules TEXT[] NOT NULL
        DEFAULT '{rag_chatbot,ai_avatar_tutor,ocr_evaluation,capability_analysis}';

-- ---------------------------------------------------------------- users (FR-SA-01, FR-AD-05)
ALTER TABLE public.app_users
    ADD COLUMN IF NOT EXISTS qualification VARCHAR(200),
    -- Set for bootstrap / server-generated passwords; cleared when the user changes their password.
    ADD COLUMN IF NOT EXISTS must_change_password BOOLEAN NOT NULL DEFAULT FALSE;

-- ---------------------------------------------------------------- classes & subjects (FR-AD-03, FR-AD-04)
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS room_number VARCHAR(32);
ALTER TABLE public.class_subjects
    ADD COLUMN IF NOT EXISTS subject_type VARCHAR(32) NOT NULL DEFAULT 'THEORY'
        CHECK (subject_type IN ('THEORY', 'LAB', 'COACHING_TEST'));

-- ---------------------------------------------------------------- period-wise attendance (FR-TE-03)
UPDATE public.attendance_records SET session_slot = replace(session_slot, 'Session-', 'Period-')
WHERE session_slot LIKE 'Session-%';
ALTER TABLE public.attendance_records ALTER COLUMN session_slot SET DEFAULT 'Period-1';

-- ---------------------------------------------------------------- weekly timetable (FR-AD-07)
CREATE TABLE IF NOT EXISTS public.timetable_slots (
    slot_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    teacher_code VARCHAR(64),                       -- defaults to the class subject's teacher
    day_of_week SMALLINT NOT NULL CHECK (day_of_week BETWEEN 1 AND 7),   -- ISO: 1 = Monday
    period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 12),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    room_number VARCHAR(32),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_time > start_time),
    UNIQUE (org_code, class_code, day_of_week, period_number),
    FOREIGN KEY (org_code, class_code, subject_code)
        REFERENCES public.class_subjects(org_code, class_code, subject_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_timetable_teacher ON public.timetable_slots(org_code, teacher_code, day_of_week);

-- Create or replace the slot at (class, day, period). Raises 'TEACHER_CLASH: ...' (SQLSTATE P0001) if the teacher
-- already teaches another class in an overlapping time, and 'CLASS_CLASH: ...' if the class has an overlapping period.
CREATE OR REPLACE FUNCTION public.usp_upsert_timetable_slot(
    p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR, p_teacher_code VARCHAR,
    p_day SMALLINT, p_period SMALLINT, p_start TIME, p_end TIME, p_room VARCHAR, p_created_by VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID; v_teacher VARCHAR; v_clash RECORD;
BEGIN
    v_teacher := COALESCE(p_teacher_code, (SELECT teacher_code FROM public.class_subjects
        WHERE org_code = p_org_code AND class_code = p_class_code AND subject_code = p_subject_code));

    -- Serialise edits per institution so two admins cannot double-book the same teacher concurrently.
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_org_code));

    IF v_teacher IS NOT NULL THEN
        SELECT t.class_code, t.period_number, t.start_time, t.end_time INTO v_clash
        FROM public.timetable_slots t
        WHERE t.org_code = p_org_code AND t.teacher_code = v_teacher AND t.day_of_week = p_day
          AND NOT (t.class_code = p_class_code AND t.period_number = p_period)
          AND t.start_time < p_end AND p_start < t.end_time
        LIMIT 1;
        IF FOUND THEN
            RAISE EXCEPTION 'TEACHER_CLASH: % already teaches % (period %, %-%) at that time',
                v_teacher, v_clash.class_code, v_clash.period_number,
                to_char(v_clash.start_time, 'HH24:MI'), to_char(v_clash.end_time, 'HH24:MI');
        END IF;
    END IF;

    SELECT t.period_number INTO v_clash FROM public.timetable_slots t
    WHERE t.org_code = p_org_code AND t.class_code = p_class_code AND t.day_of_week = p_day
      AND t.period_number <> p_period AND t.start_time < p_end AND p_start < t.end_time
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION 'CLASS_CLASH: % already has period % at an overlapping time', p_class_code, v_clash.period_number;
    END IF;

    INSERT INTO public.timetable_slots(org_code, class_code, subject_code, teacher_code, day_of_week, period_number,
                                       start_time, end_time, room_number, created_by)
    VALUES (p_org_code, p_class_code, p_subject_code, v_teacher, p_day, p_period, p_start, p_end, p_room, p_created_by)
    ON CONFLICT (org_code, class_code, day_of_week, period_number) DO UPDATE SET
        subject_code = EXCLUDED.subject_code, teacher_code = EXCLUDED.teacher_code,
        start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, room_number = EXCLUDED.room_number,
        created_by = EXCLUDED.created_by
    RETURNING slot_id INTO v_id;
    RETURN v_id;
END;
$$;

-- Slots with display names; filter by class and/or teacher (NULL = any).
CREATE OR REPLACE FUNCTION public.usp_list_timetable(p_org_code VARCHAR, p_class_code VARCHAR, p_teacher_code VARCHAR)
RETURNS TABLE (slot_id UUID, class_code VARCHAR, class_name VARCHAR, subject_code VARCHAR, subject_name VARCHAR,
               subject_type VARCHAR, teacher_code VARCHAR, teacher_name VARCHAR, day_of_week SMALLINT,
               period_number SMALLINT, start_time TIME, end_time TIME, room_number VARCHAR)
LANGUAGE sql
AS $$
    SELECT t.slot_id, t.class_code, c.class_name, t.subject_code, cs.subject_name, cs.subject_type, t.teacher_code,
           u.full_name, t.day_of_week, t.period_number, t.start_time, t.end_time,
           COALESCE(t.room_number, c.room_number)
    FROM public.timetable_slots t
    JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code
    JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code
         AND cs.subject_code = t.subject_code
    LEFT JOIN public.app_users u ON u.org_code = t.org_code AND u.user_code = t.teacher_code
    WHERE t.org_code = p_org_code
      AND (p_class_code IS NULL OR t.class_code = p_class_code)
      AND (p_teacher_code IS NULL OR t.teacher_code = p_teacher_code)
    ORDER BY t.day_of_week, t.start_time, t.class_code;
$$;

-- A teacher scheduled for a class subject in the timetable (e.g. a substitute) may also mark its attendance.
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
          AND (cs.teacher_code = p_teacher_code OR c.class_teacher_code = p_teacher_code
               OR EXISTS (SELECT 1 FROM public.timetable_slots t
                          WHERE t.org_code = cs.org_code AND t.class_code = cs.class_code
                            AND t.subject_code = cs.subject_code AND t.teacher_code = p_teacher_code))
    );
$$;

-- ---------------------------------------------------------------- homework (FR-TE-04, FR-ST-04)
CREATE TABLE IF NOT EXISTS public.homeworks (
    homework_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    title VARCHAR(300) NOT NULL,
    instructions TEXT NOT NULL,
    attachment_key TEXT,                            -- storage key; served via signed URL
    attachment_name VARCHAR(255),
    due_date DATE NOT NULL,
    assigned_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (org_code, class_code, subject_code)
        REFERENCES public.class_subjects(org_code, class_code, subject_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_homeworks_class ON public.homeworks(org_code, class_code, due_date DESC);

CREATE TABLE IF NOT EXISTS public.homework_submissions (
    hw_submission_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    homework_id UUID NOT NULL REFERENCES public.homeworks(homework_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    student_user_code VARCHAR(64) NOT NULL,
    submission_notes TEXT,
    file_key TEXT,
    file_name VARCHAR(255),
    status VARCHAR(16) NOT NULL DEFAULT 'SUBMITTED' CHECK (status IN ('SUBMITTED', 'REVIEWED')),
    teacher_remarks TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(64),
    UNIQUE (homework_id, student_user_code)
);

-- Teacher view: homework of a class (optionally one subject) with submission counts.
CREATE OR REPLACE FUNCTION public.usp_list_homework(p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR)
RETURNS TABLE (homework_id UUID, class_code VARCHAR, subject_code VARCHAR, subject_name VARCHAR, title VARCHAR,
               instructions TEXT, attachment_key TEXT, attachment_name VARCHAR, due_date DATE, assigned_by VARCHAR,
               assigned_by_name VARCHAR, created_at TIMESTAMPTZ, students BIGINT, submitted BIGINT, reviewed BIGINT)
LANGUAGE sql
AS $$
    SELECT h.homework_id, h.class_code, h.subject_code, cs.subject_name, h.title, h.instructions, h.attachment_key,
           h.attachment_name, h.due_date, h.assigned_by, u.full_name, h.created_at,
           (SELECT COUNT(*) FROM public.app_users s WHERE s.org_code = h.org_code AND s.class_code = h.class_code
              AND s.user_role = 'student' AND s.is_active),
           (SELECT COUNT(*) FROM public.homework_submissions x WHERE x.homework_id = h.homework_id),
           (SELECT COUNT(*) FROM public.homework_submissions x WHERE x.homework_id = h.homework_id AND x.status = 'REVIEWED')
    FROM public.homeworks h
    JOIN public.class_subjects cs ON cs.org_code = h.org_code AND cs.class_code = h.class_code
         AND cs.subject_code = h.subject_code
    LEFT JOIN public.app_users u ON u.org_code = h.org_code AND u.user_code = h.assigned_by
    WHERE h.org_code = p_org_code AND h.class_code = p_class_code
      AND (p_subject_code IS NULL OR h.subject_code = p_subject_code)
    ORDER BY h.due_date DESC, h.created_at DESC;
$$;

-- Student view: own class homework with own submission status (PENDING when not submitted).
CREATE OR REPLACE FUNCTION public.usp_student_homework(p_org_code VARCHAR, p_student_code VARCHAR)
RETURNS TABLE (homework_id UUID, subject_code VARCHAR, subject_name VARCHAR, title VARCHAR, instructions TEXT,
               attachment_key TEXT, attachment_name VARCHAR, due_date DATE, assigned_by_name VARCHAR,
               created_at TIMESTAMPTZ, status VARCHAR, submission_notes TEXT, file_key TEXT, file_name VARCHAR,
               teacher_remarks TEXT, submitted_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT h.homework_id, h.subject_code, cs.subject_name, h.title, h.instructions, h.attachment_key,
           h.attachment_name, h.due_date, t.full_name, h.created_at, COALESCE(x.status, 'PENDING'),
           x.submission_notes, x.file_key, x.file_name, x.teacher_remarks, x.submitted_at
    FROM public.app_users s
    JOIN public.homeworks h ON h.org_code = s.org_code AND h.class_code = s.class_code
    JOIN public.class_subjects cs ON cs.org_code = h.org_code AND cs.class_code = h.class_code
         AND cs.subject_code = h.subject_code
    LEFT JOIN public.app_users t ON t.org_code = h.org_code AND t.user_code = h.assigned_by
    LEFT JOIN public.homework_submissions x ON x.homework_id = h.homework_id AND x.student_user_code = s.user_code
    WHERE s.org_code = p_org_code AND s.user_code = p_student_code
    ORDER BY h.due_date DESC, h.created_at DESC;
$$;

-- Teacher view: every active student of the class with their submission (if any) for one homework.
CREATE OR REPLACE FUNCTION public.usp_homework_submissions(p_org_code VARCHAR, p_homework_id UUID)
RETURNS TABLE (student_user_code VARCHAR, full_name VARCHAR, roll_number VARCHAR, status VARCHAR,
               submission_notes TEXT, file_key TEXT, file_name VARCHAR, teacher_remarks TEXT,
               submitted_at TIMESTAMPTZ, reviewed_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT s.user_code, s.full_name, s.roll_number, COALESCE(x.status, 'PENDING'), x.submission_notes, x.file_key,
           x.file_name, x.teacher_remarks, x.submitted_at, x.reviewed_at
    FROM public.homeworks h
    JOIN public.app_users s ON s.org_code = h.org_code AND s.class_code = h.class_code AND s.user_role = 'student'
    LEFT JOIN public.homework_submissions x ON x.homework_id = h.homework_id AND x.student_user_code = s.user_code
    WHERE h.org_code = p_org_code AND h.homework_id = p_homework_id AND (s.is_active OR x.hw_submission_id IS NOT NULL)
    ORDER BY CASE WHEN s.roll_number ~ '^[0-9]+$' THEN lpad(s.roll_number, 12, '0') ELSE COALESCE(s.roll_number, '~') END,
             s.full_name;
$$;

-- ---------------------------------------------------------------- list functions returning the new columns
DROP FUNCTION IF EXISTS public.usp_list_classes(VARCHAR);
CREATE FUNCTION public.usp_list_classes(p_org_code VARCHAR)
RETURNS TABLE (class_id UUID, class_code VARCHAR, class_name VARCHAR, year_code VARCHAR, cycle_code VARCHAR,
               class_teacher_code VARCHAR, class_teacher_name VARCHAR, is_active BOOLEAN, student_count BIGINT,
               subjects JSONB, room_number VARCHAR)
LANGUAGE sql
AS $$
    SELECT c.class_id, c.class_code, c.class_name, c.year_code, c.cycle_code, c.class_teacher_code,
        t.full_name, c.is_active,
        (SELECT COUNT(*) FROM public.app_users s
         WHERE s.org_code = c.org_code AND s.class_code = c.class_code AND s.user_role = 'student' AND s.is_active),
        COALESCE((
            SELECT jsonb_agg(jsonb_build_object('subject_code', cs.subject_code, 'subject_name', cs.subject_name,
                     'subject_type', cs.subject_type, 'teacher_code', cs.teacher_code, 'teacher_name', st.full_name)
                     ORDER BY cs.subject_code)
            FROM public.class_subjects cs
            LEFT JOIN public.app_users st ON st.org_code = cs.org_code AND st.user_code = cs.teacher_code
            WHERE cs.org_code = c.org_code AND cs.class_code = c.class_code
        ), '[]'::jsonb),
        c.room_number
    FROM public.classes c
    LEFT JOIN public.app_users t ON t.org_code = c.org_code AND t.user_code = c.class_teacher_code
    WHERE c.org_code = p_org_code
    ORDER BY c.class_code;
$$;

DROP FUNCTION IF EXISTS public.usp_list_members(VARCHAR, VARCHAR, VARCHAR);
CREATE FUNCTION public.usp_list_members(p_org_code VARCHAR, p_role VARCHAR, p_class_code VARCHAR DEFAULT NULL)
RETURNS TABLE (user_id UUID, user_code VARCHAR, full_name VARCHAR, email VARCHAR, user_role VARCHAR,
               class_code VARCHAR, roll_number VARCHAR, phone VARCHAR, guardian_name VARCHAR,
               guardian_phone VARCHAR, allowed_subjects TEXT[], is_active BOOLEAN, created_at TIMESTAMPTZ,
               qualification VARCHAR)
LANGUAGE sql
AS $$
    SELECT user_id, user_code, full_name, email, user_role, class_code, roll_number, phone, guardian_name,
           guardian_phone, allowed_subjects, is_active, created_at, qualification
    FROM public.app_users
    WHERE org_code = p_org_code AND user_role = p_role
      AND (p_class_code IS NULL OR class_code = p_class_code)
    ORDER BY
        CASE WHEN roll_number ~ '^[0-9]+$' THEN lpad(roll_number, 12, '0') ELSE COALESCE(roll_number, '~') END,
        full_name;
$$;

DROP FUNCTION IF EXISTS public.usp_list_orgs();
CREATE FUNCTION public.usp_list_orgs()
RETURNS TABLE (org_code VARCHAR, org_name VARCHAR, institution_level VARCHAR, city VARCHAR,
               contact_email VARCHAR, is_active BOOLEAN, teachers BIGINT, students BIGINT, classes BIGINT,
               created_at TIMESTAMPTZ, board_or_affiliation VARCHAR, max_students INT, ai_modules TEXT[],
               admins BIGINT)
LANGUAGE sql
AS $$
    SELECT o.org_code, o.org_name, o.institution_level, o.city, o.contact_email, o.is_active,
        (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = o.org_code AND u.user_role = 'teacher'),
        (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = o.org_code AND u.user_role = 'student'),
        (SELECT COUNT(*) FROM public.classes c WHERE c.org_code = o.org_code),
        o.created_at, o.board_or_affiliation, o.max_students, o.ai_modules,
        (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = o.org_code AND u.user_role = 'orgadmin')
    FROM public.organizations o
    WHERE NOT EXISTS (SELECT 1 FROM public.app_users u           -- hide the platform owner's own tenant
                      WHERE u.org_code = o.org_code AND u.user_role = 'superadmin')
    ORDER BY o.created_at DESC;
$$;
