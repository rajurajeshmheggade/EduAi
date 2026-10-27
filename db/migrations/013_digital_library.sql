-- Digital Library (FRD: Teacher Book Selection and Student Publishing).
-- Catalog records are verified metadata + authorised access links; publications are stored separately and audited.

-- ---------------------------------------------------------------- class grade (1-12) for book/class matching
ALTER TABLE public.classes ADD COLUMN IF NOT EXISTS grade_number INT CHECK (grade_number BETWEEN 1 AND 12);

DROP FUNCTION IF EXISTS public.usp_list_classes(VARCHAR);
CREATE FUNCTION public.usp_list_classes(p_org_code VARCHAR)
RETURNS TABLE (class_id UUID, class_code VARCHAR, class_name VARCHAR, year_code VARCHAR, cycle_code VARCHAR,
               class_teacher_code VARCHAR, class_teacher_name VARCHAR, is_active BOOLEAN, student_count BIGINT,
               subjects JSONB, room_number VARCHAR, grade_number INT)
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
        c.grade_number
    FROM public.classes c
    LEFT JOIN public.app_users t ON t.org_code = c.org_code AND t.user_code = c.class_teacher_code
    WHERE c.org_code = p_org_code
    ORDER BY c.class_code;
$$;

-- ---------------------------------------------------------------- catalog
-- org_code NULL = platform-wide catalog (super-admin); otherwise an institution's own records (its admins).
CREATE TABLE IF NOT EXISTS public.library_books (
    book_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64),
    board VARCHAR(32) NOT NULL CHECK (board IN ('NCERT_CBSE', 'KARNATAKA_STATE')),
    class_number INT NOT NULL CHECK (class_number BETWEEN 1 AND 12),
    subject_name VARCHAR(120) NOT NULL,
    language VARCHAR(32) NOT NULL CHECK (language IN ('English', 'Kannada', 'Hindi')),
    title VARCHAR(300) NOT NULL,
    academic_year VARCHAR(32),
    publisher VARCHAR(200),
    source_name VARCHAR(200) NOT NULL,
    source_url TEXT NOT NULL CHECK (source_url LIKE 'https://%'),
    access_mode VARCHAR(20) NOT NULL DEFAULT 'official_link' CHECK (access_mode IN ('official_link', 'in_app_reader')),
    license_status VARCHAR(24) NOT NULL DEFAULT 'unknown' CHECK (license_status IN ('verified', 'permission_required', 'unknown')),
    license_notice TEXT,
    in_app_reader_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    download_allowed BOOLEAN NOT NULL DEFAULT FALSE,
    verification_status VARCHAR(16) NOT NULL DEFAULT 'pending' CHECK (verification_status IN ('verified', 'pending', 'rejected')),
    link_status VARCHAR(16) NOT NULL DEFAULT 'unchecked' CHECK (link_status IN ('unchecked', 'ok', 'broken')),
    last_verified_at TIMESTAMPTZ,
    file_key TEXT,                      -- authorised copy in our storage (only when licence allows hosting)
    file_bytes BIGINT,
    chapters JSONB NOT NULL DEFAULT '[]'::jsonb,   -- [{title, page}]
    is_active BOOLEAN NOT NULL DEFAULT TRUE,
    created_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    CONSTRAINT library_books_unique UNIQUE NULLS NOT DISTINCT (org_code, board, class_number, language, title)
);
CREATE INDEX IF NOT EXISTS idx_library_books_filters ON public.library_books(board, class_number, language, subject_name);
CREATE INDEX IF NOT EXISTS idx_library_books_org ON public.library_books(org_code);

-- ---------------------------------------------------------------- publications (separate from the catalog)
CREATE TABLE IF NOT EXISTS public.library_publications (
    publication_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL,
    book_id UUID NOT NULL REFERENCES public.library_books(book_id) ON DELETE CASCADE,
    teacher_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    year_code VARCHAR(32) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'published' CHECK (status IN ('published', 'unpublished')),
    published_at TIMESTAMPTZ DEFAULT NOW(),
    unpublished_at TIMESTAMPTZ,
    unpublished_by VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (org_code, class_code) REFERENCES public.classes(org_code, class_code) ON DELETE CASCADE
);
-- FR-015: one active publication per book and target group.
CREATE UNIQUE INDEX IF NOT EXISTS uq_library_publication_active
    ON public.library_publications(org_code, book_id, class_code, subject_code, year_code) WHERE status = 'published';
CREATE INDEX IF NOT EXISTS idx_library_publications_class ON public.library_publications(org_code, class_code, year_code, status);
CREATE INDEX IF NOT EXISTS idx_library_publications_teacher ON public.library_publications(org_code, teacher_code);

-- FR-017: audit trail of publication changes.
CREATE TABLE IF NOT EXISTS public.library_publication_events (
    event_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    publication_id UUID NOT NULL REFERENCES public.library_publications(publication_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    action VARCHAR(16) NOT NULL CHECK (action IN ('published', 'republished', 'unpublished')),
    actor_code VARCHAR(64) NOT NULL,
    actor_role VARCHAR(16) NOT NULL,
    details JSONB NOT NULL DEFAULT '{}'::jsonb,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_library_events_pub ON public.library_publication_events(publication_id, created_at);
