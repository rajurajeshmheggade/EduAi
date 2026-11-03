#!/bin/sh
# Container entrypoint: apply pending SQL migrations, seed the demo organisation when SEED_DEMO=1, start the API.
# The platform's PORT is honoured (Render, Railway, Fly, Azure all set it).
set -eu
cd "$(dirname "$0")"
: "${DATABASE_URL:?DATABASE_URL must be set (PostgreSQL 16 with the vector extension)}"

python -m scripts.migrate
if [ "${SEED_DEMO:-0}" = "1" ]; then
  python -m scripts.seed
fi

# One worker: background jobs run on in-process threads unless REDIS_URL is set, and the proctoring hub is in-process.
exec uvicorn app.main:app --host 0.0.0.0 --port "${PORT:-8000}" --workers 1 --proxy-headers --forwarded-allow-ips="*"
