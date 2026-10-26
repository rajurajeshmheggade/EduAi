-- 001: Extensions (run in pgAdmin 4 Query Tool or via backend/scripts/migrate.py)
CREATE EXTENSION IF NOT EXISTS vector;

-- uuid-ossp is standard on Azure Database for PostgreSQL. Minimal local builds (e.g. the embedded
-- dev server) may lack it, so fall back to a compatible uuid_generate_v4() backed by gen_random_uuid().
DO $$
BEGIN
    CREATE EXTENSION IF NOT EXISTS "uuid-ossp";
EXCEPTION WHEN OTHERS THEN
    RAISE NOTICE 'uuid-ossp unavailable (%), defining uuid_generate_v4() fallback', SQLERRM;
    CREATE OR REPLACE FUNCTION public.uuid_generate_v4() RETURNS uuid
        LANGUAGE sql VOLATILE AS 'SELECT gen_random_uuid()';
END;
$$;
