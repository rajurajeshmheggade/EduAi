-- Online Tests: the same light, count-only camera/mic check built for Virtual Labs (migration 023), applied to
-- the online-test-taking flow. Only a running count is kept on the attempt (evaluation_candidate_scripts) row —
-- no video, audio, image or flag-by-flag detail — so the teacher can see something was flagged without this
-- becoming a surveillance record.

ALTER TABLE public.evaluation_candidate_scripts
    ADD COLUMN IF NOT EXISTS proctor_flag_count INT NOT NULL DEFAULT 0 CHECK (proctor_flag_count >= 0);

-- Surface a per-test total on the teacher's test list (mirrors virtual_lab_assignments' "proctor_flags").
DROP FUNCTION IF EXISTS public.usp_eval_list_tests(VARCHAR, VARCHAR, VARCHAR);
CREATE FUNCTION public.usp_eval_list_tests(p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR)
RETURNS TABLE (eval_test_id UUID, class_code VARCHAR, class_name VARCHAR, subject_code VARCHAR, subject_name VARCHAR,
               evaluation_scope VARCHAR, chapter_number INT, chapter_title VARCHAR, test_title VARCHAR, exam_date DATE,
               pass_percentage NUMERIC, total_max_marks NUMERIC, total_questions INT, status VARCHAR,
               created_by VARCHAR, created_at TIMESTAMPTZ, scripts BIGINT, evaluated BIGINT, average_percentage NUMERIC,
               assessment_type VARCHAR, instructions TEXT, duration_minutes INT, available_from TIMESTAMPTZ,
               due_at TIMESTAMPTZ, allow_late BOOLEAN, results_release VARCHAR, is_assigned BOOLEAN,
               assigned_at TIMESTAMPTZ, class_students BIGINT, submitted BIGINT, proctor_flags BIGINT)
LANGUAGE sql
AS $$
    SELECT t.eval_test_id, t.class_code, c.class_name, t.subject_code, cs.subject_name, t.evaluation_scope,
           t.chapter_number, t.chapter_title, t.test_title, t.exam_date, t.pass_percentage, t.total_max_marks,
           t.total_questions, t.status, t.created_by, t.created_at,
           (SELECT COUNT(*) FROM public.evaluation_candidate_scripts s WHERE s.eval_test_id = t.eval_test_id),
           (SELECT COUNT(*) FROM public.evaluation_candidate_scripts s WHERE s.eval_test_id = t.eval_test_id
              AND s.processing_status IN ('EVALUATED', 'REVIEWED')),
           (SELECT ROUND(AVG(s.percentage), 2) FROM public.evaluation_candidate_scripts s
              WHERE s.eval_test_id = t.eval_test_id AND s.processing_status IN ('EVALUATED', 'REVIEWED')),
           t.assessment_type, t.instructions, t.duration_minutes, t.available_from, t.due_at, t.allow_late,
           t.results_release, t.is_assigned, t.assigned_at,
           (SELECT COUNT(*) FROM public.app_users u WHERE u.org_code = t.org_code AND u.class_code = t.class_code
              AND u.user_role = 'student' AND u.is_active),
           (SELECT COUNT(*) FROM public.evaluation_candidate_scripts s WHERE s.eval_test_id = t.eval_test_id
              AND s.student_user_code IS NOT NULL AND s.processing_status <> 'IN_PROGRESS'),
           (SELECT COALESCE(SUM(s.proctor_flag_count), 0) FROM public.evaluation_candidate_scripts s
              WHERE s.eval_test_id = t.eval_test_id)
    FROM public.evaluation_tests t
    JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code
    JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code
         AND cs.subject_code = t.subject_code
    WHERE t.org_code = p_org_code
      AND (p_class_code IS NULL OR t.class_code = p_class_code)
      AND (p_subject_code IS NULL OR t.subject_code = p_subject_code)
    ORDER BY t.created_at DESC;
$$;

-- Per-student flag count in the "All students" register (mirrors AssignmentDetail.tsx's roster Flags column).
DROP FUNCTION IF EXISTS public.usp_eval_score_register(VARCHAR, UUID);
CREATE FUNCTION public.usp_eval_score_register(p_org_code VARCHAR, p_eval_test_id UUID)
RETURNS TABLE (rank_no BIGINT, script_id UUID, student_user_code VARCHAR, student_name VARCHAR,
               roll_number VARCHAR, uploaded_pdf_filename VARCHAR, attempted_questions INT,
               unanswered_questions INT, obtained_marks NUMERIC, max_marks NUMERIC, percentage NUMERIC,
               processing_status VARCHAR, evaluated_at TIMESTAMPTZ, submission_mode VARCHAR,
               submitted_at TIMESTAMPTZ, is_late BOOLEAN, proctor_flag_count INT)
LANGUAGE sql
AS $$
    WITH t AS (
        SELECT * FROM public.evaluation_tests WHERE org_code = p_org_code AND eval_test_id = p_eval_test_id
    ), rows AS (
        SELECT s.script_id, u.user_code AS student_user_code, u.full_name AS student_name, u.roll_number,
               s.uploaded_pdf_filename,
               COALESCE(s.attempted_questions_count, 0) AS attempted,
               COALESCE(s.unanswered_questions_count, t.total_questions) AS unanswered,
               COALESCE(s.total_obtained_marks, 0) AS obtained, t.total_max_marks AS max_marks,
               COALESCE(s.percentage, 0) AS pct,
               COALESCE(s.processing_status, 'NOT_SUBMITTED')::VARCHAR AS st, s.evaluated_at,
               s.submission_mode, s.submitted_at, COALESCE(s.is_late, FALSE) AS late,
               COALESCE(s.proctor_flag_count, 0) AS flags
        FROM t
        JOIN public.app_users u ON u.org_code = t.org_code AND u.class_code = t.class_code
             AND u.user_role = 'student' AND u.is_active
        LEFT JOIN public.evaluation_candidate_scripts s ON s.eval_test_id = t.eval_test_id
             AND s.student_user_code = u.user_code
        UNION ALL
        SELECT s.script_id, s.student_user_code, u.full_name, u.roll_number, s.uploaded_pdf_filename,
               s.attempted_questions_count, s.unanswered_questions_count, s.total_obtained_marks, t.total_max_marks,
               s.percentage, s.processing_status, s.evaluated_at, s.submission_mode, s.submitted_at, s.is_late,
               COALESCE(s.proctor_flag_count, 0)
        FROM t
        JOIN public.evaluation_candidate_scripts s ON s.eval_test_id = t.eval_test_id
        LEFT JOIN public.app_users u ON u.org_code = s.org_code AND u.user_code = s.student_user_code
        WHERE s.student_user_code IS NULL                                   -- unmatched folder uploads
           OR u.user_code IS NULL OR NOT u.is_active                        -- students since moved / deactivated
           OR u.class_code IS DISTINCT FROM t.class_code
    )
    SELECT CASE WHEN st IN ('EVALUATED', 'REVIEWED')
                THEN RANK() OVER (PARTITION BY st IN ('EVALUATED', 'REVIEWED') ORDER BY obtained DESC) END,
           script_id, student_user_code, student_name, roll_number, uploaded_pdf_filename, attempted, unanswered,
           obtained, max_marks, pct, st, evaluated_at, submission_mode, submitted_at, late, flags
    FROM rows
    ORDER BY (st IN ('EVALUATED', 'REVIEWED')) DESC, obtained DESC,
             CASE WHEN roll_number ~ '^[0-9]+$' THEN lpad(roll_number, 12, '0') ELSE COALESCE(roll_number, '~') END,
             student_name;
$$;
