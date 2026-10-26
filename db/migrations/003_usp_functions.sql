-- 003: usp_* functions (stored-procedure convention shared by Python and .NET)

-- k=3 similarity retrieval (FRD 6.3)
CREATE OR REPLACE FUNCTION public.usp_match_textbook_chunks_k3(
    p_subject_code VARCHAR(64),
    p_textbook_id UUID,
    p_query_embedding vector(1536),
    p_top_k INT DEFAULT 3
)
RETURNS TABLE (
    chunk_id UUID,
    textbook_id UUID,
    chapter_number INT,
    chapter_title VARCHAR(300),
    page_number INT,
    content_text TEXT,
    similarity NUMERIC(6,4)
)
LANGUAGE plpgsql
AS $$
BEGIN
    RETURN QUERY
    SELECT
        tc.chunk_id,
        tc.textbook_id,
        tc.chapter_number,
        tc.chapter_title,
        tc.page_number,
        tc.content_text,
        ROUND((1 - (tc.embedding <=> p_query_embedding))::numeric, 4) AS similarity
    FROM public.textbook_chunks tc
    JOIN public.subject_textbooks st ON st.textbook_id = tc.textbook_id
    WHERE tc.subject_code = p_subject_code
      AND (p_textbook_id IS NULL OR tc.textbook_id = p_textbook_id)
      AND st.is_published_to_students = TRUE
    ORDER BY tc.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$;

-- Teacher-side retrieval that ignores the publish flag (guide generation, previews)
CREATE OR REPLACE FUNCTION public.usp_get_chapter_chunks(
    p_textbook_id UUID,
    p_chapter_number INT
)
RETURNS TABLE (page_number INT, chunk_index INT, chapter_title VARCHAR(300), content_text TEXT)
LANGUAGE sql
AS $$
    SELECT page_number, chunk_index, chapter_title, content_text
    FROM public.textbook_chunks
    WHERE textbook_id = p_textbook_id AND chapter_number = p_chapter_number
    ORDER BY page_number, chunk_index;
$$;

CREATE OR REPLACE FUNCTION public.usp_create_user(
    p_user_code VARCHAR, p_org_code VARCHAR, p_customer_code VARCHAR, p_full_name VARCHAR,
    p_email VARCHAR, p_password_hash TEXT, p_user_role VARCHAR,
    p_year_code VARCHAR, p_cycle_code VARCHAR, p_class_code VARCHAR, p_allowed_subjects TEXT[]
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.app_users(user_code, org_code, customer_code, full_name, email, password_hash,
                                 user_role, year_code, cycle_code, class_code, allowed_subjects)
    VALUES (p_user_code, p_org_code, p_customer_code, p_full_name, lower(p_email), p_password_hash,
            p_user_role, p_year_code, p_cycle_code, p_class_code, COALESCE(p_allowed_subjects, '{}'))
    ON CONFLICT (user_code) DO UPDATE SET
        full_name = EXCLUDED.full_name, password_hash = EXCLUDED.password_hash,
        user_role = EXCLUDED.user_role, allowed_subjects = EXCLUDED.allowed_subjects
    RETURNING user_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_user_by_email(p_email VARCHAR, p_org_code VARCHAR DEFAULT NULL)
RETURNS SETOF public.app_users
LANGUAGE sql
AS $$
    SELECT * FROM public.app_users
    WHERE email = lower(p_email) AND is_active = TRUE
      AND (p_org_code IS NULL OR org_code = p_org_code);
$$;

CREATE OR REPLACE FUNCTION public.usp_get_user_by_id(p_user_id UUID)
RETURNS SETOF public.app_users
LANGUAGE sql
AS $$
    SELECT * FROM public.app_users WHERE user_id = p_user_id AND is_active = TRUE;
$$;

CREATE OR REPLACE FUNCTION public.usp_create_textbook(
    p_org_code VARCHAR, p_year_code VARCHAR, p_cycle_code VARCHAR, p_class_code VARCHAR,
    p_subject_code VARCHAR, p_title VARCHAR, p_blob_pdf_url TEXT, p_uploaded_by VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.subject_textbooks(org_code, year_code, cycle_code, class_code, subject_code,
                                         title, blob_pdf_url, uploaded_by)
    VALUES (p_org_code, p_year_code, p_cycle_code, p_class_code, p_subject_code,
            p_title, p_blob_pdf_url, p_uploaded_by)
    RETURNING textbook_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_update_textbook_status(
    p_textbook_id UUID, p_vector_status VARCHAR, p_total_pages INT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE public.subject_textbooks
    SET vector_status = p_vector_status,
        total_pages = COALESCE(p_total_pages, total_pages)
    WHERE textbook_id = p_textbook_id;
$$;

CREATE OR REPLACE FUNCTION public.usp_set_textbook_published(p_textbook_id UUID, p_org_code VARCHAR, p_published BOOLEAN)
RETURNS INT
LANGUAGE plpgsql
AS $$
DECLARE v_n INT;
BEGIN
    UPDATE public.subject_textbooks SET is_published_to_students = p_published
    WHERE textbook_id = p_textbook_id AND org_code = p_org_code;
    GET DIAGNOSTICS v_n = ROW_COUNT;
    RETURN v_n;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_list_textbooks(
    p_org_code VARCHAR, p_subject_code VARCHAR, p_published_only BOOLEAN DEFAULT FALSE
)
RETURNS SETOF public.subject_textbooks
LANGUAGE sql
AS $$
    SELECT * FROM public.subject_textbooks
    WHERE org_code = p_org_code AND subject_code = p_subject_code
      AND (NOT p_published_only OR is_published_to_students = TRUE)
    ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_textbook(p_textbook_id UUID)
RETURNS SETOF public.subject_textbooks
LANGUAGE sql
AS $$
    SELECT * FROM public.subject_textbooks WHERE textbook_id = p_textbook_id;
$$;

CREATE OR REPLACE FUNCTION public.usp_list_chapters(p_textbook_id UUID)
RETURNS TABLE (chapter_number INT, chapter_title VARCHAR(300), first_page INT, last_page INT, chunk_count BIGINT)
LANGUAGE sql
AS $$
    SELECT chapter_number, MIN(chapter_title)::VARCHAR(300), MIN(page_number), MAX(page_number), COUNT(*)
    FROM public.textbook_chunks
    WHERE textbook_id = p_textbook_id AND chapter_number IS NOT NULL
    GROUP BY chapter_number
    ORDER BY chapter_number;
$$;

CREATE OR REPLACE FUNCTION public.usp_delete_textbook_chunks(p_textbook_id UUID)
RETURNS VOID
LANGUAGE sql
AS $$
    DELETE FROM public.textbook_chunks WHERE textbook_id = p_textbook_id;
$$;

CREATE OR REPLACE FUNCTION public.usp_insert_textbook_chunk(
    p_textbook_id UUID, p_subject_code VARCHAR, p_chapter_number INT, p_chapter_title VARCHAR,
    p_page_number INT, p_chunk_index INT, p_content_text TEXT, p_token_count INT,
    p_embedding vector(1536), p_metadata JSONB DEFAULT '{}'::jsonb
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.textbook_chunks(textbook_id, subject_code, chapter_number, chapter_title,
                                       page_number, chunk_index, content_text, token_count, embedding, metadata)
    VALUES (p_textbook_id, p_subject_code, p_chapter_number, p_chapter_title,
            p_page_number, p_chunk_index, p_content_text, p_token_count, p_embedding, p_metadata)
    RETURNING chunk_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_save_teaching_guide(
    p_textbook_id UUID, p_subject_code VARCHAR, p_chapter_number INT, p_chapter_title VARCHAR,
    p_institution_level VARCHAR, p_duration_minutes INT, p_lesson_plan_markdown TEXT,
    p_analogies JSONB, p_board_work JSONB, p_misconceptions JSONB, p_formative JSONB, p_model VARCHAR
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.teacher_pedagogical_guides(textbook_id, subject_code, chapter_number, chapter_title,
        institution_level, duration_minutes, lesson_plan_markdown, analogies_and_hooks,
        board_work_blueprint, common_misconceptions, formative_questions, generated_by_model)
    VALUES (p_textbook_id, p_subject_code, p_chapter_number, p_chapter_title, p_institution_level,
        p_duration_minutes, p_lesson_plan_markdown, p_analogies, p_board_work, p_misconceptions,
        p_formative, p_model)
    RETURNING guide_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_list_teaching_guides(p_textbook_id UUID)
RETURNS SETOF public.teacher_pedagogical_guides
LANGUAGE sql
AS $$
    SELECT * FROM public.teacher_pedagogical_guides
    WHERE textbook_id = p_textbook_id ORDER BY created_at DESC;
$$;

CREATE OR REPLACE FUNCTION public.usp_log_rag_message(
    p_session_id UUID, p_student_user_code VARCHAR, p_subject_code VARCHAR, p_textbook_id UUID,
    p_query TEXT, p_chunk_ids UUID[], p_pages INT[], p_response TEXT, p_curiosity NUMERIC
)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.rag_chat_messages(session_id, student_user_code, subject_code, textbook_id,
        student_query, retrieved_k3_chunk_ids, retrieved_pages, ai_response_markdown, curiosity_depth_score)
    VALUES (p_session_id, p_student_user_code, p_subject_code, p_textbook_id,
        p_query, p_chunk_ids, p_pages, p_response, p_curiosity)
    RETURNING message_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_recent_chat(p_session_id UUID, p_limit INT DEFAULT 5)
RETURNS TABLE (student_query TEXT, ai_response_markdown TEXT)
LANGUAGE sql
AS $$
    SELECT student_query, ai_response_markdown FROM (
        SELECT student_query, ai_response_markdown, created_at
        FROM public.rag_chat_messages WHERE session_id = p_session_id
        ORDER BY created_at DESC LIMIT p_limit
    ) t ORDER BY created_at ASC;
$$;

CREATE OR REPLACE FUNCTION public.usp_top_doubts(p_org_code VARCHAR, p_subject_code VARCHAR, p_limit INT DEFAULT 10)
RETURNS TABLE (student_query TEXT, asked_count BIGINT)
LANGUAGE sql
AS $$
    SELECT m.student_query, COUNT(*) FROM public.rag_chat_messages m
    JOIN public.app_users u ON u.user_code = m.student_user_code
    WHERE u.org_code = p_org_code AND m.subject_code = p_subject_code
    GROUP BY m.student_query ORDER BY COUNT(*) DESC LIMIT p_limit;
$$;

-- Pipeline job state
CREATE OR REPLACE FUNCTION public.usp_create_job(p_job_type VARCHAR, p_ref_id VARCHAR)
RETURNS UUID
LANGUAGE plpgsql
AS $$
DECLARE v_id UUID;
BEGIN
    INSERT INTO public.pipeline_jobs(job_type, ref_id) VALUES (p_job_type, p_ref_id) RETURNING job_id INTO v_id;
    RETURN v_id;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_update_job(
    p_job_id UUID, p_status VARCHAR, p_progress NUMERIC, p_detail JSONB DEFAULT NULL, p_error TEXT DEFAULT NULL
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE public.pipeline_jobs
    SET status = p_status, progress = p_progress,
        detail = COALESCE(p_detail, detail), error = p_error, updated_at = NOW()
    WHERE job_id = p_job_id;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_job(p_job_id UUID)
RETURNS SETOF public.pipeline_jobs
LANGUAGE sql
AS $$
    SELECT * FROM public.pipeline_jobs WHERE job_id = p_job_id;
$$;
