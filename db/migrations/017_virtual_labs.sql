-- Virtual Labs (Classes 6-12): teachers assign DIKSHA virtual-lab experiments (OLabs simulations by Amrita / CDAC with
-- NCERT) to a class subject; students perform the simulation, keep a lab record and answer viva questions.
-- The lab itself stays on DIKSHA: an assignment stores only a metadata snapshot of the experiment (ids, names, licence,
-- attribution, DIKSHA file references), never a copy of the content.

CREATE TABLE IF NOT EXISTS public.virtual_lab_assignments (
    assignment_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    year_code VARCHAR(32),
    teacher_code VARCHAR(64) NOT NULL,
    collection_id VARCHAR(100) NOT NULL,          -- DIKSHA virtual-lab collection (lab manual)
    lab_id VARCHAR(100) NOT NULL,                 -- DIKSHA unit of that collection = one experiment
    lab JSONB NOT NULL,                           -- normalised experiment snapshot (resources, licence, attribution)
    title VARCHAR(300) NOT NULL,
    instructions TEXT,
    worksheet JSONB NOT NULL,                     -- aim, steps, observation table, viva questions (with answers)
    max_marks NUMERIC(6, 2) NOT NULL CHECK (max_marks >= 0),
    min_minutes INT NOT NULL DEFAULT 0 CHECK (min_minutes BETWEEN 0 AND 180),
    available_from TIMESTAMPTZ,
    due_at TIMESTAMPTZ,
    allow_late BOOLEAN NOT NULL DEFAULT TRUE,
    status VARCHAR(16) NOT NULL DEFAULT 'active' CHECK (status IN ('active', 'closed')),
    created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    FOREIGN KEY (org_code, class_code, subject_code)
        REFERENCES public.class_subjects(org_code, class_code, subject_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_vlab_assignments_class ON public.virtual_lab_assignments(org_code, class_code, status, due_at);
CREATE INDEX IF NOT EXISTS idx_vlab_assignments_teacher ON public.virtual_lab_assignments(org_code, teacher_code);

CREATE TABLE IF NOT EXISTS public.virtual_lab_attempts (
    attempt_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    assignment_id UUID NOT NULL REFERENCES public.virtual_lab_assignments(assignment_id) ON DELETE CASCADE,
    org_code VARCHAR(64) NOT NULL,
    student_code VARCHAR(64) NOT NULL,
    status VARCHAR(16) NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress', 'submitted', 'reviewed')),
    started_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    last_active_at TIMESTAMPTZ,
    active_seconds INT NOT NULL DEFAULT 0 CHECK (active_seconds >= 0),   -- time in the lab, capped by the server clock
    launches INT NOT NULL DEFAULT 0,                                    -- simulation opened (in app or on DIKSHA)
    steps_done JSONB NOT NULL DEFAULT '[]'::jsonb,                      -- indices of procedure steps ticked
    observations JSONB NOT NULL DEFAULT '[]'::jsonb,                    -- rows of the observation table
    answers JSONB NOT NULL DEFAULT '{}'::jsonb,                         -- {question id: option index | text}
    conclusion TEXT,
    auto_score NUMERIC(6, 2),                                           -- MCQs, marked on submit
    auto_max NUMERIC(6, 2),
    ai_feedback JSONB,                                                  -- per-question + record feedback, suggested marks
    suggested_marks NUMERIC(6, 2),
    marks NUMERIC(6, 2),                                                -- final marks set by the teacher
    teacher_feedback TEXT,
    submitted_at TIMESTAMPTZ,
    is_late BOOLEAN NOT NULL DEFAULT FALSE,
    returned_count INT NOT NULL DEFAULT 0,
    reviewed_at TIMESTAMPTZ,
    reviewed_by VARCHAR(64),
    updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
    UNIQUE (assignment_id, student_code)
);
CREATE INDEX IF NOT EXISTS idx_vlab_attempts_student ON public.virtual_lab_attempts(org_code, student_code);
