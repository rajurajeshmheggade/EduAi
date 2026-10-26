# EduAI Platform (ICME Next-Gen)

Phase 1 + 2 of the FRD: foundation (JWT + RBAC, pgvector schema, persistent job state), textbook
vectorization, strict **k=3** RAG chatbot with `[Page X]` citations, and the AI **How-to-Teach** planner.

```
backend/    FastAPI (ICMELive v2) · Celery tasks · providers (mock | azure)
db/         SQL migrations (run in pgAdmin 4 or via scripts.migrate) incl. usp_* functions
frontend/   Vite + React 18 + TS + Tailwind v4 (shadcn-style primitives)
```

## Run locally (no Docker, no Azure needed)

```powershell
# 1) Backend
cd backend
python -m venv .venv ; .venv\Scripts\pip install -r requirements.txt
.venv\Scripts\python -m app.devdb start        # local PostgreSQL 16 + pgvector on :5433 (keep running)
.venv\Scripts\python -m scripts.seed           # migrations + demo org/users
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000

# 2) Frontend
cd ..\frontend ; npm install ; npm run dev     # http://localhost:5173
```

Demo logins (password `Passw0rd!`) — sign in with email **or** user code:

| Role | Login | What they can do |
| --- | --- | --- |
| Platform super-admin | `superadmin` / password `superadmin` (FRD v3 bootstrap — prompts to change) | Same admin console as institution admins, plus onboarding institutions (profile, plan limit, AI modules), extra admins, suspend |
| Institution admin | `admin@demo.edu` | Create teachers & classes, assign class teacher + subject teachers, **weekly timetable** (no teacher double-booking), settings, institution-wide attendance |
| Class teacher | `teacher@demo.edu` (Grade-10-A; also teaches PHY101 in Grade-9-B) | Enrol students **into own class only** (form or CSV), today's schedule → one-click period attendance, homework |
| Class teacher | `kavya@demo.edu` (Grade-9-B) | Same, for Grade-9-B |
| Student | `student@demo.edu` or `REG2026001` | Timetable, homework hand-in, AI classroom, own subject-wise / month-wise attendance |
A sample textbook: `python -m scripts.sample_pdf` -> `.data/sample_physics_textbook.pdf`.

Connect **pgAdmin 4** to `127.0.0.1:5433`, user `postgres` (no password), database `eduai`.

## AI keys

Put your keys in `.env` (repo root, or `backend/.env`) — a template with every key is in `.env.example`:

```ini
PROVIDER_MODE=azure            # or: openai   (mock = offline demo, no keys)
AZURE_OPENAI_ENDPOINT=https://<resource>.openai.azure.com/
AZURE_OPENAI_API_KEY=...
AZURE_OPENAI_CHAT_DEPLOYMENT=gpt-4o
AZURE_OPENAI_EMBEDDING_DEPLOYMENT=text-embedding-3-small
# --- or for OpenAI directly ---
OPENAI_API_KEY=sk-...
```

Restart the API, then check `GET /health` → `"ai_keys_configured": true`. After switching from `mock`, re-upload
(re-index) textbooks so their embeddings come from the real model.

## Tests, assignments & AI evaluation (Teacher → Tests & AI evaluation)

Three assessment types share one SL.No-wise AI grader, dashboards and score register:

| Type | How students take it | Graded |
| --- | --- | --- |
| **Online test** | Timed runner: SL.No palette (answered / unanswered / flagged), MCQ radios, autosave, auto-submit at time-up, one attempt | MCQ exactly; short / descriptive / numerical by embeddings + GPT-4o |
| **Assignment** | Student uploads one PDF (re-upload until reviewed / due); teacher may also upload a folder | SL.No OCR (text layer or GPT-4o vision) + GPT-4o |
| **Offline exam** | Teacher uploads a folder of scripts named after students | Same as assignment |

Online tests and assignments have *opens / due* dates, an optional late window (submissions flagged late) and a results
policy: **instantly** after AI evaluation or **after the teacher publishes**. Create → add questions (MCQ options are
detected from “(a) … (b) …” or entered in the editor) → **Assign to class**. The teacher dashboard shows submitted / in
progress / not submitted (with names) and late counts; the admin register (Admin console → *Assessment scores*) filters
Class → Subject → Type → Test and lists students who have not submitted. Student menu: **Tests**, **Assignments**,
**Exam results**.

1. **New evaluation** — class, subject, *subject level* or *chapter level* (chapter picked from the indexed textbook), title, pass %.
2. **Questions & answers** — upload the question paper (`SL.No 1 … (5 marks)`) and SL.No-wise model answers
   (`Ans 1: … (2M)`) as PDF / DOCX / MD / TXT → review & edit the SL.No table → save (model answers are embedded).
3. **Student scripts** — pick a folder (or PDFs / ZIP) named after students (`Aarav_Sharma.pdf`, `10A01_Aarav Sharma.pdf`,
   admission no.). Files are matched to the class roster; fix any mismatch in the dropdown → **Evaluate**.
4. **Results** — top / below-pass students, questions nobody answered, SL.No-wise averages + common missing points,
   score distribution, register + CSV. Open a student to see OCR text, marks, why, missing points, feedback; adjust marks.
   **Publish** to let students see their reports. Admins: Admin console → *Evaluation scores*.

Typed PDFs are read from their text layer (works offline in `mock` mode with a rule-based grader). Handwritten / scanned
scripts need `PROVIDER_MODE=azure|openai` (GPT-4o vision OCR + the FRD examiner prompt). Try it with
`python -m scripts.sample_evaluation` → files in `.data/sample_evaluation/` (Grade-10-A, PHY101, `teacher@demo.edu`).

## Modes

| Setting | Dev default | Production |
| --- | --- | --- |
| `PROVIDER_MODE` | `mock` (offline, deterministic) | `azure` or `openai` (GPT-4o, text-embedding-3-small, Whisper) |
| `DATABASE_URL` | empty → bundled local Postgres | Azure Database for PostgreSQL 16 + pgvector |
| `REDIS_URL` | empty → in-process worker thread | Azure Cache for Redis; run `celery -A app.workers.celery_app worker -P solo` |
| `STORAGE_MODE` | `local` (signed expiring URLs) | `azure` (Blob + SAS) |

Mock embeddings are lexical (hashed bag-of-words), good for demos/tests; use `azure` for real semantic search.
Switching embedding providers requires re-indexing textbooks.

## Tests

```powershell
cd backend ; .venv\Scripts\python -m pytest        # 98 tests: chunker, RBAC, RAG, guides, admin, attendance, timetable, homework, AI evaluation, tests & assignments
cd frontend ; npm test ; npm run build
```

## API (Phase 1–2)

`POST /api/v1/auth/login|refresh`, `GET /api/v1/auth/me` ·
`/ICMELive/api/v1/curriculum/{upload-textbook, textbooks/{subject}, textbooks/{id}/publish, jobs/{id}, generate-teaching-guide, guides/...}` ·
`POST /ICMELive/api/v1/rag/query` (SSE) · `POST /ICMELive/transcribe-audio` · `POST /api/v1/auth/change-password`.

Admin (`/ICMELive/api/v1/admin`): `organizations` (super-admin) · `overview` · `settings` · `teachers` ·
`organizations/{org}/admins` · `classes`, `classes/{code}/subjects/{subject}` (subject type THEORY/LAB/COACHING_TEST) ·
`timetable` (GET / PUT slot — 409 on teacher or class clash / DELETE) · `students` (read-only) · `attendance/summary?month=YYYY-MM`.

Classroom (`/ICMELive/api/v1/classroom`): `my-classes` · `classes/{code}/students` (+ `/import` CSV; class teacher only) ·
`attendance` (GET roster / POST batch, period-wise `Period-N`) · `attendance/register[.csv]?month=` · `my-attendance?month=` (student) ·
`my-timetable` (teacher / student) · `homework` (POST multipart, GET, DELETE) · `homework/{id}/submissions[/{student}/review]` ·
`my-homework` · `my-homework/{id}/submit` (notes and/or PDF / PNG / JPEG ≤ 10 MB).

Attendance % = (present + late) ÷ (periods − leave); students below the institution threshold (default 75%) are flagged.
Institution plan: `max_students` is enforced on enrolment; `ai_modules` switches the AI chatbot / classroom on or off per tenant.

Interactive docs at `/docs`.

## Not yet built (later phases)
Image answers inside the online test runner, AI-generated test questions from textbook chapters,
avatar voice/viseme lip-sync,
analytics, wellbeing/creativity/mindset reports, .NET 8 CRUD bridge, Azure Key Vault wiring.
Scanned-page vision captioning during textbook indexing is flagged (`scanned_pages`) but not yet implemented.
