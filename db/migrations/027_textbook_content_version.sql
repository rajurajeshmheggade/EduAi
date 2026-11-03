-- 027 — Content version of an uploaded textbook, for the AI avatar tutor's page pipeline cache.
-- Explained / voiced pages are cached under a key that includes this checksum, so when a textbook's PDF changes
-- (re-indexed with new content) every cached explanation of it is regenerated instead of served stale.
-- Set by the indexing task (SHA-256 of the PDF bytes); NULL for books indexed before this migration, which then
-- fall back to a version derived from the stored file's key.

ALTER TABLE public.subject_textbooks ADD COLUMN IF NOT EXISTS content_sha256 CHAR(64);
ALTER TABLE public.subject_textbooks ADD COLUMN IF NOT EXISTS content_updated_at TIMESTAMPTZ;
