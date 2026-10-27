-- 010: Lesson Plans (unit plans) + Session Plans + Learning Resources
--
-- Ported from the Rapid / SARAS teacher console (lesson."tblunitplandetails", lesson."tblsessionplan",
-- "tblsessionstage", "tblsessionresource"). Same model, EduAI conventions: UUID keys, org_code /
-- teacher_code scoping, class & subject codes from public.class_subjects.
--
--   lesson_plans        one unit/lesson plan built in the 7-step creator or by the AI Bot assistant
--   session_plans       a session INSIDE a lesson plan (Create Session form + generated content)
--   session_stages      one Resource Category of a session (Opening … Challenge the Students)
--   session_resources   one resource picked into a stage (snapshotted title / type / url)
--   learning_resources  teacher-added links / files per class + subject (+ chapter) for the Resource Library
--
-- Purely additive: nothing existing is altered.

-- ---------------------------------------------------------------- lesson plans
CREATE TABLE IF NOT EXISTS public.lesson_plans (
    lesson_plan_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL REFERENCES public.organizations(org_code) ON DELETE CASCADE,
    teacher_code VARCHAR(64) NOT NULL,              -- app_users.user_code of the owner
    class_code VARCHAR(64),
    class_name VARCHAR(200) NOT NULL DEFAULT '',
    subject_code VARCHAR(64),
    subject_name VARCHAR(200) NOT NULL DEFAULT '',
    chapter_name VARCHAR(300) NOT NULL DEFAULT '',
    -- Optional link to the indexed textbook chapter the plan was grounded on.
    textbook_id UUID REFERENCES public.subject_textbooks(textbook_id) ON DELETE SET NULL,
    chapter_number INT,
    title VARCHAR(300) NOT NULL,
    board VARCHAR(64),
    duration_mins INT NOT NULL DEFAULT 0,
    -- The plan JSON the Lesson Plan View renders (coreObjectives, assessment, elos, fiveEDesign, …,
    -- plus __creatorState for "Edit Draft"). ai_plan_json keeps the first generated copy.
    ai_plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    plan_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    is_completed BOOLEAN NOT NULL DEFAULT TRUE,     -- FALSE = Draft
    source VARCHAR(16) NOT NULL DEFAULT 'manual' CHECK (source IN ('manual', 'ai_bot')),
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,      -- soft delete
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_lesson_plans_owner
    ON public.lesson_plans(org_code, teacher_code, created_at DESC) WHERE NOT is_deleted;

-- ---------------------------------------------------------------- session plans
CREATE TABLE IF NOT EXISTS public.session_plans (
    session_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    lesson_plan_id UUID NOT NULL REFERENCES public.lesson_plans(lesson_plan_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    teacher_code VARCHAR(64) NOT NULL,
    -- Denormalised from the parent plan at create time so the list needs no join.
    class_code VARCHAR(64),
    class_name VARCHAR(200) NOT NULL DEFAULT '',
    subject_code VARCHAR(64),
    subject_name VARCHAR(200) NOT NULL DEFAULT '',
    chapter_name VARCHAR(300) NOT NULL DEFAULT '',
    session_no INT NOT NULL DEFAULT 1,
    title VARCHAR(300) NOT NULL,
    duration_mins INT NOT NULL DEFAULT 0,
    instructions TEXT,
    -- The ELOs SELECTED for this session — always a subset of the parent plan's own ELOs.
    elos_json JSONB NOT NULL DEFAULT '[]'::jsonb,
    -- AI-generated session content (+ the spliced-in agent blocks under additionalSections) and the
    -- teacher's edited copy. Reads prefer modified, falling back to the generated copy.
    content_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    modified_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    -- Per-agent outcome of the last generate: { "images": {"status":"ok","provider":"serpapi","count":5}, … }
    agent_status_json JSONB NOT NULL DEFAULT '{}'::jsonb,
    status VARCHAR(16) NOT NULL DEFAULT 'draft' CHECK (status IN ('draft', 'completed')),
    row_version BIGINT NOT NULL DEFAULT 1,          -- optimistic concurrency
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ
);
CREATE INDEX IF NOT EXISTS idx_session_plans_plan
    ON public.session_plans(lesson_plan_id, session_no) WHERE NOT is_deleted;
CREATE INDEX IF NOT EXISTS idx_session_plans_owner
    ON public.session_plans(org_code, teacher_code) WHERE NOT is_deleted;
-- Duplicate-session guard; a soft-deleted row frees its number again.
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_plans_plan_no
    ON public.session_plans(lesson_plan_id, session_no) WHERE NOT is_deleted;

CREATE TABLE IF NOT EXISTS public.session_stages (
    stage_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.session_plans(session_id) ON DELETE CASCADE,
    stage VARCHAR(100) NOT NULL,
    sort_order INT NOT NULL DEFAULT 0,
    class_setting VARCHAR(30),                      -- Individual | Group | Whole Class | Pair
    duration_mins INT NOT NULL DEFAULT 0,
    description TEXT,                               -- stage description editor HTML
    UNIQUE (session_id, stage)
);

CREATE TABLE IF NOT EXISTS public.session_resources (
    session_resource_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    session_id UUID NOT NULL REFERENCES public.session_plans(session_id) ON DELETE CASCADE,
    stage_id UUID NOT NULL REFERENCES public.session_stages(stage_id) ON DELETE CASCADE,
    -- Id in the source catalogue: learning_resources / subject_textbooks / evaluation_tests /
    -- evaluation_master_questions / homeworks, per source_kind.
    resource_id VARCHAR(64),
    source_kind VARCHAR(20) NOT NULL DEFAULT 'resource'
        CHECK (source_kind IN ('resource', 'textbook', 'test', 'question', 'activity')),
    title VARCHAR(300) NOT NULL,
    resource_type VARCHAR(40),
    url TEXT,
    chapter_name VARCHAR(300),
    meta VARCHAR(200),
    sort_order INT NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_session_resources_stage ON public.session_resources(stage_id, sort_order);
-- A resource cannot be picked twice into one stage.
CREATE UNIQUE INDEX IF NOT EXISTS ux_session_resources_stage_resource
    ON public.session_resources(stage_id, source_kind, resource_id) WHERE resource_id IS NOT NULL;

-- ---------------------------------------------------------------- learning resources (Resource Library)
CREATE TABLE IF NOT EXISTS public.learning_resources (
    resource_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    chapter_name VARCHAR(300),                      -- NULL = whole subject
    title VARCHAR(300) NOT NULL,
    resource_type VARCHAR(40) NOT NULL DEFAULT 'Link'
        CHECK (resource_type IN ('Video', 'Audio', 'PDF', 'Document', 'Presentation', 'Image', 'Activity', 'Link')),
    url TEXT,                                       -- external link
    file_key TEXT,                                  -- uploaded file (storage key; served via signed URL)
    file_name VARCHAR(255),
    file_size BIGINT,
    description TEXT,
    created_by VARCHAR(64) NOT NULL,
    is_deleted BOOLEAN NOT NULL DEFAULT FALSE,
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    CHECK (url IS NOT NULL OR file_key IS NOT NULL),
    FOREIGN KEY (org_code, class_code, subject_code)
        REFERENCES public.class_subjects(org_code, class_code, subject_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_learning_resources_scope
    ON public.learning_resources(org_code, class_code, subject_code) WHERE NOT is_deleted;
