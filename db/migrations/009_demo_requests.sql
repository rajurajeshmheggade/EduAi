-- 009: Demo / sales enquiries from the public landing page (super-admin inbox).
CREATE TABLE IF NOT EXISTS public.demo_requests (
    request_id UUID PRIMARY KEY DEFAULT uuid_generate_v4(),
    full_name VARCHAR(200) NOT NULL,
    email VARCHAR(255) NOT NULL,
    phone VARCHAR(32),
    institution_name VARCHAR(250) NOT NULL,
    institution_type VARCHAR(16) NOT NULL CHECK (institution_type IN ('school', 'college', 'coaching')),
    role VARCHAR(64),
    city VARCHAR(100),
    student_count VARCHAR(16),
    interests TEXT[] NOT NULL DEFAULT '{}',
    message TEXT,
    status VARCHAR(16) NOT NULL DEFAULT 'NEW' CHECK (status IN ('NEW', 'CONTACTED', 'DEMO_DONE', 'WON', 'LOST')),
    notes TEXT,
    source_ip VARCHAR(64),
    created_at TIMESTAMPTZ DEFAULT NOW(),
    updated_at TIMESTAMPTZ DEFAULT NOW()
);
CREATE INDEX IF NOT EXISTS idx_demo_requests_created ON public.demo_requests(created_at DESC);
