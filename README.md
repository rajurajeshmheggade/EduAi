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

## AI Question Generator (Teacher → Assessments → AI Question Generator / Question Bank)

Teachers generate exam questions **only from the NLP learning content they select**, edit them into a question paper,
keep them in a question bank, publish the paper and download it.

* **Generate** — cascading dropdowns *Class → Subject → Chapter → Topic → NLP learning content*. Class and subject are
  the teacher's own class subjects; chapters, topics and content come from the content repository. **Preview content**
  shows the exact cleaned text the questions will be grounded on. A blueprint mixes any of the 17 question types, each
  row with number of questions, difficulty (Easy / Medium / Hard), Bloom's level, marks per question (blank = automatic)
  and the type's own inputs (options per MCQ, statements per True/False, pairs, blanks, word bank, sub-questions,
  numbering, word limit, tolerance …); plus language (English, Hindi, Kannada, Tamil) and additional instructions.
  The drafts are reviewed (edit / discard / show answers) and added to a new or a draft paper, or saved to the bank.
* **Question paper editor** — questions by section, numbered continuously; drag-and-drop or keyboard reorder (arrow
  buttons, Alt + ↑ / ↓ on the handle), edit, duplicate, delete, move between sections, add manually / generate more /
  add from the bank. Type-specific editors for every type (options and correct answers, statements, blanks with
  alternates and case sensitivity, pairs, codes, marking points, rubric, sub-questions, …), rich text (bold, italic,
  underline, sub/superscript, lists) with **KaTeX equations**, images / diagrams (PNG or JPEG ≤ 2 MB). Paper settings:
  institution name and logo (defaults to the school's name), exam title, academic year, date, time, general
  instructions, marks and name / roll-number lines, sections. **Preview** shows the paper and the answer key.
* **Save as draft** (optimistic concurrency: a paper changed in another window is never overwritten) · **Save to
  question bank** · **Publish** (final: the API and a database trigger refuse changes; **New version** makes an editable
  copy) · **PDF / Word / Print** of the paper and, separately, of the **answer key** (answers, explanations, key
  points / marking scheme and marks per question) · **Create online test / assignment** from a published paper.
* **Question bank** — the teacher's own questions plus those shared with the school; search by text (question and
  answer), type, difficulty, Bloom's level and subject; reuse in a paper; delete own questions. Duplicates are skipped
  on save: same normalised text, or an embedding ≥ 0.95 cosine-similar to a bank question of the same type and subject.

| Question types (all enabled) | Online test / assignment item when a published paper is converted |
| --- | --- |
| Multiple Choice (2–8 options, list / 2 / 4 columns), Assertion–Reason (codes A–D, configurable per school; consecutive A/R questions share one directions block), True/False with one statement | MCQ — graded exactly |
| Numerical (value, unit, tolerance, worked solution) | NUMERICAL |
| Multiple Response (≥ 2 correct, partial credit max(0, (right − wrong) ÷ correct) × marks), Fill in the blanks (`[answer]` in the text, alternates, case sensitivity, word bank), Match the following (Column II shuffled), One-word, Arrange in order, Short answer, True/False with several statements | SHORT_ANSWER, answer key as model answer |
| Long answer (marking points), Descriptive / Essay (rubric, word limit), HOTS (Analyse / Evaluate / Create only), Diagram-based (uploaded image or a described diagram) | DESCRIPTIVE with the points as rubric |
| Case-based, Scenario-based, Passage-based (sub-questions of mixed types, (a)/(b) or (i)/(ii)) | one item per sub-question (`5a`, `5b` …) |

**Content repository** (`backend/nlp/<Class>/<Subject>/<Chapter>/<Chapter>.txt`, Classes III–XII and JEE, whose chapters
sit one level deeper, `JEE/Physics/mechanics/<chapter>/`). The text is cleaned deterministically (page markers,
the PDF's duplicated text layer and repeated headings removed). **Topics** come from the chapter's numbered section
headings ("11.1 Electric current and circuit", about a third of the chapters), else from the school's own syllabus
topics (Admin → Classes & subjects → syllabus) for a matching chapter, else from labelled sections of the text.
**Learning content** = ~250-word segments of the topic with stable ids. The structure is computed lazily, cached per
file (path, modification time, size) and the catalogue is re-read when folders change.

**Class / subject mapping** — the class's grade (`classes.grade_number`, else read from its name or code: "Grade 10 —
Section A" → 10) ↔ the Roman-numeral folder (X); the subject name / code is normalised and matched against the class's
subject folders, then an alias table (Physics, Chemistry, Biology → Science / General Science up to Class X; Maths →
Mathematics; SST → Social Science; EVS → Environmental Science; Accounts → Accountancy …). When a single-discipline
subject maps onto a combined Science book, its own chapters are listed first (Class X Physics: Electricity, Light,
Magnetic effects, Human eye). Admin console → **Question generator** corrects or sets a mapping per class subject and
edits the Assertion–Reason instruction and codes.

**AI** (`PROVIDER_MODE`): one call per blueprint row with only the selected segments as context (labelled, declared
data), 60 s budget per call / 170 s per generation, one retry on invalid JSON, every item converted to the typed schema
and validated, rejected unless ≥ 45 % of its subject terms occur in the selected content (English papers) or if it
duplicates a question already on the paper or in the batch (normalised text, Jaccard ≥ 0.8). Marks are always set by
the server (the row's marks, else per-type defaults: per statement / pair / blank for True-False, Match and Fill in the
blanks, +1 for Hard subjective). Whatever the AI does not deliver is written by a **deterministic offline generator**
from the selected sentences (blanked key terms, facts altered with another term of the same content for false
statements, quoted sentences as model answers) — the whole path in `PROVIDER_MODE=mock`; it writes in the content's
language (English). Generation is limited to 12 runs per 10 minutes per teacher.

**Exports** — PDF is rendered on the server with MuPDF's HTML engine (PyMuPDF, already a dependency), which shapes
Devanagari, Kannada and Tamil with HarfBuzz (reportlab cannot shape Indic scripts); fonts are bundled
(`backend/app/assets/fonts`, Noto Serif + Noto Serif Devanagari / Kannada / Tamil, SIL OFL) and subset, so output is
the same on Windows and Linux: A4, logo, institution, exam title, class / subject / year / time / maximum marks / date,
name and roll number, general instructions, sections, numbering, "Page n of N" (in the paper's language), images;
equations print from their LaTeX as text with super/subscripts and symbols. Word (.docx) is built in the browser with
the same layout and real Word equations (Indic text uses Word's shaping with Nirmala UI). Print opens a print-ready page.

Demo: `teacher@demo.edu` (Grade 10-A Physics → X / General Science, Mathematics → X / Mathematics; Grade 9-B Physics →
IX / Science) and `kavya@demo.edu` (Grade 9-B English → IX / English). `python -m scripts.seed` also seeds syllabus
chapters + topics from the repository for these class subjects and adds Grade-8-C Science (Class VIII) and Grade-12-A
Chemistry (Class XII) for `teacher@demo.edu`. The AI module `question_generator` is on for every institution.

API (`/ICMELive/api/v1/qgen`): `meta` · `catalog/{classes, chapters, topics, content, preview}` · `generate` · `validate` ·
`papers` (GET / POST) · `papers/{id}` (GET / PUT / DELETE) · `papers/{id}/{items, items/{item}, items/{item}/duplicate,
reorder, items/from-bank, publish, new-version, assessment, bank, export.pdf?answer_key=}` · `bank` (GET / POST) ·
`bank/{id}` · `media` · `media/{id}` · admin `admin/{mappings, mappings/{class}/{subject}, settings}`. Migration
`025_question_generator.sql` (subject mapping, settings, media, papers + items + publish trigger, question bank).

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
* **Breathing** (Box 4-4-4-4, 4-7-8, voice guide in sync), **XP & levels**
  (Mindful Rookie → Zen Scholar → Focus Guru → Calm Conqueror → Ascended Sage).
* **Game Zone** (`?tab=games`; old `?tab=stress-buster` links open the balloon game) — a picker of 1–5 minute brain
  breaks, each tagged with what it trains (calm / focus / memory / recall): the **Stress Buster** balloon game plus
  **Concept Pairs** (match terms from the student's own subjects with their meanings), **Breath Bloom** (hold to breathe
  in, let go to breathe out, grow a flower), **Number Sprint** (60 s mental maths pitched at their maths knowledge level,
  adapting ±1 level), **Word Forge** (unscramble subject words from their meanings), **Lantern Trail** (watch-and-repeat
  sequences with shapes and pentatonic notes), **Sort Studio** (drag items into groups — states of matter, primes, parts
  of speech, …), **Steady Signal** (respond only to the target shape) and **Sand Mandala** (symmetric sand drawing, no
  fail state). Subject vocabulary and sorting sets are built in (`components/wellness/games/vocab.ts`, `sort/logic.ts`;
  no AI call). Every game works with mouse, touch and keyboard, pauses when the browser tab is hidden, has optional
  synthesised sound with a remembered mute, honours `prefers-reduced-motion`, and is its own lazily-loaded chunk.
  Finishing a round reports `game_complete` (+25 XP, 12 a day; the server only accepts a known game id); personal
  bests are kept per student in the browser.
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
  its own, so speech starts quickly. Explanations and audio are cached, so each page is explained and voiced once for
  everybody.
* **Page pipeline** (`services/page_pipeline.py`): while page N is shown or explained, a shared pool of background
  workers prepares, in this order, page N's script and first part, page N+1's script and first part, the rest of
  page N's audio, then N+2. Each page's lesson is written after the previous page's, which it picks up from (title +
  recap). Identical work is done once however many students ask (single-flight). When a student jumps elsewhere,
  queued work for the pages they left is cancelled. Failed steps are retried with backoff. If the AI fails, the
  offline lesson is cached and marked, then replaced once the AI answers again. Cache keys carry the textbook's
  content checksum and the prompt version, so changed content is explained afresh. The reader fetches the open page
  and the next one as soon as the page is open, even before Explain is pressed. It cancels requests when the student
  jumps, pre-renders the next PDF page and shows how ready the open and next pages are.
* **Entering the classroom**: a loader prepares the teacher's voice, the 3D model (downloaded with a real progress
  bar) and the first page before the classroom appears. If the 3D model fails or takes too long, the 2D avatar is
  used, and students can open the classroom early.
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
| `READ_ALOUD_PREWARM` | `true` | Run the background page pipeline (off: pages are prepared only when asked for) |
| `READ_ALOUD_LOOKAHEAD_PAGES` | `2` | Pages after the open one that each student's pipeline prepares |
| `READ_ALOUD_WORKERS` | `3` | Background worker threads shared by all students |
| `READ_ALOUD_RETRIES` / `READ_ALOUD_RETRY_BACKOFF` | `1` / `0.5` | Extra attempts for a failed AI lesson or background step; seconds before the first retry (doubles) |
| `READ_ALOUD_FALLBACK_RETRY_SECONDS` | `300` | A cached offline-fallback lesson is re-tried with the AI after this |
| `AVATAR_TEACHER_CACHE_SECONDS` | `60` | Which teacher's avatar / voice a student gets is cached this long (admin edits to teachers clear it) |

Licences: the Kokoro-82M weights and voices are Apache-2.0, and kokoro-onnx and wawa-lipsync are MIT. Kokoro's
phonemizer / espeak-ng are GPL-3.0; that is fine for a hosted service, but review it before shipping on-premise
copies. The avatar is a Ready Player Me model.

API (`/ICMELive/api/v1/read-aloud/textbooks/{id}`): `voice` · `pages/{n}?mode=explain|read[&prefetch=true]` ·
`pages/{n}/segments/{i}/audio?mode=&v=` (`v` = script version; 409 if it was replaced) · `pages/{n}/status` (ready /
preparing / queued / failed / idle for page n and the lookahead, no AI call) · `POST pages/{n}/prepare` (the student
opened page n: aim their pipeline there). The chapter-library reader's page explanations are cached on the server
by page text too. Migrations `016_read_aloud_avatar.sql` (teacher gender), `027_textbook_content_version.sql`
(textbook checksum).

## Loading experience (all portals)

Pages load inside the shell, so the sidebar stays put. While a page's code downloads, a skeleton shaped like the
page is shown, and a slim progress bar runs under the header until the page's first data has arrived. Every route
is loaded with `lib/lazyWithRetry`: a failed download is retried with backoff and a timeout. A stale chunk after a
deploy reloads the page once. Otherwise "Try again" on the error boundary really downloads the page again. Module
pages use the shared kit (`components/ui/loading.tsx`, `lib/useAsync.ts`): shaped skeletons, `PageLoader` with a
"taking longer than usual" note, and `ErrorState` with retry. Requests time out after 30 s instead of spinning.

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

## Admission forms & the standalone admission application (Teacher → Admission forms)

A teacher (or an admin / counsellor) builds the admission form — student information, parent / guardian, academic
details, custom sections, document uploads, admission instructions and a declaration — previews it live, edits it, and
**publishes** it as a standalone application at `/apply/<slug>`. Admin console → **Admission forms** shows every form
of the school plus the school's branding (display name, logo, accent colour); counsellors get **Applications**.

* **One-time credentials.** Publishing issues the first credential; *Issue a new applicant credential* adds one per
  applicant. The pop-up shows application name, URL, username and temporary password with *Copy Username / Copy
  Password / Copy All*; *Acknowledge* records who, when, from which IP and what was copied, then shows "Admission
  application credentials have been copied successfully. Please save these credentials securely." The password exists
  only in that response (bcrypt hash at rest, never logged). A credential stays valid while the applicant fills in (sign
  out / back in), expires after the configured days or at the closing date, and is **removed** on final submission —
  hash wiped, status *submitted*, every applicant session ended. Credentials list: issued / in use / submitted · removed
  / revoked / expired, with *Revoke* and *Reissue* (the recovery path: the old one stops, saved answers stay).
* **Applicant app** (own header with logo, navigation, footer, own API client and token storage — no LMS shell):
  sign in, *Forgot password?* (username + contact → a recovery request the teacher resolves by reissuing), dashboard,
  multi-step form with autosave, uploads, review with the school's consent notice and the declaration, submit,
  confirmation with the **application reference number**, and public *Track application* (reference + date of birth →
  status only, rate limited). Mobile first; labelled controls, error summaries, focus moved per step.
* **Linked admission test (optional).** After submitting, the applicant takes the teacher's published proctored test
  from the app (device checks, guardian consent for minors, then the existing exam view); the credential is removed when
  the test is submitted and the exam returns to the app's confirmation. The teacher sees it on the live monitor and the
  result with the application. The teacher-launched flow is unchanged.
* **Review.** Queue by form / status, application detail (answers, documents as 5-minute signed, audited downloads with
  `Content-Disposition` or one zip, test result, history, staff-only comments), *Start review / Approve / Reject /
  Request corrections* — a corrections request reopens the application with a fresh one-time credential (pop-up again)
  and a note shown to the applicant; resubmitting removes it again. Submissions notify the form owner and are copied
  into the admissions records (Admissions home, counsellor list, consent with `method = applicant_app`).
* **Security.** Applicant tokens: own audience, issuer and signing key, 15 min, re-checked against the session and
  credential on every request (LMS tokens are refused there and applicant tokens everywhere else); rotating refresh
  tokens (SHA-256 at rest, 12 h); 20 sign-ins / 5 min per IP, lock after 5 wrong passwords (15 min), recovery 5 / h per
  IP, tracking 10 / 10 min per IP; generic errors (no username enumeration); `Cache-Control: no-store`; IP from the
  socket (X-Forwarded-For not trusted). Uploads (`app/services/uploads.py`, reusable): type by magic bytes, size read
  from the stream, images re-encoded (metadata dropped, bomb guard), PDFs parsed and refused when encrypted or carrying
  scripts / attachments, SHA-256 stored. All actions are in the admissions audit log (identifiers only).
* **Database.** Migration `029_admission_forms.sql`: `admission.forms`, `form_versions` (immutable snapshots),
  `applications` (status machine enforced by a trigger: draft → test_pending / submitted → under_review →
  approved / rejected / correction_requested → resubmitted), `applicant_credentials` (a removed credential can never
  be revived), `applicant_sessions`, `application_documents`, `application_status_history`, `application_comments`,
  `recovery_requests`; branding columns on `organizations`; `admission_sessions.origin`. Every new table has RLS forced
  with restrictive per-role policies: teachers see only their own forms' data, an applicant only their own application,
  the pre-login gate only what sign-in needs, parents / reviewers / unknown roles nothing; teachers and applicants never
  reach the Milestone 1 CRM / DPDP tables (the server copies a submission in as `admission_system`).

API: `/ICMELive/api/v1/admission/{form-meta, forms, forms/{id}/publish|close|reopen|credentials, credentials/{id}/
acknowledge|revoke|reissue, recovery-requests, applications, applications/{id}/decision|comments|documents/…, branding}`
and the applicant app `/ICMELive/api/v1/apply/{slug}` (`login`, `refresh`, `logout`, `recovery`, `track`, `logo`, `me`,
`me/answers`, `me/documents`, `me/submit`, `me/test/launch`). Tests: `tests/test_admission_forms.py`,
`tests/test_admission_forms_rls.py`, `tests/test_uploads_and_form_schema.py`; front end `src/lib/admissionForm.test.ts`,
`src/components/admission-forms/CredentialDialog.test.tsx`, `src/pages/apply/ApplyApp.test.tsx`.

## Date-level timetable (Admin console → Timetable; Teacher / Student → Timetable)

The weekly pattern stays the recurring timetable; on top of it admins schedule **real dates**. Tabs: **Calendar**,
**Weekly pattern**, **Bell & working days**, **Rooms**, **Holidays** (super-admin and institution admins alike).

* **Calendar** — day / week / month views, **class-wise**, **teacher-wise** or the **whole institution** (day view =
  classes × periods grid), date picker + previous / next / today. Click a session to change it for that date only
  (subject, teacher — e.g. a substitute —, times, room, online link, period), cancel it for that date, or restore the
  weekly period; click a free period to add an extra session. Colours: weekly, changed for the date, extra, cancelled /
  holiday. **Copy from date**: one day (to specific dates or every working day in a range) or a whole week (into up to
  8 following weeks), for selected classes, one teacher or the whole institution; keep or replace taken periods,
  optionally make the target day identical; *Preview* is a dry run. Clashing periods are skipped and listed.
* **Conflicts** — teacher, class (overlapping periods) and room clashes, date- and effective-range-aware, for weekly and
  dated edits alike (a weekly period also checks upcoming dated sessions on that weekday). A save answers 409 with
  `detail` + the full `conflicts` list; *Check conflicts* runs the same rules without saving. Holidays and bell breaks
  are warnings only. Rooms compare case-insensitively; online sessions need no room.
* **Working days** — Monday–Sunday all selectable (Saturday / Sunday optional; default: every day, as before). Weekly
  periods on a closed day are kept but don't run; nothing new can be scheduled on it.
* **Bell schedule** — numbered periods and named breaks, a default bell plus optional per-weekday bells (e.g. a half
  Saturday). Without one the built-in bell applies (8 × 45 min from 09:00, break after period 3). New sessions take
  their times from it, the calendars draw it, and attendance offers its periods (marking the teacher's own).
* **Consistency** — one resolver (`usp_resolve_timetable`: weekly pattern within its effective range on working days +
  dated entries + published full-day holidays; drafts hidden from teachers / students) feeds the admin calendar,
  teacher and student timetables, both dashboards' "today", Copilot's student snapshot and attendance. A teacher
  scheduled by a dated session may mark that class's attendance. Changes to published classes are logged with their
  date and notified to the class, the old / new teacher and the admins (copies: one notification per class).

API (`/ICMELive/api/v1/admin`, `?org_code=` for the super-admin): `timetable/calendar?start=&end=[&class_code|&teacher_code]`
(≤ 92 days) · `PUT timetable/sessions` · `POST timetable/sessions/cancel` · `DELETE timetable/sessions/{entry_id}` (restore) ·
`POST timetable/check-conflicts` · `POST timetable/copy` · `POST timetable/copy-week` · `GET|PUT timetable/working-days` ·
`GET|PUT timetable/bell-schedule` · `rooms` (GET / POST / PUT / DELETE). `GET /classroom/my-timetable?start=&end=` adds
`sessions`, `range`, `range_holidays`, `bell_schedule`, `working_days` (default range: this week; older fields unchanged).
Migration `028_dated_timetable.sql`; tests `backend/tests/test_timetable_dated.py`, `frontend/src/lib/calendar.test.ts`.

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
cd backend ; .venv\Scripts\python -m pytest        # 366 tests incl. AI question generator, lesson plans, digital library + DIKSHA, virtual labs, admission tests + proctoring, admissions RLS + admission forms, wellness, dated timetable, student proctoring, avatar page pipeline
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
