-- 028: Date-level timetable management (Super Admin / admin console, spec 5.1-5.4).
--
-- The weekly template (public.timetable_slots) stays the recurring pattern. On top of it this adds:
--   * timetable_settings      per-institution working days (Mon-Sun all selectable; Sat/Sun configurable)
--   * timetable_bell_items    bell schedule: numbered periods + named breaks, per institution, optionally per weekday
--   * rooms                   rooms master (picklist + capacity); room clashes compare the effective room text
--   * timetable_dated_entries per-date additions, overrides of a weekly period, and single-date cancellations
--   * usp_resolve_timetable   concrete sessions for a date range = template (working days, effective range)
--                             merged with dated entries and full-day published holidays
--   * usp_timetable_conflicts every teacher / class (overlapping period) / room clash for a weekly or a dated period,
--                             effective-range and date aware, plus non-working-day errors and holiday / break warnings
-- usp_upsert_timetable_slot keeps its signature and upsert key but now uses the same conflict rules (range aware,
-- room clash); usp_can_mark_attendance also accepts a teacher scheduled through a dated session.

-- ---------------------------------------------------------------- working days
CREATE TABLE IF NOT EXISTS public.timetable_settings (
    org_code VARCHAR(64) PRIMARY KEY REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    -- ISO weekdays (1 = Monday ... 7 = Sunday) on which the institution schedules classes. No row = every day,
    -- which is exactly how the weekly grid behaved before this migration.
    working_days SMALLINT[] NOT NULL DEFAULT '{1,2,3,4,5,6,7}',
    updated_by VARCHAR(64),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (cardinality(working_days) BETWEEN 1 AND 7 AND working_days <@ '{1,2,3,4,5,6,7}'::SMALLINT[])
);

CREATE OR REPLACE FUNCTION public.usp_working_days(p_org_code VARCHAR)
RETURNS SMALLINT[]
LANGUAGE sql STABLE
AS $$
    SELECT COALESCE((SELECT working_days FROM public.timetable_settings WHERE org_code = p_org_code),
                    '{1,2,3,4,5,6,7}'::SMALLINT[]);
$$;

-- ---------------------------------------------------------------- bell schedule (periods + breaks)
CREATE TABLE IF NOT EXISTS public.timetable_bell_items (
    item_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    day_of_week SMALLINT CHECK (day_of_week BETWEEN 1 AND 7),   -- NULL = every day without its own schedule
    item_kind VARCHAR(8) NOT NULL CHECK (item_kind IN ('PERIOD', 'BREAK')),
    period_number SMALLINT CHECK (period_number BETWEEN 1 AND 12),
    label VARCHAR(60),
    start_time TIME NOT NULL,
    end_time TIME NOT NULL,
    CHECK (end_time > start_time),
    CHECK ((item_kind = 'PERIOD') = (period_number IS NOT NULL))
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_bell_period_unique
    ON public.timetable_bell_items(org_code, COALESCE(day_of_week, 0), period_number) WHERE item_kind = 'PERIOD';
CREATE INDEX IF NOT EXISTS idx_bell_org_day ON public.timetable_bell_items(org_code, day_of_week);

-- The whole bell schedule of an institution: the default (day_of_week NULL) plus any weekday-specific ones. An
-- institution that has not configured one gets the bell the app always used (8 x 45 min from 09:00, a 15-minute
-- break after period 3), flagged is_configured = FALSE.
CREATE OR REPLACE FUNCTION public.usp_bell_schedule(p_org_code VARCHAR)
RETURNS TABLE (day_of_week SMALLINT, item_kind VARCHAR, period_number SMALLINT, label VARCHAR,
               start_time TIME, end_time TIME, is_configured BOOLEAN)
LANGUAGE sql STABLE
AS $$
    SELECT b.day_of_week, b.item_kind, b.period_number, b.label, b.start_time, b.end_time, TRUE
    FROM public.timetable_bell_items b WHERE b.org_code = p_org_code
    UNION ALL
    SELECT NULL::SMALLINT, 'PERIOD'::VARCHAR, n::SMALLINT, ('Period ' || n)::VARCHAR,
           TIME '09:00' + make_interval(mins => (n - 1) * 45 + CASE WHEN n > 3 THEN 15 ELSE 0 END),
           TIME '09:45' + make_interval(mins => (n - 1) * 45 + CASE WHEN n > 3 THEN 15 ELSE 0 END), FALSE
    FROM generate_series(1, 8) n
    WHERE NOT EXISTS (SELECT 1 FROM public.timetable_bell_items x WHERE x.org_code = p_org_code)
    UNION ALL
    SELECT NULL::SMALLINT, 'BREAK'::VARCHAR, NULL::SMALLINT, 'Break'::VARCHAR, TIME '11:15', TIME '11:30', FALSE
    WHERE NOT EXISTS (SELECT 1 FROM public.timetable_bell_items x WHERE x.org_code = p_org_code)
    ORDER BY 1 NULLS FIRST, 5, 2 DESC;
$$;

-- The bell that applies on one weekday: its own schedule if it has one, else the default.
CREATE OR REPLACE FUNCTION public.usp_bell_for_day(p_org_code VARCHAR, p_day SMALLINT)
RETURNS TABLE (item_kind VARCHAR, period_number SMALLINT, label VARCHAR, start_time TIME, end_time TIME)
LANGUAGE sql STABLE
AS $$
    WITH b AS (SELECT * FROM public.usp_bell_schedule(p_org_code))
    SELECT b.item_kind, b.period_number, b.label, b.start_time, b.end_time FROM b
    WHERE b.day_of_week IS NOT DISTINCT FROM
          (CASE WHEN EXISTS (SELECT 1 FROM b WHERE b.day_of_week = p_day) THEN p_day END)
    ORDER BY b.start_time;
$$;

-- ---------------------------------------------------------------- rooms master
CREATE TABLE IF NOT EXISTS public.rooms (
    room_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    room_code VARCHAR(32) NOT NULL,             -- what timetable periods store in room_number
    room_name VARCHAR(120),
    room_type VARCHAR(16) NOT NULL DEFAULT 'CLASSROOM' CHECK (room_type IN ('CLASSROOM', 'LAB', 'HALL', 'OTHER')),
    capacity INT CHECK (capacity IS NULL OR capacity > 0),
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE UNIQUE INDEX IF NOT EXISTS idx_rooms_org_room_code ON public.rooms(org_code, upper(room_code));

-- ---------------------------------------------------------------- dated entries
-- One row per (class, date, period). SESSION = a concrete period on that date: it replaces the weekly period with
-- the same number (an override / substitution) or, if there is none, adds one. CANCELLED = the weekly period does
-- not happen on that date.
CREATE TABLE IF NOT EXISTS public.timetable_dated_entries (
    entry_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    session_date DATE NOT NULL,
    period_number SMALLINT NOT NULL CHECK (period_number BETWEEN 1 AND 12),
    entry_kind VARCHAR(16) NOT NULL CHECK (entry_kind IN ('SESSION', 'CANCELLED')),
    subject_code VARCHAR(64),
    teacher_code VARCHAR(64),
    start_time TIME,
    end_time TIME,
    room_number VARCHAR(32),
    is_online BOOLEAN NOT NULL DEFAULT FALSE,
    online_url TEXT,
    note VARCHAR(300),                           -- reason / remark shown on the calendar
    copied_from DATE,                            -- source date when created by "copy from date"
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (org_code, class_code, session_date, period_number),
    FOREIGN KEY (org_code, class_code) REFERENCES public.classes(org_code, class_code) ON DELETE CASCADE,
    FOREIGN KEY (org_code, class_code, subject_code)
        REFERENCES public.class_subjects(org_code, class_code, subject_code) ON DELETE CASCADE,
    CHECK (entry_kind = 'CANCELLED'
           OR (subject_code IS NOT NULL AND start_time IS NOT NULL AND end_time IS NOT NULL AND end_time > start_time)),
    CHECK (NOT is_online OR online_url IS NOT NULL)
);
CREATE INDEX IF NOT EXISTS idx_dated_org_date ON public.timetable_dated_entries(org_code, session_date);
CREATE INDEX IF NOT EXISTS idx_dated_teacher ON public.timetable_dated_entries(org_code, teacher_code, session_date);

-- ---------------------------------------------------------------- change history: dated changes
ALTER TABLE public.timetable_slot_changes
    ADD COLUMN IF NOT EXISTS session_date DATE,          -- NULL = a change to the weekly template
    ADD COLUMN IF NOT EXISTS entry_id UUID;
ALTER TABLE public.timetable_slot_changes DROP CONSTRAINT IF EXISTS timetable_slot_changes_change_kind_check;
DO $$ BEGIN
    ALTER TABLE public.timetable_slot_changes ADD CONSTRAINT timetable_slot_changes_change_kind_check
        CHECK (change_kind IN ('UPDATED', 'CANCELLED', 'ADDED', 'RESTORED'));
EXCEPTION WHEN duplicate_object THEN NULL; END $$;

DROP FUNCTION IF EXISTS public.usp_recent_timetable_changes(VARCHAR, VARCHAR, INT);
CREATE FUNCTION public.usp_recent_timetable_changes(p_org_code VARCHAR, p_class_code VARCHAR, p_since_days INT DEFAULT 14)
RETURNS TABLE (change_id UUID, class_code VARCHAR, day_of_week SMALLINT, period_number SMALLINT, change_kind VARCHAR,
               old_subject_name VARCHAR, old_teacher_name VARCHAR, old_start_time TIME, old_end_time TIME,
               new_subject_name VARCHAR, new_teacher_name VARCHAR, new_start_time TIME, new_end_time TIME,
               reason TEXT, changed_by_name VARCHAR, changed_at TIMESTAMPTZ, session_date DATE)
LANGUAGE sql
AS $$
    SELECT change_id, class_code, day_of_week, period_number, change_kind, old_subject_name, old_teacher_name,
           old_start_time, old_end_time, new_subject_name, new_teacher_name, new_start_time, new_end_time,
           reason, changed_by_name, changed_at, session_date
    FROM public.timetable_slot_changes
    WHERE org_code = p_org_code AND (p_class_code IS NULL OR class_code = p_class_code)
      AND changed_at >= NOW() - (p_since_days || ' days')::interval
    ORDER BY changed_at DESC;
$$;

-- ---------------------------------------------------------------- resolver
-- Concrete sessions for [p_from, p_to]: every weekly period on its working weekdays inside its effective range,
-- merged with the dated entries for (class, date, period). status: SCHEDULED, CANCELLED (a dated cancellation) or
-- HOLIDAY (a weekly period on a published full-day holiday of that class; explicitly dated sessions still run).
-- source: TEMPLATE (weekly), OVERRIDE (dated entry replacing a weekly period) or DATED (dated addition).
-- p_teacher_code also returns weekly periods of that teacher that were reassigned on the date (template_teacher_code).
-- p_student_view hides DRAFT classes.
CREATE OR REPLACE FUNCTION public.usp_resolve_timetable(
    p_org_code VARCHAR, p_from DATE, p_to DATE, p_class_code VARCHAR DEFAULT NULL, p_teacher_code VARCHAR DEFAULT NULL,
    p_student_view BOOLEAN DEFAULT FALSE
)
RETURNS TABLE (session_date DATE, day_of_week SMALLINT, class_code VARCHAR, class_name VARCHAR, period_number SMALLINT,
               start_time TIME, end_time TIME, subject_code VARCHAR, subject_name VARCHAR, subject_type VARCHAR,
               teacher_code VARCHAR, teacher_name VARCHAR, room_number VARCHAR, is_online BOOLEAN, online_url TEXT,
               source VARCHAR, status VARCHAR, slot_id UUID, entry_id UUID, schedule_type VARCHAR,
               template_teacher_code VARCHAR, note VARCHAR, holiday_name VARCHAR, class_timetable_status VARCHAR,
               copied_from DATE)
LANGUAGE sql STABLE
AS $$
    WITH days AS (
        SELECT g::DATE AS d, EXTRACT(ISODOW FROM g)::SMALLINT AS dow
        FROM generate_series(p_from::TIMESTAMP, p_to::TIMESTAMP, INTERVAL '1 day') g
    ),
    tm AS (
        SELECT days.d, t.*
        FROM days
        JOIN public.timetable_slots t ON t.org_code = p_org_code AND t.day_of_week = days.dow
        WHERE days.dow = ANY(public.usp_working_days(p_org_code))
          AND (t.effective_from IS NULL OR t.effective_from <= days.d)
          AND (t.effective_to IS NULL OR t.effective_to >= days.d)
          AND (p_class_code IS NULL OR t.class_code = p_class_code)
    ),
    de AS (
        SELECT e.* FROM public.timetable_dated_entries e
        WHERE e.org_code = p_org_code AND e.session_date BETWEEN p_from AND p_to
          AND (p_class_code IS NULL OR e.class_code = p_class_code)
    ),
    merged AS (
        SELECT COALESCE(tm.d, de.session_date) AS d,
               COALESCE(tm.class_code, de.class_code) AS class_code,
               COALESCE(tm.period_number, de.period_number) AS period_number,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.start_time ELSE tm.start_time END AS start_time,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.end_time ELSE tm.end_time END AS end_time,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.subject_code ELSE tm.subject_code END AS subject_code,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.teacher_code ELSE tm.teacher_code END AS teacher_code,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.room_number ELSE tm.room_number END AS room_number,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.is_online ELSE tm.is_online END AS is_online,
               CASE WHEN de.entry_kind = 'SESSION' THEN de.online_url ELSE tm.online_url END AS online_url,
               CASE WHEN tm.slot_id IS NULL THEN 'DATED' WHEN de.entry_id IS NULL THEN 'TEMPLATE' ELSE 'OVERRIDE' END AS source,
               de.entry_kind, tm.slot_id, de.entry_id, tm.schedule_type, tm.teacher_code AS template_teacher_code,
               de.note, de.copied_from
        FROM tm
        FULL OUTER JOIN de ON de.class_code = tm.class_code AND de.session_date = tm.d
                          AND de.period_number = tm.period_number
    )
    SELECT m.d, EXTRACT(ISODOW FROM m.d)::SMALLINT, m.class_code, c.class_name, m.period_number,
           m.start_time, m.end_time, m.subject_code, cs.subject_name, cs.subject_type,
           m.teacher_code, u.full_name, COALESCE(NULLIF(btrim(m.room_number), ''), c.room_number),
           m.is_online, m.online_url, m.source::VARCHAR,
           (CASE WHEN m.entry_kind = 'CANCELLED' THEN 'CANCELLED'
                 WHEN m.source = 'TEMPLATE' AND h.name IS NOT NULL THEN 'HOLIDAY'
                 ELSE 'SCHEDULED' END)::VARCHAR,
           m.slot_id, m.entry_id, m.schedule_type, m.template_teacher_code, m.note, h.name, c.timetable_status,
           m.copied_from
    FROM merged m
    JOIN public.classes c ON c.org_code = p_org_code AND c.class_code = m.class_code
    LEFT JOIN public.class_subjects cs ON cs.org_code = p_org_code AND cs.class_code = m.class_code
         AND cs.subject_code = m.subject_code
    LEFT JOIN public.app_users u ON u.org_code = p_org_code AND u.user_code = m.teacher_code
    LEFT JOIN LATERAL (
        SELECT hh.name FROM public.holidays hh
        WHERE hh.org_code = p_org_code AND hh.status = 'PUBLISHED' AND hh.is_full_day
          AND m.d BETWEEN hh.start_date AND hh.end_date
          AND (hh.scope = 'SCHOOL_WIDE' OR m.class_code = ANY(hh.class_codes))
        ORDER BY hh.start_date LIMIT 1
    ) h ON TRUE
    WHERE NOT (m.source = 'DATED' AND m.entry_kind = 'CANCELLED')   -- nothing left to cancel on that date
      AND (p_teacher_code IS NULL OR m.teacher_code = p_teacher_code OR m.template_teacher_code = p_teacher_code)
      AND (NOT p_student_view OR c.timetable_status = 'PUBLISHED')
    ORDER BY m.d, m.start_time, m.class_code, m.period_number;
$$;

-- ---------------------------------------------------------------- conflict detection
-- Every conflict of one candidate period. Dated mode (p_date set): against the resolved sessions of that date (the
-- candidate's own (class, date, period) is the one it replaces). Weekly mode (p_date NULL, p_day set): against weekly
-- periods on that weekday whose effective range intersects the candidate's, and against dated sessions on upcoming
-- dates the weekly period would actually run on. Errors block a save; warnings (holiday, break overlap) are advisory.
CREATE OR REPLACE FUNCTION public.usp_timetable_conflicts(
    p_org_code VARCHAR, p_class_code VARCHAR, p_period SMALLINT, p_start TIME, p_end TIME,
    p_teacher_code VARCHAR, p_room VARCHAR, p_is_online BOOLEAN,
    p_date DATE, p_day SMALLINT, p_effective_from DATE DEFAULT NULL, p_effective_to DATE DEFAULT NULL
)
RETURNS TABLE (kind VARCHAR, severity VARCHAR, message TEXT, conflict_date DATE, day_of_week SMALLINT,
               class_code VARCHAR, period_number SMALLINT, start_time TIME, end_time TIME,
               teacher_code VARCHAR, room_number VARCHAR, subject_name VARCHAR, source VARCHAR)
LANGUAGE plpgsql STABLE
AS $$
#variable_conflict use_column
DECLARE
    v_dow SMALLINT := CASE WHEN p_date IS NOT NULL THEN EXTRACT(ISODOW FROM p_date)::SMALLINT ELSE p_day END;
    v_days TEXT[] := ARRAY['Monday', 'Tuesday', 'Wednesday', 'Thursday', 'Friday', 'Saturday', 'Sunday'];
    v_room VARCHAR;
    v_key VARCHAR;
    v_from DATE := GREATEST(CURRENT_DATE, COALESCE(p_effective_from, CURRENT_DATE));
BEGIN
    SELECT COALESCE(NULLIF(btrim(p_room), ''), c.room_number) INTO v_room
    FROM public.classes c WHERE c.org_code = p_org_code AND c.class_code = p_class_code;
    v_key := CASE WHEN p_is_online THEN NULL ELSE NULLIF(upper(btrim(v_room)), '') END;

    IF NOT (v_dow = ANY(public.usp_working_days(p_org_code))) THEN
        RETURN QUERY SELECT 'NON_WORKING_DAY'::VARCHAR, 'error'::VARCHAR,
            format('%s is not a working day for this institution — enable it under Working days first', v_days[v_dow]),
            p_date, v_dow, p_class_code, p_period, p_start, p_end, p_teacher_code, v_room, NULL::VARCHAR, NULL::VARCHAR;
    END IF;

    IF p_date IS NOT NULL THEN
        RETURN QUERY
        WITH o AS (
            SELECT r.* FROM public.usp_resolve_timetable(p_org_code, p_date, p_date) r
            WHERE r.status = 'SCHEDULED' AND NOT (r.class_code = p_class_code AND r.period_number = p_period)
              AND r.start_time < p_end AND p_start < r.end_time
        )
        SELECT k.kind::VARCHAR, 'error'::VARCHAR, k.msg, o.session_date, o.day_of_week, o.class_code, o.period_number,
               o.start_time, o.end_time, o.teacher_code, o.room_number, o.subject_name, o.source
        FROM o CROSS JOIN LATERAL (VALUES
            ('TEACHER_CLASH', p_teacher_code IS NOT NULL AND o.teacher_code = p_teacher_code,
             format('%s already teaches %s (period %s, %s-%s) on %s', p_teacher_code, o.class_code, o.period_number,
                    to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), to_char(p_date, 'Dy DD Mon YYYY'))),
            ('CLASS_CLASH', o.class_code = p_class_code,
             format('%s already has period %s (%s-%s) at an overlapping time on %s', p_class_code, o.period_number,
                    to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), to_char(p_date, 'Dy DD Mon YYYY'))),
            ('ROOM_CLASH', v_key IS NOT NULL AND NOT o.is_online AND upper(btrim(o.room_number)) = v_key,
             format('Room %s is already used by %s (period %s, %s-%s) on %s', v_room, o.class_code, o.period_number,
                    to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), to_char(p_date, 'Dy DD Mon YYYY')))
        ) k(kind, hit, msg)
        WHERE k.hit;

        RETURN QUERY
        SELECT 'HOLIDAY'::VARCHAR, 'warning'::VARCHAR,
               format('%s is a holiday (%s) — the session will still be shown as scheduled', to_char(p_date, 'Dy DD Mon YYYY'), h.name)::TEXT,
               p_date, v_dow, p_class_code, p_period, p_start, p_end, p_teacher_code, v_room, NULL::VARCHAR, NULL::VARCHAR
        FROM public.holidays h
        WHERE h.org_code = p_org_code AND h.status = 'PUBLISHED' AND h.is_full_day
          AND p_date BETWEEN h.start_date AND h.end_date
          AND (h.scope = 'SCHOOL_WIDE' OR p_class_code = ANY(h.class_codes))
        LIMIT 1;
    ELSE
        RETURN QUERY
        WITH o AS (
            SELECT t.class_code, t.period_number, t.start_time, t.end_time, t.teacher_code, t.is_online,
                   COALESCE(NULLIF(btrim(t.room_number), ''), c.room_number)::VARCHAR AS room_number, cs.subject_name
            FROM public.timetable_slots t
            JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code
            LEFT JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code
                 AND cs.subject_code = t.subject_code
            WHERE t.org_code = p_org_code AND t.day_of_week = v_dow
              AND NOT (t.class_code = p_class_code AND t.period_number = p_period)
              AND t.start_time < p_end AND p_start < t.end_time
              AND (t.effective_from IS NULL OR p_effective_to IS NULL OR t.effective_from <= p_effective_to)
              AND (t.effective_to IS NULL OR p_effective_from IS NULL OR t.effective_to >= p_effective_from)
        )
        SELECT k.kind::VARCHAR, 'error'::VARCHAR, k.msg, NULL::DATE, v_dow, o.class_code, o.period_number,
               o.start_time, o.end_time, o.teacher_code, o.room_number, o.subject_name, 'TEMPLATE'::VARCHAR
        FROM o CROSS JOIN LATERAL (VALUES
            ('TEACHER_CLASH', p_teacher_code IS NOT NULL AND o.teacher_code = p_teacher_code,
             format('%s already teaches %s (period %s, %s-%s) at that time', p_teacher_code, o.class_code,
                    o.period_number, to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'))),
            ('CLASS_CLASH', o.class_code = p_class_code,
             format('%s already has period %s at an overlapping time', p_class_code, o.period_number)),
            ('ROOM_CLASH', v_key IS NOT NULL AND NOT o.is_online AND upper(btrim(o.room_number)) = v_key,
             format('Room %s is already used by %s (period %s, %s-%s) at that time', v_room, o.class_code,
                    o.period_number, to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI')))
        ) k(kind, hit, msg)
        WHERE k.hit;

        -- dated sessions on upcoming dates this weekly period would run on
        RETURN QUERY
        WITH o AS (
            SELECT e.session_date, e.class_code, e.period_number, e.start_time, e.end_time, e.teacher_code, e.is_online,
                   COALESCE(NULLIF(btrim(e.room_number), ''), c.room_number)::VARCHAR AS room_number, cs.subject_name
            FROM public.timetable_dated_entries e
            JOIN public.classes c ON c.org_code = e.org_code AND c.class_code = e.class_code
            LEFT JOIN public.class_subjects cs ON cs.org_code = e.org_code AND cs.class_code = e.class_code
                 AND cs.subject_code = e.subject_code
            WHERE e.org_code = p_org_code AND e.entry_kind = 'SESSION'
              AND e.session_date >= v_from AND (p_effective_to IS NULL OR e.session_date <= p_effective_to)
              AND EXTRACT(ISODOW FROM e.session_date) = v_dow
              AND NOT (e.class_code = p_class_code AND e.period_number = p_period)
              AND e.start_time < p_end AND p_start < e.end_time
              AND NOT EXISTS (SELECT 1 FROM public.timetable_dated_entries x
                              WHERE x.org_code = p_org_code AND x.class_code = p_class_code
                                AND x.session_date = e.session_date AND x.period_number = p_period)
              AND NOT EXISTS (SELECT 1 FROM public.holidays h
                              WHERE h.org_code = p_org_code AND h.status = 'PUBLISHED' AND h.is_full_day
                                AND e.session_date BETWEEN h.start_date AND h.end_date
                                AND (h.scope = 'SCHOOL_WIDE' OR p_class_code = ANY(h.class_codes)))
        )
        SELECT k.kind::VARCHAR, 'error'::VARCHAR, k.msg, o.session_date, v_dow, o.class_code, o.period_number,
               o.start_time, o.end_time, o.teacher_code, o.room_number, o.subject_name, 'DATED'::VARCHAR
        FROM o CROSS JOIN LATERAL (VALUES
            ('TEACHER_CLASH', p_teacher_code IS NOT NULL AND o.teacher_code = p_teacher_code,
             format('%s already teaches %s (period %s, %s-%s) on %s', p_teacher_code, o.class_code, o.period_number,
                    to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), to_char(o.session_date, 'Dy DD Mon YYYY'))),
            ('CLASS_CLASH', o.class_code = p_class_code,
             format('%s already has period %s (%s-%s) at an overlapping time on %s', p_class_code, o.period_number,
                    to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), to_char(o.session_date, 'Dy DD Mon YYYY'))),
            ('ROOM_CLASH', v_key IS NOT NULL AND NOT o.is_online AND upper(btrim(o.room_number)) = v_key,
             format('Room %s is already used by %s (period %s, %s-%s) on %s', v_room, o.class_code, o.period_number,
                    to_char(o.start_time, 'HH24:MI'), to_char(o.end_time, 'HH24:MI'), to_char(o.session_date, 'Dy DD Mon YYYY')))
        ) k(kind, hit, msg)
        WHERE k.hit;
    END IF;

    RETURN QUERY
    SELECT 'BREAK_OVERLAP'::VARCHAR, 'warning'::VARCHAR,
           format('Overlaps %s (%s-%s)', COALESCE(b.label, 'a break'), to_char(b.start_time, 'HH24:MI'),
                  to_char(b.end_time, 'HH24:MI'))::TEXT,
           p_date, v_dow, p_class_code, p_period, b.start_time, b.end_time, NULL::VARCHAR, NULL::VARCHAR,
           NULL::VARCHAR, NULL::VARCHAR
    FROM public.usp_bell_for_day(p_org_code, v_dow) b
    WHERE b.item_kind = 'BREAK' AND b.start_time < p_end AND p_start < b.end_time;
END;
$$;

-- ---------------------------------------------------------------- weekly upsert: same key, shared conflict rules
CREATE OR REPLACE FUNCTION public.usp_upsert_timetable_slot(
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

    SELECT c.kind, c.message INTO v_clash
    FROM public.usp_timetable_conflicts(p_org_code, p_class_code, p_period, p_start, p_end, v_teacher, p_room,
                                        p_is_online, NULL, p_day, p_effective_from, p_effective_to) c
    WHERE c.severity = 'error'
    ORDER BY array_position(ARRAY['NON_WORKING_DAY', 'TEACHER_CLASH', 'CLASS_CLASH', 'ROOM_CLASH'], c.kind::TEXT)
    LIMIT 1;
    IF FOUND THEN
        RAISE EXCEPTION '%: %', v_clash.kind, v_clash.message;
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

-- ---------------------------------------------------------------- dated upsert / cancel
-- Create or replace the dated entry at (class, date, period). A SESSION is conflict-checked like a weekly period
-- (raises '<KIND>: message') unless p_skip_check — used by bulk copy, which validates the whole batch itself.
CREATE OR REPLACE FUNCTION public.usp_save_dated_entry(
    p_org_code VARCHAR, p_class_code VARCHAR, p_date DATE, p_period SMALLINT, p_kind VARCHAR,
    p_subject_code VARCHAR, p_teacher_code VARCHAR, p_start TIME, p_end TIME, p_room VARCHAR,
    p_is_online BOOLEAN, p_online_url TEXT, p_note VARCHAR, p_created_by VARCHAR,
    p_copied_from DATE DEFAULT NULL, p_skip_check BOOLEAN DEFAULT FALSE
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID; v_teacher VARCHAR; v_clash RECORD;
BEGIN
    PERFORM pg_advisory_xact_lock(hashtext('timetable:' || p_org_code));
    IF p_kind = 'SESSION' THEN
        v_teacher := COALESCE(p_teacher_code, (SELECT teacher_code FROM public.class_subjects
            WHERE org_code = p_org_code AND class_code = p_class_code AND subject_code = p_subject_code));
        IF NOT p_skip_check THEN
            SELECT c.kind, c.message INTO v_clash
            FROM public.usp_timetable_conflicts(p_org_code, p_class_code, p_period, p_start, p_end, v_teacher, p_room,
                                                p_is_online, p_date, NULL) c
            WHERE c.severity = 'error'
            ORDER BY array_position(ARRAY['NON_WORKING_DAY', 'TEACHER_CLASH', 'CLASS_CLASH', 'ROOM_CLASH'], c.kind::TEXT)
            LIMIT 1;
            IF FOUND THEN
                RAISE EXCEPTION '%: %', v_clash.kind, v_clash.message;
            END IF;
        END IF;
    END IF;

    INSERT INTO public.timetable_dated_entries(org_code, class_code, session_date, period_number, entry_kind,
        subject_code, teacher_code, start_time, end_time, room_number, is_online, online_url, note, copied_from, created_by)
    VALUES (p_org_code, p_class_code, p_date, p_period, p_kind,
        CASE WHEN p_kind = 'SESSION' THEN p_subject_code END, CASE WHEN p_kind = 'SESSION' THEN v_teacher END,
        CASE WHEN p_kind = 'SESSION' THEN p_start END, CASE WHEN p_kind = 'SESSION' THEN p_end END,
        CASE WHEN p_kind = 'SESSION' THEN NULLIF(btrim(p_room), '') END,
        p_kind = 'SESSION' AND COALESCE(p_is_online, FALSE), CASE WHEN p_kind = 'SESSION' AND p_is_online THEN p_online_url END,
        p_note, p_copied_from, p_created_by)
    ON CONFLICT (org_code, class_code, session_date, period_number) DO UPDATE SET
        entry_kind = EXCLUDED.entry_kind, subject_code = EXCLUDED.subject_code, teacher_code = EXCLUDED.teacher_code,
        start_time = EXCLUDED.start_time, end_time = EXCLUDED.end_time, room_number = EXCLUDED.room_number,
        is_online = EXCLUDED.is_online, online_url = EXCLUDED.online_url, note = EXCLUDED.note,
        copied_from = EXCLUDED.copied_from, created_by = EXCLUDED.created_by, updated_at = NOW()
    RETURNING entry_id INTO v_id;
    RETURN v_id;
END;
$$;

-- ---------------------------------------------------------------- attendance: dated substitutes may mark too
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
                            AND t.subject_code = cs.subject_code AND t.teacher_code = p_teacher_code)
               OR EXISTS (SELECT 1 FROM public.timetable_dated_entries e
                          WHERE e.org_code = cs.org_code AND e.class_code = cs.class_code AND e.entry_kind = 'SESSION'
                            AND e.subject_code = cs.subject_code AND e.teacher_code = p_teacher_code))
    );
$$;
