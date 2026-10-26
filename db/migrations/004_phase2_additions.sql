-- 004: additions for Phase 2 (guide edit/export, page context, unpublished retrieval for teachers)

-- Extend k=3 retrieval with an optional publish filter (teachers preview unpublished books).
-- Signature is a superset of the FRD 6.3 function; the 4-argument call still works.
DROP FUNCTION IF EXISTS public.usp_match_textbook_chunks_k3(VARCHAR, UUID, vector, INT);
CREATE OR REPLACE FUNCTION public.usp_match_textbook_chunks_k3(
    p_subject_code VARCHAR(64),
    p_textbook_id UUID,
    p_query_embedding vector(1536),
    p_top_k INT DEFAULT 3,
    p_published_only BOOLEAN DEFAULT TRUE,
    p_org_code VARCHAR(64) DEFAULT NULL
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
      AND (p_org_code IS NULL OR st.org_code = p_org_code)
      AND (NOT p_published_only OR st.is_published_to_students = TRUE)
    ORDER BY tc.embedding <=> p_query_embedding
    LIMIT p_top_k;
END;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_page_text(p_textbook_id UUID, p_page_number INT)
RETURNS TABLE (content_text TEXT)
LANGUAGE sql
AS $$
    SELECT content_text FROM public.textbook_chunks
    WHERE textbook_id = p_textbook_id AND page_number = p_page_number
    ORDER BY chunk_index LIMIT 2;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_teaching_guide(p_guide_id UUID)
RETURNS SETOF public.teacher_pedagogical_guides
LANGUAGE sql
AS $$
    SELECT * FROM public.teacher_pedagogical_guides WHERE guide_id = p_guide_id;
$$;

CREATE OR REPLACE FUNCTION public.usp_update_teaching_guide(
    p_guide_id UUID, p_lesson_plan_markdown TEXT, p_analogies JSONB, p_board_work JSONB,
    p_misconceptions JSONB, p_formative JSONB
)
RETURNS VOID
LANGUAGE sql
AS $$
    UPDATE public.teacher_pedagogical_guides
    SET lesson_plan_markdown = COALESCE(p_lesson_plan_markdown, lesson_plan_markdown),
        analogies_and_hooks = COALESCE(p_analogies, analogies_and_hooks),
        board_work_blueprint = COALESCE(p_board_work, board_work_blueprint),
        common_misconceptions = COALESCE(p_misconceptions, common_misconceptions),
        formative_questions = COALESCE(p_formative, formative_questions)
    WHERE guide_id = p_guide_id;
$$;

CREATE OR REPLACE FUNCTION public.usp_get_chapter_text(p_textbook_id UUID, p_chapter_number INT)
RETURNS TABLE (page_number INT, content_text TEXT)
LANGUAGE sql
AS $$
    SELECT page_number, content_text FROM public.textbook_chunks
    WHERE textbook_id = p_textbook_id AND chapter_number = p_chapter_number
    ORDER BY page_number, chunk_index;
$$;
