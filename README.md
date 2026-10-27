# EduAI Platform 

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

## Lesson Plans & Session Plans (Teacher → Lesson Plans)

Ported from the Rapid / SARAS teacher console — same flows, prompts and content, in EduAI's UI, running on EduAI's
own AI provider (`PROVIDER_MODE`, works offline in `mock`).

* **Lesson Plan Repository** — search, class / subject filters, Completed / Draft, live session count, Edit / Edit
  Draft (reopens the creator where you left off), Preview, Delete.
* **Create → Manual**: the 7-step creator — Basic Setup (class, subject, board, chapter from your indexed textbooks
  or typed, duration, optional PDF / DOCX / TXT that grounds the plan) → Course Outcomes → Expected Learning Outcomes
  (Bloom HOTS counts, skills, competencies, attitudes) → Objective Mapping → Assessment items per ELO → Learning
  Experience (pedagogical approaches, intelligences, 5E design per ELO with resources, ELO merge) → Review & Create.
  Every AI item can be edited, regenerated with extra instructions or deleted; Save as Draft at any step.
* **Create → AI Bot**: a chat assistant collects class, subject, chapter, COs, duration and Bloom counts, then runs the
  same pipeline and saves the plan.
* **Lesson Plan View** — school / teacher header, core objectives, ELOs, assessment, assignments, 5E design model;
  edit any section and Save; Download PDF / Word (.docx).
* **Session Manager** (Session chip) — sessions of a plan: Create Session (title, duration, instructions, the plan's own
  ELOs, resources per Resource Category from the **Resource Library**: your links / files, indexed textbooks, tests,
  questions, homework), AI-generated session plan with **Current Affairs, Video References, Images and Educational
  Documents** fetched live, Preview + Launch (projection player), Download PDF, Delete.

Content agents (per agent the first source that answers wins, results reviewed by the AI for relevance, cached 6 h):
Images SerpAPI → Wikimedia Commons → Openverse · Videos YouTube Data API v3 → SerpAPI · Current affairs SerpAPI
Google News → Wikinews · Documents SerpAPI + `filetype:pdf` (NCERT / DIKSHA). Set `SERPAPI_API_KEY` and
`YOUTUBE_API_KEY` in `.env` (see `.env.example`); a block with no source simply says so.

API: `/ICMELive/api/v1/lessonplan/{scope, chapters, extract-text, course-outcomes, skills-per-co, competencies-per-co,
elos, regenerate-*, pedagogical-approaches, assessment-items, five-e-resource, assignments, save-unit-plan, plans,
assistant/chat}` · `/ICMELive/api/v1/lessonplan/sessions/{elos, list, get, save, delete, generate, resource-library,
resource-content, resources}`. Tables: migration `010_lesson_session_plans.sql`.

## Student Wellness — MindAlign companion (Student → Wellness, Teacher → Wellbeing & Mindset)

The MindAlign stress & mental-wellness companion (github.com/Sk2003pm/H2S-Main-Challenge) integrated into EduAI. No
separate login: the student opens their EduAI account, confirms the first step (name, class, section, subjects and
knowledge level all read from their account; they pick an avatar and, optionally, when their next exams start) and the
app becomes their wellness tracker.

**Pitched at the student, not at an entrance exam.** MindAlign asked users to pick JEE / NEET / UPSC and aimed every
prompt at it. Here there is no exam picker: `backend/app/services/wellness/context.py` builds each student's academic
context server-side on every request — class and section, term, the class's subjects, a **knowledge level** from their
graded EduAI assessments (newest 20, only results the student can already see; Advanced ≥85 % · Proficient ≥70 % ·
Developing ≥50 % · Foundational, or *Not yet assessed*), the subject that needs most support, and upcoming tests and
homework. Journal analysis, Aura, daily tips, the quiz (today's class subject, difficulty set by the student's level in
it), check-ins, fallbacks, guardrail wording and the stress-buster worries all use it; the AI is told not to assume an
entrance exam unless the student mentions one. The countdown targets the next assigned online test or the student's own
exam date, whichever is sooner. Only the first name goes to the AI.

* **Dashboard** — AI focus tip, stress-reliever and affirmation; avg stress, journal logs, mindful cycles; 7-entry mood
  trend; daily mood check-in (+15 XP); Zen Brain quiz on a class subject at the student's level (+25 / +10 XP); learning profile (class, subjects,
  knowledge level per subject, what is due); Focus Mode (countdown to the next test,
  Pomodoro, synthesised ocean waves / 10 Hz binaural beats, +50 XP); evidence-based coping toolkit.
* **Journal** — AI analysis: calm gauge (1-100), emotions, hidden stress triggers, coping checklist (+20 XP each),
  encouragement for upcoming school assessments (+40 XP per entry); history; crisis language surfaces helplines.
* **Aura Chat / Aura Live** — empathetic companion grounded in the student's journal entries and long-term memory, with
  quick worry chips, "discuss this entry", a memory panel; Aura Live adds webcam preview, hands-free speech-to-text
  (browser STT, server Whisper fallback) and spoken replies with captions.
* **Breathing** (Box 4-4-4-4, 4-7-8, voice guide in sync), **Stress Buster** balloon game, **XP & levels**
  (Mindful Rookie → Zen Scholar → Focus Guru → Calm Conqueror → Ascended Sage).
* **Teacher ▸ Wellbeing & Mindset** — per class: onboarding / participation, average stress, trigger distribution, each
  student's mood sparkline, knowledge level, risk (high / watch / ok / inactive), activity, and safety alerts to acknowledge. Teachers
  never see journal or chat text — students are told this on the first screen.

AI mechanisms (same as MindAlign, on EduAI's provider): MindAlign's prompts and JSON contracts, re-aimed at the academic context above; JSON replies validated against Pydantic
schemas; a 45 s time budget per call with MindAlign's local keyword fallbacks (also used in `PROVIDER_MODE=mock`);
**deterministic guardrails before any AI call** — Tier 1 crisis / self-harm (Tele-MANAS 14416, KIRAN 1800-599-0019,
Vandrevala, AASRA, NIMHANS), Tier 2 medication / study-drug boundary, Tier 3 academic catastrophizing reframing, Tier 4
jailbreak / prompt-injection; memory extraction into Aura's long-term memory; journal-grounded chat context.

Security & performance (hardening over the standalone app):

| Concern | Measure |
| --- | --- |
| Identity / IDOR | Student and teacher come from the JWT; MindAlign trusted a client-sent `username` on every route — removed |
| Prompt injection (OWASP LLM01) | Guardrail tier 4; chat history + journal context built **server-side** (browser can't inject "journal" text); student text fenced and declared data in the system directives |
| Output handling (LLM02) | All AI text rendered as text, never HTML; schema validation + length clamps on every structured reply |
| Sensitive data (LLM06) | Journals/chats visible only to the student; teacher endpoints return aggregates + alert metadata; `Cache-Control: no-store` on every wellness response; rows cascade-delete with the student |
| Integrity | XP awarded server-side (fixed amounts, daily caps, row lock); quiz answer checked server-side, `correctIdx` withheld until answered |
| Abuse / cost | Per-user sliding-window rate limits (chat 20/min, journal 10/10 min, tips, quiz, transcription); body limits (journal 5 000, chat 2 000 chars, audio 4 MB, allow-listed audio types) |
| Availability | 45 s AI budget + local fallbacks, guardrails never depend on the AI; tips cached per day/latest journal |
| Frontend performance | Each tab is its own chunk; three.js / Web Audio load only on demand; 3D loops pause when hidden and honour `prefers-reduced-motion` |

API: `/ICMELive/api/v1/wellness/{meta, me, me/profile, me/tips, me/quiz, me/quiz/answer, me/checkin, me/journals,
me/journals/{id}/coping, me/chat, me/memories, me/activity, me/transcribe}` (students) ·
`/ICMELive/api/v1/wellness/{classes, classes/{code}/overview, classes/{code}/students/{student}, alerts/{id}/acknowledge}`
(teachers). Tables: migration `011_wellness.sql`.

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
