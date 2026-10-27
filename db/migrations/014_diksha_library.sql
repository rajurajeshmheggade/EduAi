-- DIKSHA integration for the Digital Library.
-- Source items are metadata references to content hosted by DIKSHA (never copies of the content). They are stored
-- only when a teacher publishes them, so the Student Library can list them; everything else is searched on demand.

CREATE TABLE IF NOT EXISTS public.library_source_items (
    item_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    source VARCHAR(16) NOT NULL CHECK (source IN ('diksha')),
    source_id VARCHAR(100) NOT NULL,              -- DIKSHA identifier, e.g. do_31310347535505817611436
    kind VARCHAR(16) NOT NULL CHECK (kind IN ('textbook', 'resource')),
    name VARCHAR(500) NOT NULL,
    metadata JSONB NOT NULL,                      -- normalised source metadata (licence, attribution, classes, ...)
    source_status VARCHAR(16) NOT NULL DEFAULT 'available' CHECK (source_status IN ('available', 'unavailable')),
    fetched_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    UNIQUE (source, source_id)
);

-- A publication now targets either a school catalog book or a source item (exactly one).
ALTER TABLE public.library_publications ALTER COLUMN book_id DROP NOT NULL;
ALTER TABLE public.library_publications
    ADD COLUMN IF NOT EXISTS source_item_id UUID REFERENCES public.library_source_items(item_id) ON DELETE CASCADE;
ALTER TABLE public.library_publications ADD COLUMN IF NOT EXISTS source_context JSONB;  -- e.g. {textbook_id, chapter}
ALTER TABLE public.library_publications DROP CONSTRAINT IF EXISTS library_publications_one_target;
ALTER TABLE public.library_publications
    ADD CONSTRAINT library_publications_one_target CHECK ((book_id IS NULL) <> (source_item_id IS NULL));

-- FR-015 for source items: one active publication per item and target group.
CREATE UNIQUE INDEX IF NOT EXISTS uq_library_publication_source_active
    ON public.library_publications(org_code, source_item_id, class_code, subject_code, year_code)
    WHERE status = 'published' AND source_item_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS idx_library_publications_source ON public.library_publications(source_item_id);
