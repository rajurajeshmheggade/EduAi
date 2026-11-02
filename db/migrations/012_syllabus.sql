-- Syllabus per class subject: ordered chapters, each with ordered sub-topics.
-- Keyed to the class (not class_subjects) so removing and re-adding a subject keeps its syllabus;
-- the API only serves chapters for subjects that currently exist in the class.

CREATE TABLE IF NOT EXISTS public.syllabus_chapters (
    chapter_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    org_code VARCHAR(64) NOT NULL,
    class_code VARCHAR(64) NOT NULL,
    subject_code VARCHAR(64) NOT NULL,
    position INT NOT NULL,
    title VARCHAR(300) NOT NULL,
    description TEXT,
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW(),
    FOREIGN KEY (org_code, class_code) REFERENCES public.classes(org_code, class_code) ON DELETE CASCADE
);
CREATE INDEX IF NOT EXISTS idx_syllabus_chapters_subject
    ON public.syllabus_chapters(org_code, class_code, subject_code, position);

CREATE TABLE IF NOT EXISTS public.syllabus_topics (
    topic_id UUID PRIMARY KEY DEFAULT gen_random_uuid(),
    chapter_id UUID NOT NULL REFERENCES public.syllabus_chapters(chapter_id) ON DELETE CASCADE,
    position INT NOT NULL,
    title VARCHAR(300) NOT NULL,
    created_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_syllabus_topics_chapter ON public.syllabus_topics(chapter_id, position);
