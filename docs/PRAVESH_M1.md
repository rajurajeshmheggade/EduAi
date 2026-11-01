# Pravesh — Milestone 1: foundation

Pravesh is EduAI's admissions and screening-test module. Milestone 1 lays the ground every later milestone stands on:
tenant isolation in the database, the new roles, the DPDP core (consent, privacy requests, retention, breach log,
audit), four languages, and the shared shell (command palette, Copilot drawer). There is no admissions workflow yet —
enquiries, tests and proctoring arrive in M2–M8.

It runs inside the EduAI app on the same PostgreSQL database (schema `admission`), the same FastAPI service
(`/ICMELive/api/v1/admission`) and the same React front end.

## Run it

```powershell
cd backend
.venv\Scripts\python -m app.devdb start        # PostgreSQL 16 on 127.0.0.1:5433 (keep running)
.venv\Scripts\python -m scripts.seed           # migrations incl. 015 + EduAI demo data + Pravesh demo data
.venv\Scripts\python -m uvicorn app.main:app --reload --port 8000
cd ..\frontend ; npm install ; npm run dev     # http://localhost:5173
```

`scripts.seed` calls `scripts.seed_admission`, which is idempotent and can be re-run on its own.

### Demo data

Three schools, one per board:

| School | Board | City | Principal | Counsellor | Reviewer | Parent |
| --- | --- | --- | --- | --- | --- | --- |
| Demo International School (`DEMO-SCHOOL`) | CBSE | Bengaluru | `admin@demo.edu` | `counsellor@demo.edu` | `reviewer@demo.edu` | `parent@demo.edu` (Sunita Verma, Hindi), `irfan@demo.edu` |
| Sri Vidya Mandir (`SVM-ICSE`) | ICSE | Chennai | `principal@svm.edu` | `counsellor@svm.edu` | — | `parent@svm.edu` (Lakshmi Iyer, Tamil) |
| Karnataka Public School (`KPS-STATE`) | Karnataka State Board | Mysuru | `principal@kps.edu` | — | — | `parent@kps.edu` (Manjunath Gowda, Kannada) |

Password for every account: `Passw0rd!`. Applicants cover Classes 6–12. Each school has consent notice version 1 in
English, Hindi, Kannada and Tamil. Sunita Verma has already consented for Aarav (Class 6); Diya (Class 9) is pending,
so the consent flow can be tried straight away.

### pgAdmin

Connect to `127.0.0.1:5433`, user `postgres`, no password, database `eduai`. The tables are under
*Schemas → admission*. Connected as `postgres` you see every school's rows, because the superuser bypasses RLS. To see
what the app sees, run:

```sql
BEGIN;
SET LOCAL ROLE admission_app;
SELECT set_config('app.org_code', 'SVM-ICSE', true);
SELECT full_name, grade_applying FROM admission.applicants;   -- Sri Vidya Mandir only
ROLLBACK;
```

## Who can do what

| Role | Account role | Home | M1 access |
| --- | --- | --- | --- |
| Principal | `orgadmin` (also `superadmin`) | Admin console → Admissions | Admissions home, team, consent notices, retention, privacy requests, breach log, audit log |
| Counsellor | `counsellor` (new) | `/admissions/counsellor` | Admissions overview and applicant list |
| Integrity reviewer | `reviewer` (new) | `/admissions/reviewer` | Overview; the review queue arrives in M5 |
| Parent | `parent` (new) | `/parent` | Own children only: consent, privacy requests, language |
| Question setter | `teacher` | — | Question bank arrives in M3 |

The brief's `school_id` is EduAI's existing `org_code`. One account has one role.

## Tenant isolation

The acceptance test for M1 is "two schools can never see each other's data". It is enforced by PostgreSQL, not by
`WHERE` clauses in the API:

1. Every `admission.*` table has an `org_code` column with row-level security **enabled and forced**. A
   `tenant_isolation` policy allows only rows where `org_code = admission.current_org()`, for reading and writing.
2. Admissions queries do not use the main pool. They use a second pool that logs in as **`admission_login`**: not a
   superuser, `NOINHERIT`, and allowed only to `SET ROLE admission_app`. This is the same pattern as Supabase's
   `authenticator` role. Even if SQL were injected, the session cannot switch to `postgres` and bypass RLS.
3. `db.tenant(org, user, role)` opens a transaction, runs `SET LOCAL ROLE admission_app`, and sets `app.org_code`,
   `app.user_code` and `app.user_role` with `set_config(..., true)`. All of these are transaction-scoped, so nothing
   carries over to the next request on a pooled connection.
4. No context means no rows. If `app.org_code` is unset, `current_org()` is `NULL` and every policy is false.
5. Extra **restrictive** policies narrow what a parent sees:
   - `parent_scope` limits guardians, applicants, applicant links, consents and requests to the parent's own family.
   - `staff_only` hides the retention policies and breach log entirely.
   - On the audit log, `staff_only` blocks reading only, so a parent's actions are still recorded.
6. Consents and the audit log are **append-only** for the app role: `UPDATE` and `DELETE` are revoked. A withdrawal is
   a new row, not an edit.

`backend/tests/test_admission_rls.py` proves this against a real database. For every table it checks:

- forced RLS;
- that the app sees and changes only its own school's rows, in both directions;
- that inserts and updates into another school are refused;
- that no context returns nothing;
- that `SET ROLE postgres` fails;
- that a pooled connection does not keep the previous tenant.

It also checks that parents see only their own family and none of the staff tables.

## DPDP core

| Duty | How M1 does it |
| --- | --- |
| Verifiable parental consent before processing a child's data | Versioned notice per school and language. A parent must tick "I am the parent/guardian … I have read this notice" before the Give consent button works. Each consent stores the version, language, time, IP (from the socket; `X-Forwarded-For` is not trusted), user agent and who recorded it. |
| Notice in a language the parent understands | English, Hindi, Kannada and Tamil. If a parent opens a language the school has not published, the English text is shown, and drafts carry a "this translation is a draft; English prevails" warning. |
| Withdraw as easily as give | Same dialog; a withdrawal is recorded as a new row. |
| New notice ⇒ fresh consent | Principal publishes version N+1 (English required); older versions are deactivated and earlier consents show as "not current". |
| Access / correction / erasure / grievance | Parents raise requests from the portal; principals can also log a request received on paper. Each request is due in 30 days and appears in the principal's queue with an overdue flag; the principal records the outcome. |
| Erasure | When a child's record is deleted, the consent evidence stays and its link to the child becomes `NULL` (enforced by the schema and tested). In M1 the principal carries out the request by hand; an *Erase record* action arrives with the applicant record screens in M2. |
| Storage limitation | Per-school retention timers. The audit log is kept for at least 365 days. `python -m scripts.admission_retention [--dry-run]` applies them; schedule it nightly. Timers for M2/M5 data are already configurable and report "not yet applicable". |
| Breach reporting | Breach log with detection time and a Data Protection Board report deadline 72 hours later; principals record when the Board and the affected families were told. |
| Accountability | Audit log of who did what and when, holding identifiers only, no personal data. Principals can read it; nobody can edit it. |

The brief's ground rules that apply from later milestones are built into the design:

- no emotion, personality or IQ scoring;
- no student data sent to third-party LLMs (the Copilot drawer says so);
- proctoring video stays in the browser.

## Languages and accessibility

- i18next with English, Hindi, Kannada and Tamil resources (`frontend/src/i18n/locales.ts`). The parent portal and
  shell labels are translated; staff screens are English for now.
- The language switcher labels each option in its own script, and the choice is saved per parent (`preferred_language`).
- Translated pages set `lang` on their own root, so screen readers switch voice and the right font applies.
- Noto Sans Devanagari, Kannada or Tamil loads only when that language is chosen, through `:lang()` rules; Latin text
  stays in Inter.
- WCAG 2.2 AA:
  - dialogs are native `<dialog>` elements with focus management;
  - controls are labelled, and Escape closes overlays;
  - the parent portal works at 390 px with no sideways scrolling;
  - status messages use `role="status"`.

**The Hindi, Kannada and Tamil texts are draft translations.** Native speakers must review them before release,
especially the consent notice; the app marks them as drafts until then.

## Screens

- **Admin console → Admissions home**:
  - KPI tiles: applicants, consent given, consent pending, open privacy requests;
  - applicants by class chart;
  - consent notice status;
  - applicant table.
- **Admin console → Admissions team**: add counsellors and reviewers, edit them, and switch them on or off.
- **Admin console → Privacy & consent**, with five tabs:
  - consent notices (versions, languages, publish a new version);
  - retention timers;
  - privacy requests (due dates, overdue flag, record the outcome);
  - breach log (72-hour deadline);
  - audit log.
- **Counsellor home**: overview, applicants by class, applicant table. *Pipeline* and *Visits & interviews* are shown
  as "Soon".
- **Reviewer home**: "Integrity desk", which explains how review will work. The queue arrives in M5.
- **Parent portal** (mobile first):
  - greeting in the parent's language and a language switcher;
  - a card per child with consent status;
  - consent dialog (read, tick, give or withdraw);
  - privacy requests (kind, child, details, history with status).
- **Shell**:
  - `Ctrl/⌘-K` command palette to jump to any page in the sidebar;
  - Copilot drawer for staff roles.

## Mocks and deferrals

| Item | State |
| --- | --- |
| Copilot drawer | UI only. Answers arrive in M7 with an on-premise / redacted pipeline. |
| SMS / WhatsApp / email to parents | Not in M1; arrives with the CRM in M2. Requests and consents are portal-only. |
| Parent accounts, sign-up and OTP login | Parent accounts come from the seed only; staff-created accounts and self sign-up arrive with enquiries in M2. |
| Erase-record action | The schema keeps consent evidence on erasure; the button arrives in M2. |
| In-person consent (`method = in_person`) | Schema supports it; no counsellor screen yet. |
| Retention for enquiries, unsuccessful applicants, proctoring | Timers configurable now; purge jobs arrive with their tables in M2 / M5. |

## API

`/ICMELive/api/v1/admission`:

- **Staff:** `overview` · `applicants`
- **Principal:**
  - `team` (GET, POST, PATCH `{user_code}`)
  - `consent-templates` · `consent-versions` (GET, POST)
  - `retention` (GET, PUT)
  - `data-requests` (GET, POST, PATCH `{id}`)
  - `breaches` (GET, POST, PATCH `{id}`)
  - `audit`
- **Parent:**
  - `parent/home`
  - `parent/consent?applicant_id=&lang=`
  - `parent/consents` (POST)
  - `parent/requests` (GET, POST)
  - `parent/language` (PUT)

A parent asking for another family's child gets 404, not 403, so the endpoint does not reveal that the child exists.

## Tests

```powershell
cd backend ; .venv\Scripts\python -m pytest tests/test_admission_rls.py tests/test_admission_api.py   # isolation + API
cd backend ; .venv\Scripts\python -m pytest                                                        # full suite
cd frontend ; npm test ; npm run lint ; npm run build
```

At the end of M1:

- **Backend:** 162 passed, including 11 RLS and 6 API tests for admissions.
- **Frontend:** 24 passed, including the parent portal in Hindi → Tamil, the consent tick-box rule, the command
  palette and the Copilot drawer.
- **Build:** succeeds, and lint is clean for the new code.
- **Browser walkthrough** (principal → privacy → palette → Copilot → counsellor → reviewer → parent on a 390 px
  phone in Hindi → consent → Kannada → access request): no page errors.

## Production

1. Run migration `015_admission_foundation.sql` (or `python -m scripts.migrate`).
2. Give the login role a password: `ALTER ROLE admission_login PASSWORD '…';`
3. Set `ADMISSION_DATABASE_URL=postgresql://admission_login:…@host:5432/eduai`.

   Leaving it empty connects as `admission_login` with no password, which only works with local trust authentication.
4. Schedule `python -m scripts.admission_retention` nightly, running as the database owner.

## Decisions

- **Plain PostgreSQL instead of Supabase**: EduAI already runs on PostgreSQL. The RLS model is the same (login role →
  `SET ROLE` → policies on settings) and would move to Supabase unchanged if that is ever wanted.
- **Separate login role for admissions**: the EduAI app connects as the owner, which bypasses RLS. Admissions queries
  never use that connection.
- **`org_code` instead of a new `school_id`**: reuses EduAI's tenancy, users and login.
- **New roles instead of permissions on `orgadmin`/`teacher`**: counsellor, reviewer and parent each get their own
  home and sidebar. Principal = `orgadmin`, question setter = `teacher`.
- **English required on every notice version**: it is the reference text when a translation is a draft.

## Risks and open items

- **Legal review:** the consent notice wording and the retention defaults need review by the school's counsel against
  the DPDP Act and Rules before go-live.
- **Draft translations:** Hindi, Kannada and Tamil texts need native-speaker review.
- **Session context:** RLS context relies on `set_config`. Every admissions query is parameterised, and the login
  role cannot escalate, but any future raw SQL must keep that discipline.
- **Retention job:** it runs as the owner, outside RLS. It filters by `org_code` explicitly; keep it that way when
  adding purgers in M2 / M5.
- **One role per account:** a principal who is also a parent needs two accounts.
- **Draft fallback:** consent given while a language is still a draft is recorded with that language. If a translation
  later changes materially, publish a new version so families re-consent.
