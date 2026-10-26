-- 002: Core schema (FRD section 6.2) + platform additions (organizations, pipeline_jobs)

-- Organizations (tenant config; FR-AUTH-04 standalone_mode)
CREATE TABLE IF NOT EXISTS public.organizations (
    org_code VARCHAR(64) PRIMARY KEY,
    customer_code VARCHAR(64) NOT NULL DEFAULT 'ICME',
    org_name VARCHAR(200) NOT NULL,
    institution_level VARCHAR(32) NOT NULL DEFAULT 'school'
        CHECK (institution_level IN ('school', 'college', 'coaching')),
    standalone_mode BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 1. Unified Users & Role Mapping
CREATE TABLE IF NOT EXISTS public.app_users (
    user_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    user_code VARCHAR(64) UNIQUE NOT NULL,
    org_code VARCHAR(64) NOT NULL,
    customer_code VARCHAR(64) NOT NULL DEFAULT 'ICME',
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) UNIQUE NOT NULL,
    password_hash TEXT NOT NULL,
    user_role VARCHAR(32) NOT NULL CHECK (user_role IN ('superadmin', 'orgadmin', 'teacher', 'student')),
    year_code VARCHAR(32),
    cycle_code VARCHAR(32),
    class_code VARCHAR(64),
    allowed_subjects TEXT[] NOT NULL DEFAULT '{}',
    is_active BOOLEAN DEFAULT TRUE,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 2. Subject Textbooks
CREATE TABLE IF NOT EXISTS public.subject_textbooks (
    textbook_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    year_code VARCHAR(32),
    cycle_code VARCHAR(32),
    class_code VARCHAR(64),
    subject_code VARCHAR(64) NOT NULL,
    title VARCHAR(300) NOT NULL,
    blob_pdf_url TEXT NOT NULL,
    total_pages INT NOT NULL DEFAULT 0,
    vector_status VARCHAR(32) NOT NULL DEFAULT 'pending',
    is_published_to_students BOOLEAN DEFAULT FALSE,
    uploaded_by VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 3. Textbook vector chunks (pgvector, k=3 RAG)
CREATE TABLE IF NOT EXISTS public.textbook_chunks (
    chunk_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    textbook_id UUID NOT NULL REFERENCES public.subject_textbooks(textbook_id) ON DELETE CASCADE,
    subject_code VARCHAR(64) NOT NULL,
    chapter_number INT,
    chapter_title VARCHAR(300),
    page_number INT NOT NULL,
    chunk_index INT NOT NULL,
    content_text TEXT NOT NULL,
    token_count INT NOT NULL,
    embedding vector(1536) NOT NULL,
    metadata JSONB DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_embedding_hnsw
ON public.textbook_chunks
USING hnsw (embedding vector_cosine_ops)
WITH (m = 16, ef_construction = 64);

CREATE INDEX IF NOT EXISTS idx_textbook_chunks_subject
ON public.textbook_chunks(subject_code, textbook_id);

-- 4. "How to Teach" pedagogical guides
CREATE TABLE IF NOT EXISTS public.teacher_pedagogical_guides (
    guide_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    textbook_id UUID NOT NULL REFERENCES public.subject_textbooks(textbook_id) ON DELETE CASCADE,
    subject_code VARCHAR(64) NOT NULL,
    chapter_number INT NOT NULL,
    chapter_title VARCHAR(300) NOT NULL,
    institution_level VARCHAR(32) NOT NULL CHECK (institution_level IN ('school', 'college', 'coaching')),
    duration_minutes INT NOT NULL DEFAULT 45,
    lesson_plan_markdown TEXT NOT NULL,
    analogies_and_hooks JSONB NOT NULL,
    board_work_blueprint JSONB NOT NULL,
    common_misconceptions JSONB NOT NULL,
    formative_questions JSONB NOT NULL,
    generated_by_model VARCHAR(64) DEFAULT 'azure-gpt-4o',
    created_at TIMESTAMPTZ DEFAULT NOW()
);

-- 5. RAG chat messages (logs the exact k=3 chunks)
CREATE TABLE IF NOT EXISTS public.rag_chat_messages (
    message_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL,
    student_user_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    textbook_id UUID REFERENCES public.subject_textbooks(textbook_id),
    student_query TEXT NOT NULL,
    retrieved_k3_chunk_ids UUID[] NOT NULL,
    retrieved_pages INT[] NOT NULL,
    ai_response_markdown TEXT NOT NULL,
    curiosity_depth_score NUMERIC(4,2),
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_rag_chat_session ON public.rag_chat_messages(session_id, created_at);

-- 6. Attendance
CREATE TABLE IF NOT EXISTS public.attendance_records (
    attendance_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    year_code VARCHAR(32) NOT NULL,
    cycle_code VARCHAR(32) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    student_user_code VARCHAR(64) NOT NULL,
    attendance_date DATE NOT NULL,
    session_slot VARCHAR(32) DEFAULT 'Session-1',
    status VARCHAR(16) NOT NULL CHECK (status IN ('present', 'absent', 'late', 'excused')),
    marked_by_teacher VARCHAR(64) NOT NULL,
    remarks TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (org_code, subject_code, student_user_code, attendance_date, session_slot)
);

-- 7. Assignments & submissions
CREATE TABLE IF NOT EXISTS public.assignments (
    assignment_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    year_code VARCHAR(32),
    cycle_code VARCHAR(32),
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    workspace_id VARCHAR(128) NOT NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    question_pdf_url TEXT,
    marking_scheme_md TEXT NOT NULL,
    max_marks NUMERIC(6,2) NOT NULL,
    due_date TIMESTAMPTZ NOT NULL,
    created_by_teacher VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.assignment_submissions (
    submission_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    assignment_id UUID NOT NULL REFERENCES public.assignments(assignment_id) ON DELETE CASCADE,
    student_user_code VARCHAR(64) NOT NULL,
    submitted_pdf_url TEXT NOT NULL,
    icme_batch_id VARCHAR(128),
    pipeline_status INT NOT NULL DEFAULT 0,
    awarded_marks NUMERIC(6,2),
    presentation_score NUMERIC(5,2),
    question_wise_breakdown JSONB,
    ai_feedback_summary TEXT,
    submitted_at TIMESTAMPTZ DEFAULT NOW(),
    evaluated_at TIMESTAMPTZ
);

-- 8. Online tests
CREATE TABLE IF NOT EXISTS public.online_tests (
    test_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    title VARCHAR(300) NOT NULL,
    duration_minutes INT NOT NULL DEFAULT 60,
    total_marks NUMERIC(6,2) NOT NULL,
    marking_scheme_json JSONB NOT NULL,
    scheduled_start TIMESTAMPTZ,
    scheduled_end TIMESTAMPTZ,
    created_by_teacher VARCHAR(64) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);

CREATE TABLE IF NOT EXISTS public.test_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    test_id UUID NOT NULL REFERENCES public.online_tests(test_id) ON DELETE CASCADE,
    student_user_code VARCHAR(64) NOT NULL,
    started_at TIMESTAMPTZ DEFAULT NOW(),
    submitted_at TIMESTAMPTZ,
    total_score NUMERIC(6,2),
    question_feedback_json JSONB,
    recommended_revision_pages JSONB,
    status VARCHAR(32) DEFAULT 'in_progress'
);

-- 9. Holistic reports
CREATE TABLE IF NOT EXISTS public.student_holistic_reports (
    report_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64),
    student_user_code VARCHAR(64) NOT NULL,
    evaluation_period VARCHAR(64) NOT NULL,
    creativity_score NUMERIC(5,2) NOT NULL,
    creativity_tier VARCHAR(32) NOT NULL,
    creativity_dimensions JSONB NOT NULL,
    mindset_profile VARCHAR(32) NOT NULL,
    mindset_indicators JSONB NOT NULL,
    wellbeing_status VARCHAR(32) NOT NULL,
    stress_signals JSONB NOT NULL,
    teacher_action_recommendations JSONB NOT NULL,
    generated_at TIMESTAMPTZ DEFAULT NOW()
);

-- 10. Persistent pipeline job state (replaces in-memory runtime_state.py queues)
CREATE TABLE IF NOT EXISTS public.pipeline_jobs (
    job_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    job_type VARCHAR(48) NOT NULL,              -- textbook_vectorize, evaluation, ...
    ref_id VARCHAR(128) NOT NULL,               -- e.g. textbook_id
    status VARCHAR(32) NOT NULL DEFAULT 'queued', -- queued, running, completed, failed
    progress NUMERIC(5,2) NOT NULL DEFAULT 0,
    detail JSONB NOT NULL DEFAULT '{}'::jsonb,
    error TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_pipeline_jobs_ref ON public.pipeline_jobs(job_type, ref_id);
