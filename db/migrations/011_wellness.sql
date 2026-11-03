-- 011: Student Wellness (MindAlign companion integrated into EduAI)
--
-- A student-owned wellness tracker: journal + AI analysis, mood check-ins, the "Aura" companion chat with
-- long-term memory and deterministic safety guardrails, breathing / focus / stress-buster activity, XP levels and
-- a daily quiz. Teachers see aggregated trends and safety alerts for their classes — never journal or chat text.
--
-- Every row is keyed by (org_code, student_code) taken from the bearer token; nothing is addressed by a client-sent
-- username (the original app's IDOR). Rows cascade with the student account so deleting a student deletes their
-- wellness data.

CREATE TABLE IF NOT EXISTS public.wellness_profiles (
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    -- No exam picker: prompts use the student's class, subjects and knowledge level from EduAI (services/wellness/context.py).
    exam_date DATE,                                       -- optional, self-set: when their next school exams start
    avatar VARCHAR(16) NOT NULL DEFAULT '🧘',
    xp INT NOT NULL DEFAULT 0 CHECK (xp >= 0),            -- XP inside the current level (MindAlign rule)
    level INT NOT NULL DEFAULT 1 CHECK (level >= 1),
    total_xp INT NOT NULL DEFAULT 0 CHECK (total_xp >= 0),
    breath_cycles INT NOT NULL DEFAULT 0,
    tips_json JSONB,                                      -- cached AI daily tips
    tips_key VARCHAR(120),                                -- cache key: date + latest journal id
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    PRIMARY KEY (org_code, student_code)
);

CREATE TABLE IF NOT EXISTS public.wellness_journals (
    journal_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    kind VARCHAR(16) NOT NULL DEFAULT 'journal' CHECK (kind IN ('journal', 'checkin')),
    entry_text TEXT NOT NULL,
    stress_input INT NOT NULL CHECK (stress_input BETWEEN 1 AND 100),
    mood_score INT NOT NULL CHECK (mood_score BETWEEN 1 AND 100),
    analysis JSONB NOT NULL DEFAULT '{}'::jsonb,
    coping_done JSONB NOT NULL DEFAULT '[]'::jsonb,       -- coping strategy titles the student ticked
    ai_source VARCHAR(16) NOT NULL DEFAULT 'fallback',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wellness_journals_student
    ON public.wellness_journals(org_code, student_code, created_at DESC);

CREATE TABLE IF NOT EXISTS public.wellness_chat_messages (
    message_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    role VARCHAR(8) NOT NULL CHECK (role IN ('user', 'model')),
    content TEXT NOT NULL,
    channel VARCHAR(8) NOT NULL DEFAULT 'chat' CHECK (channel IN ('chat', 'live')),
    guardrail_type VARCHAR(40),
    ai_source VARCHAR(16),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wellness_chat_student
    ON public.wellness_chat_messages(org_code, student_code, message_id DESC);

-- Aura long-term memory (facts extracted from chat + recent journal triggers)
CREATE TABLE IF NOT EXISTS public.wellness_memories (
    memory_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    category VARCHAR(40) NOT NULL,
    memory_text VARCHAR(300) NOT NULL,
    confidence NUMERIC(3,2) NOT NULL DEFAULT 1.0,
    source VARCHAR(16) NOT NULL DEFAULT 'chat',
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (org_code, student_code, category, memory_text)
);

-- Server-authoritative XP ledger (fixed amounts per activity, daily caps)
CREATE TABLE IF NOT EXISTS public.wellness_xp_events (
    event_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    activity VARCHAR(40) NOT NULL,
    xp INT NOT NULL,
    details VARCHAR(200),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wellness_xp_student_activity
    ON public.wellness_xp_events(org_code, student_code, activity, created_at DESC);

-- Guardrail audit log. The message is retained for safeguarding review only; the teacher API never returns it.
CREATE TABLE IF NOT EXISTS public.wellness_guardrail_events (
    event_id BIGSERIAL PRIMARY KEY,
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    guardrail_type VARCHAR(40) NOT NULL,
    severity VARCHAR(16) NOT NULL,
    user_message TEXT NOT NULL,
    acknowledged_at TIMESTAMPTZ,
    acknowledged_by VARCHAR(64),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_wellness_guardrail_student
    ON public.wellness_guardrail_events(org_code, student_code, created_at DESC);

-- One Zen Brain quiz question per student per day (answer checked server-side)
CREATE TABLE IF NOT EXISTS public.wellness_daily_quiz (
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL REFERENCES public.app_users(user_code) ON DELETE CASCADE,
    quiz_date DATE NOT NULL,
    question JSONB NOT NULL,
    answer_idx INT,
    is_correct BOOLEAN,
    answered_at TIMESTAMPTZ,
    PRIMARY KEY (org_code, student_code, quiz_date)
);
