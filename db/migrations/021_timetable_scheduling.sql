-- Timetable scheduling, online classes, and draft/publish workflow (Admin Dashboard Enhancement #4-#6).
-- Builds on 006_timetable_homework_frd_v3.sql without changing its existing uniqueness/clash-detection
-- behaviour: the (org_code, class_code, day_of_week, period_number) upsert key and the TEACHER_CLASH /
-- CLASS_CLASH rules are untouched. Saturday/Sunday (#3) and real-DB-ID dropdowns + time/clash validation
-- (#2) already worked before this migration; nothing here changes them.

ALTER TABLE public.timetable_slots
    ADD COLUMN IF NOT EXISTS schedule_type VARCHAR(16) NOT NULL DEFAULT 'WEEKLY',
    ADD COLUMN IF NOT EXISTS effective_from DATE,
    ADD COLUMN IF NOT EXISTS effective_to DATE,
    ADD COLUMN IF NOT EXISTS is_online BOOLEAN NOT NULL DEFAULT FALSE,
    ADD COLUMN IF NOT EXISTS online_url TEXT;

DO $$ BEGIN
    ALTER TABLE public.timetable_slots ADD CONSTRAINT timetable_slots_schedule_type_chk
        CHECK (schedule_type IN ('WEEKLY', 'MONTHLY', 'YEARLY'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.timetable_slots ADD CONSTRAINT timetable_slots_online_url_chk
        CHECK (NOT is_online OR online_url IS NOT NULL);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DO $$ BEGIN
    ALTER TABLE public.timetable_slots ADD CONSTRAINT timetable_slots_effective_range_chk
        CHECK (effective_to IS NULL OR effective_from IS NULL OR effective_to >= effective_from);
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- Per-class draft/publish (#6). Default PUBLISHED preserves all current behaviour: every existing class, and
-- any newly created one, starts visible to teachers/students exactly as before. An admin can flip a class to
-- DRAFT while reworking its whole week, hiding it from /my-timetable, then republish when ready.
ALTER TABLE public.classes
    ADD COLUMN IF NOT EXISTS timetable_status VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED',
    ADD COLUMN IF NOT EXISTS timetable_published_at TIMESTAMPTZ,
    ADD COLUMN IF NOT EXISTS timetable_published_by VARCHAR(64);

DO $$ BEGIN
    ALTER TABLE public.classes ADD CONSTRAINT classes_timetable_status_chk
        CHECK (timetable_status IN ('DRAFT', 'PUBLISHED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

-- usp_list_classes: surface the new publish status (same pattern as 013/020 extending this function).
DROP FUNCTION IF EXISTS public.usp_list_classes(VARCHAR);
CREATE FUNCTION public.usp_list_classes(p_org_code VARCHAR)
RETURNS TABLE (class_id UUID, class_code VARCHAR, class_name VARCHAR, year_code VARCHAR, cycle_code VARCHAR,
               class_teacher_code VARCHAR, class_teacher_name VARCHAR, is_active BOOLEAN, student_count BIGINT,
               subjects JSONB, room_number VARCHAR, grade_number INT, board VARCHAR,
               timetable_status VARCHAR, timetable_published_at TIMESTAMPTZ)
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
        c.room_number,
        c.grade_number,
        c.board,
        c.timetable_status,
        c.timetable_published_at
    FROM public.classes c
    LEFT JOIN public.app_users t ON t.org_code = c.org_code AND t.user_code = c.class_teacher_code
    WHERE c.org_code = p_org_code
    ORDER BY c.class_code;
$$;

-- usp_upsert_timetable_slot: add schedule_type / effective date range / online-class fields. Clash detection
-- (teacher and class overlap checks) and the upsert key are byte-for-byte unchanged from migration 006.
DROP FUNCTION IF EXISTS public.usp_upsert_timetable_slot(VARCHAR,VARCHAR,VARCHAR,VARCHAR,SMALLINT,SMALLINT,TIME,TIME,VARCHAR,VARCHAR);
CREATE FUNCTION public.usp_upsert_timetable_slot(
    p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR, p_teacher_code VARCHAR,
    p_day SMALLINT, p_period SMALLINT, p_start TIME, p_end TIME, p_room VARCHAR, p_created_by VARCHAR,
    p_schedule_type VARCHAR DEFAULT 'WEEKLY', p_effective_from DATE DEFAULT NULL, p_effective_to DATE DEFAULT NULL,
    p_is_online BOOLEAN DEFAULT FALSE, p_online_url TEXT DEFAULT NULL
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
                                       start_time, end_time, room_number, created_by,
                                       schedule_type, effective_from, effective_to, is_online, online_url)
    VALUES (p_org_code, p_class_code, p_subject_code, v_teacher, p_day, p_period, p_start, p_end, p_room, p_created_by,
            p_schedule_type, p_effective_from, p_effective_to, p_is_online, p_online_url)
    ON CONFLICT (org_code, class_code, day_of_week, period_number) DO UPDATE SET
        subject_code = EXCLUDED.subject_code, teacher_code = EXCLUDED.teacher_code,
        start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, room_number = EXCLUDED.room_number,
        created_by = EXCLUDED.created_by, schedule_type = EXCLUDED.schedule_type,
        effective_from = EXCLUDED.effective_from, effective_to = EXCLUDED.effective_to,
        is_online = EXCLUDED.is_online, online_url = EXCLUDED.online_url
    RETURNING slot_id INTO v_id;
    RETURN v_id;
END;
$$;

-- usp_list_timetable: surface the new fields, plus a p_student_view flag. When TRUE (used only by the teacher
-- and student /my-timetable endpoints), it hides slots belonging to a DRAFT class and slots outside their
-- effective date range. Admin's own listing always passes FALSE, so the builder sees and can edit everything.
DROP FUNCTION IF EXISTS public.usp_list_timetable(VARCHAR, VARCHAR, VARCHAR);
CREATE FUNCTION public.usp_list_timetable(
    p_org_code VARCHAR, p_class_code VARCHAR, p_teacher_code VARCHAR, p_student_view BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (slot_id UUID, class_code VARCHAR, class_name VARCHAR, subject_code VARCHAR, subject_name VARCHAR,
               subject_type VARCHAR, teacher_code VARCHAR, teacher_name VARCHAR, day_of_week SMALLINT,
               period_number SMALLINT, start_time TIME, end_time TIME, room_number VARCHAR,
               schedule_type VARCHAR, effective_from DATE, effective_to DATE, is_online BOOLEAN, online_url TEXT,
               class_timetable_status VARCHAR)
LANGUAGE sql
AS $$
    SELECT t.slot_id, t.class_code, c.class_name, t.subject_code, cs.subject_name, cs.subject_type, t.teacher_code,
           u.full_name, t.day_of_week, t.period_number, t.start_time, t.end_time,
           COALESCE(t.room_number, c.room_number),
           t.schedule_type, t.effective_from, t.effective_to, t.is_online, t.online_url, c.timetable_status
    FROM public.timetable_slots t
    JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code
    JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code
         AND cs.subject_code = t.subject_code
    LEFT JOIN public.app_users u ON u.org_code = t.org_code AND u.user_code = t.teacher_code
    WHERE t.org_code = p_org_code
      AND (p_class_code IS NULL OR t.class_code = p_class_code)
      AND (p_teacher_code IS NULL OR t.teacher_code = p_teacher_code)
      AND (NOT p_student_view OR (
            c.timetable_status = 'PUBLISHED'
            AND (t.effective_from IS NULL OR t.effective_from <= CURRENT_DATE)
            AND (t.effective_to IS NULL OR t.effective_to >= CURRENT_DATE)
      ))
    ORDER BY t.day_of_week, t.start_time, t.class_code;
$$;
