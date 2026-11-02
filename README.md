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

On Linux aarch64 (e.g. Jetson) `pgserver` has no wheel and is skipped; run PostgreSQL 16 + pgvector on the same port
instead and the rest of the steps are unchanged:
`docker run -d --name eduai-pg -e POSTGRES_HOST_AUTH_METHOD=trust -p 127.0.0.1:5433:5432 pgvector/pgvector:pg16`.

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

## Digital Library (school catalog + DIKSHA)

Teacher → **Digital Library**, Student → **My Library**, Admin console → **Digital library**.

* **School catalog** — books an admin adds and verifies (source URL, licence, in-app / download permissions, optional
  authorised PDF). Admins can import a CSV and see the publishing log.
* **DIKSHA** — live search of DIKSHA digital textbooks and learning resources for **NCERT, CBSE and Karnataka State
  Board, Classes 5–12**: board / class / subject / language / content-type filters come from DIKSHA's own facets.
  Teachers open a textbook's chapter tree, preview resources and publish a whole textbook or individual resources to a
  class subject. Students see them under *From DIKSHA*, browse the chapters and read / watch with the method each
  resource's licence allows (PDF view, video, audio, YouTube player) or open them on DIKSHA.
* Content stays on DIKSHA: the LMS stores metadata references for published items only and never copies or proxies
  files. Licences are checked per resource (NonCommercial items open on DIKSHA unless `DIKSHA_EMBED_NONCOMMERCIAL=true`).
* Docs: [`docs/DIKSHA_API_DISCOVERY.md`](docs/DIKSHA_API_DISCOVERY.md) (verified endpoints),
  [`docs/DIKSHA_CONTENT_ACCESS_MATRIX.md`](docs/DIKSHA_CONTENT_ACCESS_MATRIX.md),
  [`docs/DIKSHA_LICENSE_AND_ATTRIBUTION.md`](docs/DIKSHA_LICENSE_AND_ATTRIBUTION.md).

| Setting | Default | Meaning |
| --- | --- | --- |
| `DIKSHA_ENABLED` | `true` | Turn the DIKSHA source on/off |
| `DIKSHA_API_BASE_URL` | `https://diksha.gov.in` | Verified public API host (no key needed) |
| `DIKSHA_API_TIMEOUT_SECONDS` | `15` | Per-request timeout |
| `DIKSHA_REQUEST_RATE_LIMIT` | `5` | Outbound requests per second per API process |
| `LIBRARY_CACHE_TTL_SECONDS` | `900` | Cache for search / read / hierarchy responses |
| `LIBRARY_METADATA_REFRESH_HOURS` | `24` | Age after which `POST /library/diksha/refresh` re-reads published items |
| `DIKSHA_BOARDS` | `NCERT,CBSE,State (Karnataka)` | Boards offered (DIKSHA `se_boards` names) |
| `DIKSHA_ASSET_HOSTS` | `obj.diksha.gov.in,files.odev.oci.diksha.gov.in` | Hosts the in-app viewer may load DIKSHA files from |
| `DIKSHA_EMBED_NONCOMMERCIAL` | `false` | Allow in-app display of CC *NC* content (decide after legal review) |

Set a class's **Grade** (Classes & subjects) so publishing checks that a book or resource is for that class.

## Virtual Labs (Teacher / Student → Virtual Labs)

DIKSHA's [Virtual Labs](https://diksha.gov.in/virtuallabs.html) for **Classes 6–12** (NCERT with Amrita Vishwa
Vidyapeetham and C-DAC "OLabs"): 58 lab manuals / activity books in English and Hindi medium, ~1,400 experiments, ~775
with an HTML5 simulation. The 58 entry points are catalogued in `backend/app/services/virtual_labs/catalog.py`; the
experiments inside are read live from DIKSHA's hierarchy API (cached), one top-level unit = one experiment.

* **Teacher** — pick class, medium and subject, search the experiments, preview the simulation, theory, procedure,
  animation and lab manual, then **Assign to class**: due date (late work on/off), optional opening time, minimum time
  in the lab, and a lab worksheet the AI drafts (aim, apparatus, procedure checklist, observation table with units,
  4 viva MCQs + 2 short answers, conclusion prompt) and the teacher edits. *Assigned* shows each class's progress; the
  student list shows time in the lab, simulation launches, MCQ score and the AI-suggested marks; the teacher sets the
  final marks and feedback or **returns the lab for redo**, and can extend, close / reopen or delete it.
* **Student** — *Virtual Labs* lists the class's labs (to do / submitted / marked). The workspace shows the simulation
  beside the worksheet: aim → procedure checklist → observation table → viva → conclusion, with autosave, a time-in-lab
  clock and an **AI lab assistant** that gives hints but never the worksheet answers. On submit MCQs are marked at
  once and the AI gives feedback on short answers and the lab record; answers and explanations are shown afterwards.
* **Time in the lab** counts while the workspace is visible and the student is active (including working inside the
  simulation frame) or, after opening the lab on DIKSHA, while they are away on it (max 20 min per launch). Every
  report is capped by the server clock, so it cannot run ahead of real time.
* **Licences** — simulations run unmodified from DIKSHA's host (`obj.diksha.gov.in`) in a sandboxed frame only when the
  licence allows in-app display. Almost all virtual-lab content is **CC BY-NC-SA / BY-NC-ND**, so with the default
  `DIKSHA_EMBED_NONCOMMERCIAL=false` it opens in DIKSHA's player in a new tab (launch and time are still tracked);
  set it to `true` after your institution's licence review to run labs inside EduAI. H5P self-checks always open on
  DIKSHA. Source, licence and attribution are shown with every resource.
* **AI** uses the tutor model (`AI_TUTOR_PROVIDER`, else `PROVIDER_MODE`) and sees only DIKSHA's metadata (titles,
  descriptions, keywords), never the licensed files. Without an AI provider the worksheet is a plain template, the
  assistant gives general guidance and the teacher marks short answers / the record.

Migration `017_virtual_labs.sql` (assignments + attempts).

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

## AI avatar tutor (Student → AI Classroom)

The subject teacher's avatar explains the open textbook page aloud, like a teacher in class, with lip-sync.

* **Teacher explains** (default): the page text goes to the tutor LLM, which returns an NCERT-style lesson. It has an
  introduction, every key point explained in classroom language, important words, a recap and a check question. The
  avatar speaks it, and the PDF highlights the exact words of the point being explained. **Word for word** reads the
  page itself. Running headers, page numbers and footers are skipped.
* **Avatar & voice follow the teacher**: male avatar and voice when the subject teacher's gender is *Male*,
  otherwise female. Admins set gender in Admin console → Teachers; it is never guessed from a name. The female avatar is
  the 3D Ready Player Me model `frontend/public/avatars/teacher-female.glb`. A gender without a model (see
  `src/lib/avatars.ts`) uses the 2D avatar.
* **Lip-sync**: [wawa-lipsync](https://github.com/wass08/wawa-lipsync) analyses the voice in the browser every frame.
  The resulting Oculus viseme drives the model's `viseme_*` morph targets, blended and scaled by loudness. The face
  also blinks, smiles a little and moves its head and eyes (off under *reduce motion*).
* **Voice**: Kokoro neural voice, offline on the server CPU, with no cloud cost. Pronunciation is cleaned up first:
  "e.g." → "for example", "1789" → "seventeen eighty-nine", units, per cent. The first sentence of a page is voiced on
  its own, so speech starts quickly. The server then voices the rest of the page and prepares the next page in the
  background. Explanations and audio are cached, so each page is explained and voiced once for everybody.
* Only textbook page text is sent to the AI and the voice, never student data. The feature uses the per-institution
  AI module *AI avatar tutor*.

```powershell
cd backend ; .venv\Scripts\python -m scripts.download_voice    # Kokoro model + voices (~350 MB) into .data/models/kokoro
```

| Setting | Default | Meaning |
| --- | --- | --- |
| `AI_TUTOR_PROVIDER` | empty (= `PROVIDER_MODE`) | `azure` / `openai`: the AI explains pages while the rest of the app stays on `PROVIDER_MODE`. `mock` builds an offline extractive lesson. |
| `TTS_MODE` | `auto` | `auto` uses Kokoro if downloaded, else provider TTS (`PROVIDER_MODE` azure/openai), else the OS voice (Windows SAPI / espeak-ng). `kokoro` / `provider` / `offline` force one. |
| `KOKORO_VOICE_FEMALE` / `KOKORO_VOICE_MALE` | `af_heart` / `am_michael` | Kokoro voices (`bf_emma`, `bm_george` … for British English) |
| `KOKORO_LANG` / `KOKORO_SPEED` | `en-us` / `0.95` | Pronunciation (`en-us` or `en-gb`) and pace |
| `READ_ALOUD_PREWARM` | `true` | Voice the rest of the page and the next page in the background |

Licences: the Kokoro-82M weights and voices are Apache-2.0, and kokoro-onnx and wawa-lipsync are MIT. Kokoro's
phonemizer / espeak-ng are GPL-3.0; that is fine for a hosted service, but review it before shipping on-premise
copies. The avatar is a Ready Player Me model.

API (`/ICMELive/api/v1/read-aloud/textbooks/{id}`): `voice` · `pages/{n}?mode=explain|read` · `pages/{n}/segments/{i}/audio?mode=`.
Migration `016_read_aloud_avatar.sql` (teacher gender).

## Admission tests with AI proctoring (Teacher → Assessments → Admissions)

A teacher builds an admission test from the questions of their **own Assignments and Online tests** (copied as
snapshots), adds an **HQ (Human Quotient)** section, publishes it, and **launches** it for a candidate on a device where
the teacher is signed in. The browser goes full screen into a locked exam view (no portal chrome); the teacher's portal
session on that device is closed, and the portal comes back only after the teacher signs in again. On-device AI watches
camera, microphone level and the shared screen; every breach is a **flag** (live warning to the candidate, live alert on
the teacher's monitor, evidence snapshot) feeding a **server-computed integrity score**. On submit a background job
scores the answers, builds the HQ profile and composes a printable **report** (Print / Save as PDF, A4).

```powershell
cd frontend ; npm run models:proctor          # once: self-hosts the proctoring models (~26 MB) in public/models/proctor
cd backend  ; .venv\Scripts\python -m scripts.migrate ; .venv\Scripts\python -m scripts.seed_admission_test   # demo Assignment
```

* **Teacher:** *Tests* (sections, import from Assignments / Online tests with key + rubric preview, HQ item bank — 68
  age-banded SJT / reflective / ideas items, AI drafts that must be approved, editor for every type, proctoring preset
  strict / standard / lenient with per-rule switches, scoring weights and cut-offs, publish) · *Candidates* (form or CSV
  with a validation preview; delete-all-data) · *Launch* (browser gate, device pre-check, model preload, guardian consent
  for under-18s) · *Live monitor* (open it on another device: progress, time left, live status chips, integrity,
  warnings, latest flags, alerts, End session) · *Results* (composite, band, academic, HQ, integrity, CSV export, open /
  regenerate report). Org admins: Admin console → **Admission tests** (read-only + candidate data deletion).
* **Candidate (exam view):** confirm name + date of birth (3 tries, then locked) → privacy notice + consent → system
  check (secure page, single screen, camera, virtual-camera check, microphone noise floor, models, one centred face,
  network, entire-screen share, full screen) → ID photo (sharpest of 3; the face template stays in memory only) → start.
  Shuffled questions without keys, autosave (offline queue in IndexedDB), server-set deadline, mark for review, proctor
  HUD, warnings (n / max), pause overlay (full screen, camera, screen share, second monitor — the timer keeps running),
  supervisor end (teacher password), hand-back screen with teacher sign-in.
* **Proctoring:** browser events (full screen, visibility, focus, copy / paste, blocked shortcuts, right-click, print,
  resize, devtools heuristic, page injection, offline, second monitor, portal opened in another tab, second exam tab) and
  a Web Worker running MediaPipe FaceLandmarker (faces, head pose — no expressions), MediaPipe EfficientDet-Lite0 (phone,
  book, laptop / TV, person) and a face-api descriptor (match against the ID photo); mic speech-band level only. Rules
  (durations, 2-of-3 confirmation, 2 s merging, 60 s calibration) are in `frontend/src/lib/proctor/rules.ts`; severity,
  points, caps, warnings, integrity and auto-submit are decided by the server
  (`backend/app/services/admission_test/{config,integrity}.py`), which also raises HEARTBEAT_MISSING and TIME_ANOMALY.
* **AI** (`ADMISSION_AI_PROVIDER`, else `PROVIDER_MODE`): grades short / descriptive answers against the imported
  rubric (`key_rubric_points` → criterion + marks), scores HQ written evidence, writes the integrity summary and the
  report narrative, drafts items. Every step validates JSON, has a 45 s budget and one retry, and falls back to a
  deterministic result marked `fallback`; the AI never changes a number. `PROVIDER_MODE=mock` runs it all offline.
* **Security:** the exam token (32 random bytes, SHA-256 at rest, 4 h, bound to the device and one page at a time) works
  only on `/admission/session/*`; teacher JWTs do not. No key, rubric or model answer reaches the exam view (tested).
  Evidence is JPEG ≤ 200 KB, re-encoded (EXIF stripped), served by 5-minute signed links; launches, supervisor ends,
  report views and evidence access are audited (`admission_test_audit`). The exam route adds its own CSP
  (`script-src 'self' 'wasm-unsafe-eval'`, no frames) and `no-referrer`; set `Permissions-Policy: camera=(self),
  microphone=(self), display-capture=(self)` on the web server in production.
* **Privacy:** notice + explicit consent before any capture; guardian consent recorded by the teacher for under-18s
  (in person / signed form; OTP needs a sender that is not configured); no video or audio recording, no emotion
  analysis, the face template is never stored. Run `python -m scripts.admission_test_retention` daily: evidence, ID
  photos and raw event details older than 90 days are deleted, aggregates stay.
* **Browser:** desktop Chrome or Edge (screen-count detection, keyboard lock and entire-screen sharing are Chromium
  features). For labs, kiosk mode (`--kiosk`) adds OS-level lockdown; the web app works without it.
* **Limits (also printed in every report):** browser proctoring is best-effort — it cannot see a second device outside
  the camera's view, cannot reliably detect virtual cameras / injected video or block OS shortcuts (switching apps is
  still detected), and heuristics can misfire. The voice rule measures speech-band loudness only, so steady sounds
  (e.g. a beeping device) can trigger it — switch it off per test if needed. Flags are indicators, not proof.
* **Calibrate before go-live:** `face_match_threshold` (Euclidean distance of face-api descriptors, default 0.6) and
  the voice margin (`voice_db`, 15 dB) on a small labelled set; see `config.py` for all tunables.

Migration `018_admission_proctoring.sql` (tests, questions, HQ bank, candidates, sessions, answers, append-only proctor
events, reports, audit). API under `/ICMELive/api/v1/admission`: `tests`, `question-bank`, `hq-bank`, `candidates`,
`launches`, `sessions/{id}/end`, `live`, `results(.csv)`, `reports/{id}` (+ `/regenerate`, `/evidence/{event}`) and the
exam-token routes `session/*`.

## Student proctoring — Online tests, Virtual Labs, AI Classroom (Teacher → Live proctoring)

One proctoring flow for the three student modules. **Flags only** (product decision): detection runs on the student's
device (the admission test's MediaPipe worker, `npm run models:proctor` once); no video, photo, snapshot or audio ever
leaves it. An event is a code, timing, a server-decided severity and a few small numbers (e.g. `faces: 2`).

* **What "Start" means:** *Online test* — Start test (the timer starts only after the preparation window); *Virtual
  lab* — Start / resume the lab (opening the simulation on DIKSHA's player in a new tab is allowed and logged as
  *SANCTIONED_AWAY*, max 20 min); *AI Classroom* — Start classroom session on a chapter (`nlp/<class>/<subject>/<chapter>`)
  or on the textbook classroom (`textbook/<subject>`); leaving the reader closes it.
* **Student:** Start opens a full-screen preparation window: every rule + what is / is never recorded → the exact
  acknowledgement *"I have read and understood all examination rules and instructions."* → camera / microphone
  permission (only what the module requires), camera and microphone pickers (`enumerateDevices`, `devicechange`), live
  preview (never sent), mic level, connection status, on-device face + lighting check, help for blocked permissions.
  Begin stays disabled until every mandatory check passes (the server re-checks on `/start`) and enters full screen
  when required. During the exam a small panel shows status, the flags recorded so far and a hide-preview switch;
  teacher warnings must be acknowledged; leaving full screen or losing the camera is prompted. A reload or leaving
  the page *interrupts* the session; coming back resumes it after a new acknowledgement.
* **Detected (thresholds per module):** face not visible, more than one person, phone / other screen, looking away
  (off by default), camera covered / dark, camera or microphone disconnected or permission removed, tab switch,
  focus moved to another app, full-screen exit, copy / paste, sustained talking (loudness only), connection drops;
  the server raises *HEARTBEAT_MISSING* (session interrupted) and *SESSION_LEFT*. Long or repeated episodes escalate
  one severity level (`services/proctoring/config.py`).
* **Assigned teachers** (notified, may monitor and act): online test — the teacher who created it + the class's
  subject teacher; virtual lab — the assigning teacher + the subject teacher; AI Classroom — the class's teacher for
  that subject, else the class teacher. Other teachers and students get 404.
* **Teacher → Live proctoring:** ongoing exams with live totals (enrolled, writing, yet to start / in pre-check,
  submitted, interrupted, with active alerts, camera issues, suspicious-activity signals); per exam a student grid,
  the alert feed and each student's record (timeline, device status, Dismiss / Noted / Concern review, private
  remarks, warnings the student sees within ~10 s, End session — hands in what was saved). Updates arrive over
  Server-Sent Events (in-process hub; set `REDIS_URL` to fan out across API processes), with 10 s polling while the
  stream reconnects. The bell gets "student started" (not for AI Classroom) and alerts from `notify_min_severity`
  (default High; Critical for AI Classroom), with all required fields in the text and a structured `payload`.
  Indicators are worded as signals for review, never as proof.
* **Admin console → Proctoring:** per-module switches and thresholds (enable, camera / microphone / full screen
  required, detectors, hold times, escalation, interruption timeout, notifications, teacher may end, retention),
  with a change history. Teachers see them read-only.
* **Audit & privacy:** events and staff actions (remarks, warnings with delivered / acknowledged times, reviews, ends,
  record views) are append-only (database trigger). Students can read every flag stored about them. Run
  `python -m scripts.proctoring_retention` daily: finished sessions older than `retention_days` (default 180) are
  deleted with their flags. The old count-only `proctor_flag_count` columns (migrations 023 / 024) are still kept up
  to date; per-flag detail is now stored, which supersedes their "count only" note.

Migration `026_student_proctoring.sql` (settings, sessions, events, actions, notification severity + payload). API
under `/ICMELive/api/v1/proctoring`: `student/config`, `student/sessions` (+ `/{id}`, `/start`, `/events`,
`/heartbeat`, `/warnings/{action}/ack`, `/finish`), `teacher/exams`, `teacher/exam`, `teacher/sessions/{id}`
(+ `/remarks`, `/warnings`, `/end`), `teacher/events/{id}/review`, `teacher/stream` (SSE), `settings` (+ `/{module}`).

## Admissions — Pravesh (Milestone 1: foundation)

Admin console → **Admissions home / Admissions team / Privacy & consent**, counsellor home `/admissions/counsellor`,
reviewer home `/admissions/reviewer`, parent portal `/parent` (English, Hindi, Kannada, Tamil). `Ctrl/⌘-K` opens the
command palette everywhere.

* **Tenant isolation in the database** — schema `admission`, row-level security forced on every table; admissions
  queries run over the non-superuser login role `admission_login` → `SET LOCAL ROLE admission_app` with the school set
  per transaction. Parents see only their own family.
* **DPDP core** — versioned parental consent notices (per school and language, tick-box confirmation, stored with
  version, language, time, IP), withdrawal, access / correction / erasure / grievance requests due in 30 days,
  per-school retention timers (`python -m scripts.admission_retention`), breach log with the 72-hour Board deadline,
  append-only audit log without personal data.
* Demo logins (password `Passw0rd!`): `counsellor@demo.edu`, `reviewer@demo.edu`, `parent@demo.edu` (Hindi),
  `principal@svm.edu` / `parent@svm.edu` (ICSE school, Tamil), `principal@kps.edu` / `parent@kps.edu` (State board,
  Kannada); `admin@demo.edu` is the Demo school's principal.
* Production: `ALTER ROLE admission_login PASSWORD '…'` and set `ADMISSION_DATABASE_URL` (empty = local trust auth only).

Details, screens, decisions and risks: [`docs/PRAVESH_M1.md`](docs/PRAVESH_M1.md). Migration `015_admission_foundation.sql`.

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
cd backend ; .venv\Scripts\python -m pytest        # 252 tests incl. lesson plans, digital library + DIKSHA, virtual labs, admission tests + proctoring, admissions RLS, wellness
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

Library (`/ICMELive/api/v1/library`): `meta` · `subjects` · `books` (+ admin create / PATCH / DELETE / `import` CSV /
`{id}/file` / `{id}/check-link`) · `books/{id}/access` · `targets` · `publications` (publish, admin log) ·
`publications/mine` · `publications/{id}/unpublish` · `student/books` (school books + published DIKSHA items).

DIKSHA (`/ICMELive/api/v1/library/diksha`): `meta` · `filters` · `search` · `items/{id}` · `textbooks/{id}` (chapter tree) ·
`resources/{id}?within=` (permitted viewer) · `publications` (teacher) · `refresh` (admin).

Virtual Labs (`/ICMELive/api/v1/virtual-labs`): `catalog` · `collections/{id}` · `collections/{id}/labs/{lab}` (+ `/worksheet`
AI draft) · `assignments` (teacher: POST / GET / PATCH / DELETE, `{id}/attempts/{student}[/review]`) · `my` (student) ·
`my/{id}` · `my/{id}/{start, activity, work, submit, ask}`.

Admissions (`/ICMELive/api/v1/admission`): `overview` · `applicants` · `team` · `consent-templates` · `consent-versions` ·
`retention` · `data-requests` · `breaches` · `audit` · `parent/{home, consent, consents, requests, language}`.

Interactive docs at `/docs`.

## Not yet built (later phases)
Image answers inside the online test runner, analytics, creativity reports, .NET 8 CRUD bridge, Azure Key Vault wiring.
Scanned-page vision captioning during textbook indexing is flagged (`scanned_pages`) but not yet implemented.
