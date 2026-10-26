-- 007: AI Evaluation Engine (FRD "AI Evaluation" v3.1, FR-EV-01..13)
-- Subject- or chapter-level tests, SL.No-wise master questions + model answers (pgvector), folder-uploaded
-- candidate scripts matched to the class roster, SL.No-wise OCR + AI grading results with teacher override.

CREATE TABLE IF NOT EXISTS public.evaluation_tests (
    eval_test_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    evaluation_scope VARCHAR(32) NOT NULL CHECK (evaluation_scope IN ('SUBJECT_LEVEL', 'CHAPTER_LEVEL')),
    textbook_id UUID REFERENCES public.subject_textbooks(textbook_id) ON DELETE SET NULL,
    chapter_number INT,
    chapter_title VARCHAR(300),
    test_title VARCHAR(300) NOT NULL,
    exam_date DATE,
    pass_percentage NUMERIC(5,2) NOT NULL DEFAULT 40 CHECK (pass_percentage BETWEEN 0 AND 100),
    question_paper_key TEXT,
    question_paper_name VARCHAR(255),
    model_answer_key TEXT,
    model_answer_name VARCHAR(255),
    total_max_marks NUMERIC(7,2) NOT NULL DEFAULT 0,
    total_questions INT NOT NULL DEFAULT 0,
    -- DRAFT: no masters yet · READY: masters saved · PROCESSING: AI queue running · EVALUATED · PUBLISHED (students see)
    status VARCHAR(32) NOT NULL DEFAULT 'DRAFT'
        CHECK (status IN ('DRAFT', 'READY', 'PROCESSING', 'EVALUATED', 'PUBLISHED')),
    last_job_id UUID,
    created_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CHECK (evaluation_scope = 'SUBJECT_LEVEL' OR chapter_title IS NOT NULL),
    FOREIGN KEY (org_code, class_code, subject_code)
        REFERENCES public.class_subjects(org_code, class_code, subject_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_eval_tests_class ON public.evaluation_tests(org_code, class_code, subject_code, created_at DESC);

CREATE TABLE IF NOT EXISTS public.evaluation_master_questions (
    master_q_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    eval_test_id UUID NOT NULL REFERENCES public.evaluation_tests(eval_test_id) ON DELETE CASCADE,
    sl_no VARCHAR(32) NOT NULL,                     -- '1', '2', '4a' …
    display_order INT NOT NULL,
    question_text TEXT NOT NULL,
    max_marks NUMERIC(6,2) NOT NULL CHECK (max_marks > 0),
    model_answer_text TEXT NOT NULL,
    key_rubric_points JSONB NOT NULL DEFAULT '[]'::jsonb,   -- ["Formula 1/v + 1/u = 1/f (1M)", …]
    model_answer_embedding vector(1536),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (eval_test_id, sl_no)
);

CREATE TABLE IF NOT EXISTS public.evaluation_candidate_scripts (
    script_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    eval_test_id UUID NOT NULL REFERENCES public.evaluation_tests(eval_test_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    student_user_code VARCHAR(64),                  -- NULL until matched / assigned (FR-EV-06/07)
    uploaded_pdf_filename VARCHAR(255) NOT NULL,
    script_key TEXT NOT NULL,
    page_count INT NOT NULL DEFAULT 0,
    match_method VARCHAR(16) CHECK (match_method IN ('name', 'code', 'roll', 'fuzzy', 'manual')),
    match_score NUMERIC(4,3),
    total_obtained_marks NUMERIC(7,2) NOT NULL DEFAULT 0,
    total_max_marks NUMERIC(7,2) NOT NULL DEFAULT 0,
    percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
    attempted_questions_count INT NOT NULL DEFAULT 0,
    unanswered_questions_count INT NOT NULL DEFAULT 0,
    overall_ai_feedback TEXT,
    ocr_method VARCHAR(16),                         -- 'text_layer' | 'vision'
    processing_status VARCHAR(32) NOT NULL DEFAULT 'UPLOADED'
        CHECK (processing_status IN ('UPLOADED', 'QUEUED', 'OCR_IN_PROGRESS', 'EVALUATED', 'REVIEWED', 'FAILED')),
    error TEXT,
    uploaded_at TIMESTAMPTZ DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ
);
-- One script per student per test (unmatched uploads may coexist)
CREATE UNIQUE INDEX IF NOT EXISTS uq_eval_script_student
    ON public.evaluation_candidate_scripts(eval_test_id, student_user_code) WHERE student_user_code IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_eval_scripts_test ON public.evaluation_candidate_scripts(eval_test_id, total_obtained_marks DESC);

CREATE TABLE IF NOT EXISTS public.evaluation_slno_results (
    slno_result_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    script_id UUID NOT NULL REFERENCES public.evaluation_candidate_scripts(script_id) ON DELETE CASCADE,
    eval_test_id UUID NOT NULL REFERENCES public.evaluation_tests(eval_test_id) ON DELETE CASCADE,
    master_q_id UUID NOT NULL REFERENCES public.evaluation_master_questions(master_q_id) ON DELETE CASCADE,
    sl_no VARCHAR(32) NOT NULL,
    is_attempted BOOLEAN NOT NULL DEFAULT TRUE,
    student_ocr_text TEXT,
    page_numbers INT[] NOT NULL DEFAULT '{}',
    semantic_similarity NUMERIC(5,4) NOT NULL DEFAULT 0,
    ai_awarded_marks NUMERIC(6,2) NOT NULL DEFAULT 0,   -- what the AI gave (kept for audit)
    awarded_marks NUMERIC(6,2) NOT NULL DEFAULT 0,      -- effective marks (AI or teacher override)
    max_marks NUMERIC(6,2) NOT NULL,
    why_marks_given TEXT NOT NULL,
    missing_points JSONB NOT NULL DEFAULT '[]'::jsonb,
    feedback TEXT NOT NULL,
    teacher_override BOOLEAN NOT NULL DEFAULT FALSE,
    teacher_comment TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (script_id, sl_no),
    CHECK (awarded_marks >= 0 AND awarded_marks <= max_marks)
);
CREATE INDEX IF NOT EXISTS idx_eval_slno_test ON public.evaluation_slno_results(eval_test_id, sl_no, is_attempted);

-- Recompute a script's totals from its SL.No results (after AI grading or a teacher override).
CREATE OR REPLACE FUNCTION public.usp_eval_recompute_script(p_script_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE public.evaluation_candidate_scripts s SET
        total_obtained_marks = COALESCE(r.obtained, 0),
        total_max_marks = t.total_max_marks,
        percentage = CASE WHEN t.total_max_marks > 0
                          THEN ROUND(100 * COALESCE(r.obtained, 0) / t.total_max_marks, 2) ELSE 0 END,
        attempted_questions_count = COALESCE(r.attempted, 0),
        unanswered_questions_count = t.total_questions - COALESCE(r.attempted, 0)
    FROM public.evaluation_tests t
    LEFT JOIN LATERAL (
        SELECT SUM(awarded_marks) AS obtained, COUNT(*) FILTER (WHERE is_attempted) AS attempted
        FROM public.evaluation_slno_results WHERE script_id = p_script_id
    ) r ON TRUE
    WHERE s.script_id = p_script_id AND t.eval_test_id = s.eval_test_id;
$$;

-- FR-EV-13: all-student score register for a test, ranked (dense ties share a rank).
CREATE OR REPLACE FUNCTION public.usp_eval_score_register(p_org_code VARCHAR, p_eval_test_id UUID)
RETURNS TABLE (rank_no BIGINT, script_id UUID, student_user_code VARCHAR, student_name VARCHAR,
               roll_number VARCHAR, uploaded_pdf_filename VARCHAR, attempted_questions INT,
               unanswered_questions INT, obtained_marks NUMERIC, max_marks NUMERIC, percentage NUMERIC,
               processing_status VARCHAR, evaluated_at TIMESTAMPTZ)
LANGUAGE sql
AS $$
    SELECT CASE WHEN s.processing_status IN ('EVALUATED', 'REVIEWED')
                THEN RANK() OVER (PARTITION BY s.processing_status IN ('EVALUATED', 'REVIEWED')
                                  ORDER BY s.total_obtained_marks DESC) END,
           s.script_id, s.student_user_code, u.full_name, u.roll_number, s.uploaded_pdf_filename,
           s.attempted_questions_count, s.unanswered_questions_count, s.total_obtained_marks, s.total_max_marks,
           s.percentage, s.processing_status, s.evaluated_at
    FROM public.evaluation_candidate_scripts s
    JOIN public.evaluation_tests t ON t.eval_test_id = s.eval_test_id
    LEFT JOIN public.app_users u ON u.org_code = s.org_code AND u.user_code = s.student_user_code
    WHERE t.org_code = p_org_code AND s.eval_test_id = p_eval_test_id
    ORDER BY (s.processing_status IN ('EVALUATED', 'REVIEWED')) DESC, s.total_obtained_marks DESC, u.full_name;
$$;

-- Tests list with progress counters (teacher/admin pickers).
CREATE OR REPLACE FUNCTION public.usp_eval_list_tests(p_org_code VARCHAR, p_class_code VARCHAR, p_subject_code VARCHAR)
RETURNS TABLE (eval_test_id UUID, class_code VARCHAR, class_name VARCHAR, subject_code VARCHAR, subject_name VARCHAR,
               evaluation_scope VARCHAR, chapter_number INT, chapter_title VARCHAR, test_title VARCHAR, exam_date DATE,
               pass_percentage NUMERIC, total_max_marks NUMERIC, total_questions INT, status VARCHAR,
               created_by VARCHAR, created_at TIMESTAMPTZ, scripts BIGINT, evaluated BIGINT, average_percentage NUMERIC)
LANGUAGE sql
AS $$
    SELECT t.eval_test_id, t.class_code, c.class_name, t.subject_code, cs.subject_name, t.evaluation_scope,
           t.chapter_number, t.chapter_title, t.test_title, t.exam_date, t.pass_percentage, t.total_max_marks,
           t.total_questions, t.status, t.created_by, t.created_at,
           (SELECT COUNT(*) FROM public.evaluation_candidate_scripts s WHERE s.eval_test_id = t.eval_test_id),
           (SELECT COUNT(*) FROM public.evaluation_candidate_scripts s WHERE s.eval_test_id = t.eval_test_id
              AND s.processing_status IN ('EVALUATED', 'REVIEWED')),
           (SELECT ROUND(AVG(s.percentage), 2) FROM public.evaluation_candidate_scripts s
              WHERE s.eval_test_id = t.eval_test_id AND s.processing_status IN ('EVALUATED', 'REVIEWED'))
    FROM public.evaluation_tests t
    JOIN public.classes c ON c.org_code = t.org_code AND c.class_code = t.class_code
    JOIN public.class_subjects cs ON cs.org_code = t.org_code AND cs.class_code = t.class_code
         AND cs.subject_code = t.subject_code
    WHERE t.org_code = p_org_code
      AND (p_class_code IS NULL OR t.class_code = p_class_code)
      AND (p_subject_code IS NULL OR t.subject_code = p_subject_code)
    ORDER BY t.created_at DESC;
$$;
