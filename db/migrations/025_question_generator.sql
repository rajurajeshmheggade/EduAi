-- 025: AI Question Generator — NLP content mapping, question papers (draft → published, versioned), ordered typed
-- question items, a reusable org / teacher question bank (normalised-text hash + embedding for de-duplication),
-- uploaded question media, and per-institution settings (Assertion–Reason instruction and answer codes).

-- ---------------------------------------------------------------- AI module switch (on for every institution)
ALTER TABLE public.organizations ALTER COLUMN ai_modules
    SET DEFAULT '{rag_chatbot,ai_avatar_tutor,ocr_evaluation,capability_analysis,question_generator}';
UPDATE public.organizations SET ai_modules = array_append(ai_modules, 'question_generator')
 WHERE NOT ('question_generator' = ANY(ai_modules));

-- ---------------------------------------------------------------- class subject → NLP repository folder (admin override)
-- Automatic matching (grade ↔ Roman numeral class folder, normalised subject name + alias table) is done in code;
-- a row here wins over it, so an admin can correct a subject the automatic matching gets wrong or cannot place.
CREATE TABLE IF NOT EXISTS public.qgen_subject_map (
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    nlp_class VARCHAR(32) NOT NULL,
    nlp_subject VARCHAR(120) NOT NULL,
    updated_by VARCHAR(64),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_code, class_code, subject_code),
    FOREIGN KEY (org_code, class_code) REFERENCES public.classes(org_code, class_code) ON DELETE CASCADE
);

-- ---------------------------------------------------------------- per-institution settings
CREATE TABLE IF NOT EXISTS public.qgen_settings (
    org_code VARCHAR(64) PRIMARY KEY REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    ar_instruction TEXT,
    ar_codes JSONB,                                   -- exactly four answer-code texts, A..D
    updated_by VARCHAR(64),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);

-- ---------------------------------------------------------------- uploaded images (question diagrams, school logo)
CREATE TABLE IF NOT EXISTS public.qgen_media (
    media_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    owner_code VARCHAR(64) NOT NULL,
    storage_key TEXT NOT NULL,
    content_type VARCHAR(40) NOT NULL CHECK (content_type IN ('image/png', 'image/jpeg')),
    byte_size INT NOT NULL CHECK (byte_size > 0),
    width INT NOT NULL,
    height INT NOT NULL,
    sha256 CHAR(64) NOT NULL,
    original_name VARCHAR(255),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_qgen_media_owner ON public.qgen_media(org_code, owner_code);

-- ---------------------------------------------------------------- question papers
-- A published paper is final: it can no longer be changed (enforced by the API and the trigger below). Editing
-- again creates a new DRAFT version in the same family (family_id = the first version's id).
CREATE TABLE IF NOT EXISTS public.qgen_papers (
    paper_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    family_id UUID NOT NULL,
    version INT NOT NULL DEFAULT 1 CHECK (version >= 1),
    parent_paper_id UUID REFERENCES public.qgen_papers(paper_id) ON DELETE SET NULL,
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    teacher_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    nlp_class VARCHAR(32),
    nlp_subject VARCHAR(120),
    chapter VARCHAR(300),
    title VARCHAR(300) NOT NULL,
    language VARCHAR(8) NOT NULL DEFAULT 'en' CHECK (language IN ('en', 'hi', 'kn', 'ta')),
    header JSONB NOT NULL DEFAULT '{}'::jsonb,       -- institution / logo / exam title / year / duration / instructions
    sections JSONB NOT NULL DEFAULT '[]'::jsonb,     -- [{id, title, instructions}]
    status VARCHAR(16) NOT NULL DEFAULT 'DRAFT' CHECK (status IN ('DRAFT', 'PUBLISHED')),
    revision INT NOT NULL DEFAULT 1,                 -- optimistic concurrency for saves
    total_marks NUMERIC(8,2) NOT NULL DEFAULT 0,
    question_count INT NOT NULL DEFAULT 0,
    published_at TIMESTAMPTZ,
    published_by VARCHAR(64),
    published_snapshot JSONB,                        -- the exact paper as published (exports read this)
    eval_test_id UUID,                               -- Online Test / Assignment created from the published paper
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (family_id, version),
    FOREIGN KEY (org_code, class_code) REFERENCES public.classes(org_code, class_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_qgen_papers_teacher ON public.qgen_papers(org_code, teacher_code, updated_at DESC);

CREATE TABLE IF NOT EXISTS public.qgen_paper_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    paper_id UUID NOT NULL REFERENCES public.qgen_papers(paper_id) ON DELETE CASCADE,
    position INT NOT NULL,
    section_id VARCHAR(40),
    qtype VARCHAR(24) NOT NULL,
    marks NUMERIC(7,2) NOT NULL CHECK (marks > 0),
    difficulty VARCHAR(8) NOT NULL CHECK (difficulty IN ('EASY', 'MEDIUM', 'HARD')),
    bloom VARCHAR(12) NOT NULL,
    origin VARCHAR(8) NOT NULL CHECK (origin IN ('AI', 'MANUAL', 'BANK')),
    bank_id UUID,
    question JSONB NOT NULL,                         -- the full typed question (see services/qgen/schema.py)
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (paper_id, position) DEFERRABLE INITIALLY DEFERRED
);
CREATE INDEX IF NOT EXISTS idx_qgen_paper_items_paper ON public.qgen_paper_items(paper_id, position);

-- Belt and braces: a published paper's items cannot change even if a code path forgot to check.
CREATE OR REPLACE FUNCTION public.qgen_block_published_items() RETURNS trigger
LANGUAGE plpgsql AS $$
DECLARE v_status VARCHAR;
BEGIN
    SELECT status INTO v_status FROM public.qgen_papers
     WHERE paper_id = COALESCE(NEW.paper_id, OLD.paper_id);
    IF v_status = 'PUBLISHED' THEN
        RAISE EXCEPTION 'QGEN_PUBLISHED: a published question paper cannot be changed';
    END IF;
    RETURN COALESCE(NEW, OLD);
END $$;
DROP TRIGGER IF EXISTS trg_qgen_items_published ON public.qgen_paper_items;
CREATE TRIGGER trg_qgen_items_published BEFORE INSERT OR UPDATE OR DELETE ON public.qgen_paper_items
    FOR EACH ROW EXECUTE FUNCTION public.qgen_block_published_items();

-- ---------------------------------------------------------------- question bank
CREATE TABLE IF NOT EXISTS public.qgen_bank (
    bank_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    owner_code VARCHAR(64) NOT NULL,
    visibility VARCHAR(8) NOT NULL DEFAULT 'PRIVATE' CHECK (visibility IN ('PRIVATE', 'ORG')),
    class_code VARCHAR(64),
    subject_code VARCHAR(64),
    nlp_class VARCHAR(32),
    nlp_subject VARCHAR(120),
    chapter VARCHAR(300),
    topic VARCHAR(300),
    qtype VARCHAR(24) NOT NULL,
    difficulty VARCHAR(8) NOT NULL,
    bloom VARCHAR(12) NOT NULL,
    marks NUMERIC(7,2) NOT NULL,
    language VARCHAR(8) NOT NULL DEFAULT 'en',
    question JSONB NOT NULL,
    plain_text TEXT NOT NULL,
    text_hash CHAR(64) NOT NULL,
    embedding vector(1536),
    source_paper_id UUID,
    usage_count INT NOT NULL DEFAULT 0,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_code, owner_code, text_hash)
);
CREATE INDEX IF NOT EXISTS idx_qgen_bank_scope ON public.qgen_bank(org_code, nlp_class, nlp_subject, chapter);
CREATE INDEX IF NOT EXISTS idx_qgen_bank_hash ON public.qgen_bank(org_code, text_hash);
