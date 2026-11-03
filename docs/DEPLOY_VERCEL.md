# Deploying EduAI: frontend on Vercel, backend elsewhere

Vercel hosts the **frontend only** (`frontend/`, a static Vite build). The FastAPI backend, PostgreSQL + pgvector, the
uploads and **every AI key in `.env`** live on a separate always-on host: the AI features (RAG chat, evaluation, lesson
plans, TTS, OCR) all run server-side, so nothing from `.env` goes to Vercel except the two optional `VITE_*` values.

```
browser ──▶ https://<project>.vercel.app   (React app, static)
   │
   └──▶ https://<backend-host>             (uvicorn app.main:app · PostgreSQL+pgvector · Redis optional)
```

## 1. Backend first

> Zero-cost path (Render free + Neon free, Docker image from the root `Dockerfile`): [DEPLOY_FREE_TIER.md](DEPLOY_FREE_TIER.md).

Any host that runs a Python process with ~2 GB RAM works: Azure App Service / Container Apps (matches the Azure OpenAI
setup), Render, Railway, Fly.io, a VM, or this machine behind a Cloudflare Tunnel. Vercel's serverless functions are
**not** suitable (PyMuPDF + onnxruntime + background jobs + local files exceed their size and time limits).

```bash
pip install -r backend/requirements.txt
cd backend && python -m scripts.migrate          # or scripts.seed for migrations + demo org/users
uvicorn app.main:app --host 0.0.0.0 --port ${PORT:-8000}
```

Environment variables on the backend host (same names as `.env.example`):

| Variable | Value |
| --- | --- |
| `ENVIRONMENT` | `production` |
| `DATABASE_URL` | PostgreSQL 16 with the `vector` extension: Azure Database for PostgreSQL Flexible Server, Neon, Supabase or Render Postgres all support pgvector. `?sslmode=require` |
| `JWT_SECRET` | long random string |
| `CORS_ORIGINS` | `https://<project>.vercel.app,https://<your-custom-domain>` (comma-separated, no trailing slash) |
| `PROVIDER_MODE` + keys | copy the `AZURE_OPENAI_*` or `OPENAI_*` block from your working `.env`, plus `SERPAPI_API_KEY`, `YOUTUBE_API_KEY`, TTS and other keys you use |
| `STORAGE_MODE` | `local` needs a persistent disk; on an ephemeral host use `azure` with `AZURE_STORAGE_CONNECTION_STRING` |
| `PUBLIC_BASE_URL` | the backend's public URL (so `/files/...` links in generated content point at the backend) |
| `REDIS_URL` | optional; empty = background jobs run in-process |

Check `https://<backend-host>/health` returns `"ai_keys_configured": true` before touching Vercel.

## 2. Vercel project

A Vercel account holds any number of projects; each is linked to one Git repository, so adding this one does not touch
the project that already runs from another repository.

1. Vercel dashboard → **Add New… → Project** → **Import** `rajurajeshmheggade/EduAi`. If the repo is not listed, the
   Vercel GitHub app has no access to it: *Adjust GitHub App Permissions* and grant the repo (the repo owner may need to
   approve), or ask the owner to import it.
2. **Root Directory** → `frontend`. Framework is detected as Vite; install (`npm ci`), build
   (`npm run models:proctor && npm run build`) and output (`dist`) come from `frontend/vercel.json`.
3. **Environment Variables**:
   - `VITE_API_BASE_URL` = `https://<backend-host>` (recommended, see mode B below)
   - `VITE_SALES_EMAIL`, `VITE_SALES_PHONE` (optional landing-page banner)
4. In `frontend/vercel.json` replace every `YOUR-BACKEND-HOST` with the backend host, commit, push. Every push to
   `main` redeploys production; other branches get preview URLs.
5. **Deploy**, then open `https://<project>.vercel.app/health` (proxied to the backend) and sign in.

## How the frontend reaches the API

The app calls `/api`, `/ICMELive`, `/files` and `/health` by relative path. Two production modes:

- **A. Same-origin via rewrites** (no env var): Vercel proxies those paths to the backend. Simple and no CORS, but
  Vercel ends a proxied request after **30 seconds** and some synchronous AI calls (lesson-plan and question
  generation, teaching guide, long TTS) can take longer. Live proctoring streams reconnect every 30 s.
- **B. Direct** (`VITE_API_BASE_URL` set at build time): the browser calls the backend origin itself, no time limit.
  Requires `CORS_ORIGINS` on the backend to list the Vercel origin(s). The exam page's Content-Security-Policy
  allows that origin automatically. The rewrites stay as a fallback for `/files/...` links.

Use **B** for production; A is fine for previews or demos.

## Troubleshooting

| Symptom | Cause / fix |
| --- | --- |
| 404 on page refresh / deep link | `frontend/vercel.json` missing (SPA fallback rewrite) or Root Directory not `frontend` |
| `502` with `ROUTER_EXTERNAL_TARGET_ERROR` | `YOUR-BACKEND-HOST` still in `vercel.json`, backend down, or a proxied call exceeded 30 s (switch to mode B) |
| Browser console: CORS error | backend `CORS_ORIGINS` lacks this Vercel URL (preview URLs differ per branch) |
| Mixed-content blocked | the backend must be served over HTTPS |
| Build fails in `models:proctor` | the build container could not reach `storage.googleapis.com`; retry the deployment |
| Login works, AI answers are mock | `PROVIDER_MODE` / keys not set on the **backend** host; Vercel env vars do not reach the backend |
