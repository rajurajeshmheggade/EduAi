-- Phase 3 of the Student/Teacher master prompt: in-app notifications, timetable change history +
-- notifications (#3), and holidays (#10).

-- ---------------------------------------------------------------- in-app notifications (cross-module)
-- A single shared inbox table reused by every feature that needs to notify a user (timetable changes now;
-- homework reminders later). dedup_key lets a producer make a notification idempotent per-recipient
-- per-event, so reprocessing the same event never creates a duplicate.
CREATE TABLE IF NOT EXISTS public.notifications (
    notification_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    user_code VARCHAR(64) NOT NULL,              -- recipient (app_users.user_code)
    notif_type VARCHAR(32) NOT NULL,              -- e.g. 'TIMETABLE_CHANGE', 'HOLIDAY', 'HOMEWORK_OVERDUE'
    title VARCHAR(300) NOT NULL,
    body TEXT,
    link TEXT,                                    -- relative app URL to the affected record
    dedup_key VARCHAR(160),
    is_read BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_notifications_recipient ON public.notifications(org_code, user_code, created_at DESC);
CREATE UNIQUE INDEX IF NOT EXISTS idx_notifications_dedup ON public.notifications(org_code, user_code, dedup_key)
    WHERE dedup_key IS NOT NULL;

CREATE OR REPLACE FUNCTION public.usp_notify(
    p_org_code VARCHAR, p_user_code VARCHAR, p_notif_type VARCHAR, p_title VARCHAR, p_body TEXT, p_link TEXT,
    p_dedup_key VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    IF p_dedup_key IS NOT NULL THEN
        INSERT INTO public.notifications(org_code, user_code, notif_type, title, body, link, dedup_key)
        VALUES (p_org_code, p_user_code, p_notif_type, p_title, p_body, p_link, p_dedup_key)
        ON CONFLICT (org_code, user_code, dedup_key) WHERE dedup_key IS NOT NULL DO NOTHING
        RETURNING notification_id INTO v_id;
    ELSE
        INSERT INTO public.notifications(org_code, user_code, notif_type, title, body, link, dedup_key)
        VALUES (p_org_code, p_user_code, p_notif_type, p_title, p_body, p_link, NULL)
        RETURNING notification_id INTO v_id;
    END IF;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_list_notifications(p_org_code VARCHAR, p_user_code VARCHAR, p_limit INT DEFAULT 50)
RETURNS TABLE (notification_id UUID, notif_type VARCHAR, title VARCHAR, body TEXT, link TEXT,
               is_read BOOLEAN, created_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT notification_id, notif_type, title, body, link, is_read, created_at
    FROM public.notifications
    WHERE org_code = p_org_code AND user_code = p_user_code
    ORDER BY created_at DESC
    LIMIT p_limit;
$$;

-- ---------------------------------------------------------------- timetable change history (#3)
CREATE TABLE IF NOT EXISTS public.timetable_slot_changes (
    change_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    slot_id UUID,                                 -- the slot this change applies to (NULL-safe: not FK'd,
                                                    -- so history survives the slot itself being deleted later)
    day_of_week SMALLINT NOT NULL,
    period_number SMALLINT NOT NULL,
    change_kind VARCHAR(16) NOT NULL CHECK (change_kind IN ('UPDATED', 'CANCELLED')),
    old_subject_name VARCHAR(120), old_teacher_name VARCHAR(200), old_start_time TIME, old_end_time TIME,
    new_subject_name VARCHAR(120), new_teacher_name VARCHAR(200), new_start_time TIME, new_end_time TIME,
    reason TEXT,
    changed_by VARCHAR(64) NOT NULL,
    changed_by_name VARCHAR(200),
    changed_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_timetable_changes_class ON public.timetable_slot_changes(org_code, class_code, changed_at DESC);

CREATE OR REPLACE FUNCTION public.usp_recent_timetable_changes(p_org_code VARCHAR, p_class_code VARCHAR, p_since_days INT DEFAULT 14)
RETURNS TABLE (change_id UUID, class_code VARCHAR, day_of_week SMALLINT, period_number SMALLINT, change_kind VARCHAR,
               old_subject_name VARCHAR, old_teacher_name VARCHAR, old_start_time TIME, old_end_time TIME,
               new_subject_name VARCHAR, new_teacher_name VARCHAR, new_start_time TIME, new_end_time TIME,
               reason TEXT, changed_by_name VARCHAR, changed_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT change_id, class_code, day_of_week, period_number, change_kind, old_subject_name, old_teacher_name,
           old_start_time, old_end_time, new_subject_name, new_teacher_name, new_start_time, new_end_time,
           reason, changed_by_name, changed_at
    FROM public.timetable_slot_changes
    WHERE org_code = p_org_code AND (p_class_code IS NULL OR class_code = p_class_code)
      AND changed_at >= NOW() - (p_since_days || ' days')::interval
    ORDER BY changed_at DESC;
$$;

-- ---------------------------------------------------------------- holidays (#10)
CREATE TABLE IF NOT EXISTS public.holidays (
    holiday_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    name VARCHAR(200) NOT NULL,
    start_date DATE NOT NULL,
    end_date DATE NOT NULL,
    holiday_type VARCHAR(16) NOT NULL DEFAULT 'SCHOOL' CHECK (holiday_type IN ('PUBLIC', 'SCHOOL')),
    description TEXT,
    scope VARCHAR(16) NOT NULL DEFAULT 'SCHOOL_WIDE' CHECK (scope IN ('SCHOOL_WIDE', 'CLASS')),
    class_codes TEXT[] NOT NULL DEFAULT '{}',      -- used when scope = 'CLASS'; empty for SCHOOL_WIDE
    is_full_day BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(16) NOT NULL DEFAULT 'PUBLISHED' CHECK (status IN ('DRAFT', 'PUBLISHED')),
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (end_date >= start_date)
);
CREATE INDEX IF NOT EXISTS idx_holidays_org_dates ON public.holidays(org_code, start_date, end_date);

-- Holidays visible to a class in [p_from, p_to]: published, and either school-wide or naming this class.
CREATE OR REPLACE FUNCTION public.usp_list_holidays(
    p_org_code VARCHAR, p_class_code VARCHAR, p_from DATE, p_to DATE, p_published_only BOOLEAN DEFAULT TRUE
)
RETURNS TABLE (holiday_id UUID, name VARCHAR, start_date DATE, end_date DATE, holiday_type VARCHAR,
               description TEXT, scope VARCHAR, class_codes TEXT[], is_full_day BOOLEAN, status VARCHAR)
LANGUAGE sql
AS $$
    SELECT holiday_id, name, start_date, end_date, holiday_type, description, scope, class_codes, is_full_day, status
    FROM public.holidays
    WHERE org_code = p_org_code
      AND start_date <= p_to AND end_date >= p_from
      AND (NOT p_published_only OR status = 'PUBLISHED')
      AND (p_class_code IS NULL OR scope = 'SCHOOL_WIDE' OR p_class_code = ANY(class_codes))
    ORDER BY start_date;
$$;
