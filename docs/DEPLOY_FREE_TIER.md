# Free-tier hosting: Vercel + Render + Neon

A public URL for the whole platform at $0, no credit card:

| Part | Service | Free plan |
| --- | --- | --- |
| Frontend | Vercel (Hobby) | static Vite build, see [DEPLOY_VERCEL.md](DEPLOY_VERCEL.md) |
| API | Render free web service, Docker | 512 MB RAM, 0.1 CPU, sleeps after 15 idle min, 750 h/month |
| Database | Neon free | PostgreSQL + pgvector, 1 GB storage, no expiry |

The API image comes from the root `Dockerfile`; `render.yaml` describes the Render service. All AI keys go on Render.

## 1. Database on Neon (5 min)

1. neon.com → sign up with GitHub → **New project**: Postgres 16 or 17, region *AWS Asia Pacific (Singapore)*.
2. Copy the **direct** connection string (not the pooled one: PgBouncer breaks psycopg's prepared statements). It looks
   like `postgresql://neondb_owner:...@ep-....ap-southeast-1.aws.neon.tech/neondb?sslmode=require`.

Migrations run automatically on API start and create the `vector` extension themselves.

## 2. API on Render (10 min, mostly build time)

1. render.com → sign up with GitHub → **New → Blueprint** → connect `rajurajeshmheggade/EduAi`. Render reads
   `render.yaml` and asks for the values marked `sync: false`:
   - `DATABASE_URL` — the Neon string from step 1
   - `CORS_ORIGINS` — your Vercel URL(s), comma-separated, e.g. `https://eduai.vercel.app` (edit later if unknown yet)
   - `PUBLIC_BASE_URL` — the Render URL this service gets, e.g. `https://eduai-api.onrender.com` (Render may add a
     suffix if the name is taken: use the URL it shows after creation)
   - `PROVIDER_MODE` — `azure` or `openai`, and the matching endpoint / key
2. **Apply**. The first Docker build takes 5–8 minutes. Then open `https://<service>.onrender.com/health` and check
   `"ai_keys_configured": true` and `"pgvector": "0.x"`.
3. **Environment** tab: add every other key from your `.env` that you use (`AZURE_OPENAI_WHISPER_DEPLOYMENT`,
   `SERPAPI_API_KEY`, `YOUTUBE_API_KEY`, OpenAI keys, TTS deployments…). Each change redeploys.

`TZ=Asia/Kolkata` keeps "today" for attendance and timetables on Indian time (the server itself runs in UTC).
`SEED_DEMO=1` creates the demo organisation and users on every start (idempotent), so the README logins work. Set it
to `0` once real institutions are onboarded.

## 3. Frontend on Vercel

In the Vercel project: `VITE_API_BASE_URL=https://<service>.onrender.com`, replace `YOUR-BACKEND-HOST` in
`frontend/vercel.json` with the same host, push. Then make sure `CORS_ORIGINS` on Render contains the Vercel URL.

## What the free tier changes

- **Sleep**: after 15 minutes without requests the instance stops; the next request takes ~1 minute. A free pinger
  (e.g. cron-job.org hitting `/health` every 10 minutes) keeps it awake; one service running 24/7 (744 h) fits in the
  750 free hours.
- **Memory**: 512 MB. `render.yaml` lowers OCR rendering to 150 DPI / 2 pages per call and limits scripts to 20 MB so
  handwritten-script evaluation fits. Very large textbooks may still be slow to index on 0.1 CPU.
- **Files**: the free instance has no disk, so uploaded PDFs (textbooks, scripts) disappear when it restarts or wakes up.
  The vector index in Neon survives, but the page viewer needs the PDF. For durable files set `STORAGE_MODE=azure`
  with `AZURE_STORAGE_CONNECTION_STRING` (a storage account costs cents per month), or re-upload after a restart.
- **Jobs**: textbook indexing and AI evaluation run on in-process threads; keep the browser on the progress page so the
  instance is not idle-stopped mid-job.
- **Offline voice**: the image skips Kokoro; the AI tutor uses the provider's TTS when configured, otherwise espeak-ng.

## Railway instead of Render

Better hardware (no sleep, 1 GB+ RAM, volumes) but only a trial: $5 of credit for 30 days without a card, then the
Hobby plan at $5/month. Steps: railway.com → **New Project → Deploy from GitHub repo** (the root `Dockerfile` and
`railway.json` are picked up) → add a database service from the Docker image `pgvector/pgvector:pg16` with a volume on
`/var/lib/postgresql/data` and `POSTGRES_PASSWORD` set → on the API service add a volume at `/app/.data` and the same
environment variables as above, with `DATABASE_URL=postgresql://postgres:<password>@<postgres-service>.railway.internal:5432/postgres`.
Generate a public domain under **Settings → Networking**.
