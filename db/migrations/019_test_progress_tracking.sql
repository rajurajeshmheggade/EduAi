-- 019: Student online-test progress tracking + an 80% completion flag.
-- Reuses the existing online-test attempt row (evaluation_candidate_scripts, submission_mode = 'ONLINE_TEST_UI')
-- instead of a new table, so progress persists exactly like every other part of the attempt (survives refresh,
-- logout/login, server restart) and is already scoped by the test's existing RBAC and org isolation.
--
-- progress_percentage: recomputed on every autosave / submit from the real server-held answers (never from the
--   client). progress_flagged_at: set ONCE, the first time progress_percentage reaches the configured threshold
--   (TEST_PROGRESS_FLAG_THRESHOLD, default 80) — the single source of truth for "has the 80% flag already been
--   raised for this attempt", so the student toast and the teacher notification never repeat for the same attempt.

ALTER TABLE public.evaluation_candidate_scripts
    ADD COLUMN IF NOT EXISTS progress_percentage NUMERIC(5,2) NOT NULL DEFAULT 0,
    ADD COLUMN IF NOT EXISTS progress_flagged_at TIMESTAMPTZ;

-- Teacher "who is near completion right now" queries filter on this.
CREATE INDEX IF NOT EXISTS idx_eval_scripts_progress
    ON public.evaluation_candidate_scripts(eval_test_id, progress_flagged_at)
    WHERE processing_status = 'IN_PROGRESS';
