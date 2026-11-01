-- 016 — AI avatar tutor reads the textbook aloud (student AI Classroom).
-- The avatar and its voice follow the subject teacher: male avatar + male voice when the teacher's gender is 'male',
-- otherwise the female avatar + female voice. Gender is set by the institution admin (Admin console → Teachers);
-- it is never inferred from a name.

ALTER TABLE public.app_users ADD COLUMN IF NOT EXISTS gender VARCHAR(16);
ALTER TABLE public.app_users DROP CONSTRAINT IF EXISTS app_users_gender_check;
ALTER TABLE public.app_users ADD CONSTRAINT app_users_gender_check
    CHECK (gender IS NULL OR gender IN ('female', 'male', 'other', 'undisclosed'));

-- Members list now carries gender (admin teacher table shows / edits it).
DROP FUNCTION IF EXISTS public.usp_list_members(VARCHAR, VARCHAR, VARCHAR);
CREATE FUNCTION public.usp_list_members(p_org_code VARCHAR, p_role VARCHAR, p_class_code VARCHAR DEFAULT NULL)
RETURNS TABLE (user_id UUID, user_code VARCHAR, full_name VARCHAR, email VARCHAR, user_role VARCHAR,
               class_code VARCHAR, roll_number VARCHAR, phone VARCHAR, guardian_name VARCHAR,
               guardian_phone VARCHAR, allowed_subjects TEXT[], is_active BOOLEAN, created_at TIMESTAMPTZ,
               qualification VARCHAR, gender VARCHAR)
LANGUAGE sql
AS $$
    SELECT user_id, user_code, full_name, email, user_role, class_code, roll_number, phone, guardian_name,
           guardian_phone, allowed_subjects, is_active, created_at, qualification, gender
    FROM public.app_users
    WHERE org_code = p_org_code AND user_role = p_role
      AND (p_class_code IS NULL OR class_code = p_class_code)
    ORDER BY
        CASE WHEN roll_number ~ '^[0-9]+$' THEN lpad(roll_number, 12, '0') ELSE COALESCE(roll_number, '~') END,
        full_name;
$$;
