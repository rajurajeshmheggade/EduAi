-- Virtual Labs: watching the lab's video(s) to the end unlocks Submit (enforced by POST /virtual-labs/my/{id}/submit).
-- One row per attempt and video. The browser reports the parts it has actually played (`segments`, merged [start, end]
-- intervals in seconds — seeking does not add coverage); the server credits watched time no faster than real time at
-- the player's top speed (2x) since the previous report, so progress cannot be claimed in bulk, and keeps it across
-- reloads. Completion = the end was reached AND credited coverage >= 90% of the video. Nothing about the video itself
-- is stored (the file stays on its source host).

CREATE TABLE IF NOT EXISTS public.virtual_lab_video_progress (
    attempt_id UUID NOT NULL REFERENCES public.virtual_lab_attempts(attempt_id) ON DELETE CASCADE,
    resource_id VARCHAR(100) NOT NULL,                          -- catalogue id of the video (part of the lab snapshot)
    duration_seconds NUMERIC(9, 2) NOT NULL CHECK (duration_seconds > 0),
    segments JSONB NOT NULL DEFAULT '[]'::jsonb,                -- merged [start, end] intervals actually played
    watched_seconds NUMERIC(9, 2) NOT NULL DEFAULT 0 CHECK (watched_seconds >= 0),   -- credited (rate-limited) coverage
    last_position NUMERIC(9, 2) NOT NULL DEFAULT 0 CHECK (last_position >= 0),
    reached_end BOOLEAN NOT NULL DEFAULT FALSE,                 -- the player reported the `ended` state
    completed_at TIMESTAMPTZ,
    reports INT NOT NULL DEFAULT 0 CHECK (reports >= 0),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (attempt_id, resource_id)
);
