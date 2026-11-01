-- 020: Board (e.g. CBSE, NCERT, State board) bound to a class by the admin, alongside the existing grade_number.
-- Teachers and students no longer pick a board when browsing the Digital Library's DIKSHA catalog — it follows
-- their class automatically, the same way grade_number already does (013_digital_library.sql).

ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS board VARCHAR(32);

DROP FUNCTION IF EXISTS public.usp_list_classes(VARCHAR);
CREATE FUNCTION public.usp_list_classes(p_org_code VARCHAR)
RETURNS TABLE (class_id UUID, class_code VARCHAR, class_name VARCHAR, year_code VARCHAR, cycle_code VARCHAR,
               class_teacher_code VARCHAR, class_teacher_name VARCHAR, is_active BOOLEAN, student_count BIGINT,
               subjects JSONB, room_number VARCHAR, grade_number INT, board VARCHAR)
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
        c.board
    FROM public.classes c
    LEFT JOIN public.app_users t ON t.org_code = c.org_code AND t.user_code = c.class_teacher_code
    WHERE c.org_code = p_org_code
    ORDER BY c.class_code;
$$;
