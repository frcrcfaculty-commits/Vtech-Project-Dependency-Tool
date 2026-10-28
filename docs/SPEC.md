# VTech Site Dependency Tracker — Spec v1

Owner: Claude (architect). Status: schema + core logic built and tested; UI and notifications assigned.
Client: VTech Technologies (Vipul Shah, Jogeshwari). Users: VTech staff only. Agencies never log in.

## 1. Problem
Automation work at a site is blocked by other trades (electrician, carpenter, painter, AC, network, AV, curtain…).
VTech's PM visits weekly or twice weekly, finds what is still pending, and has to chase each agency.
Today that is a spreadsheet plus manual WhatsApp/email, with no reliable record of when something was first raised
or how many times it was chased, and no structured escalation.

## 2. Roles
| Role | Who | Can |
|---|---|---|
| super_admin | Vipul, Hansal | Everything. Sees all projects. Gets weekly digest. CC'd on top-level escalations. Edits master list and terms. |
| pm_lead | One VTech lead | Creates PM accounts, assigns PMs to projects, sees all projects, edits master list. Cannot create admins. |
| pm | Site PMs | Creates projects (becomes member), runs visits, sends reminders for projects they're assigned to. |

## 3. Core concepts
- **Master list** — VTech's dependency checklist per agency type (78 active items: 69 cleaned from the sheet + 9 from the Specimen, approved by VTech 2026-10-28). Admins edit; PMs read.
- **Project dependencies** — items picked from the master list, plus **custom** items the PM adds on the go. A custom item can be **promoted** to the master list by an admin.
- **Floors / rooms** — any number of floors; rooms picked from 40 presets or typed freely. A floor can be **copied** (rooms and their applied dependencies) for identical layouts.
- **Dependency items** — the grid: one row per (room × project dependency) the PM applied. Each has status
  `unchecked | pending | complete | na`, first-raised date, completed date, reminder count, note, photo.
- **Agencies** — per project: agency type, company, contacts with designation and **level 1–3** (1 = site engineer, 3 = owner), phone and/or email. Escalation can be turned off per agency (e.g. Client).
- **Site visit** — a dated session. PM marks items; marks are stored as visit checks (history) and applied to items only on **Finalize**.
- **Dispatch** — one message per agency per channel per visit listing **all** currently pending items for that agency.

## 4. Flows
### 4.1 Project setup (wizard)
1. Name, client, site address.
2. Floors (label + order) → rooms per floor (presets + free text) → copy floor where layouts repeat.
3. Agencies + contacts (type, company, escalation on/off, contacts with level).
4. Dependencies: tick from master list (grouped by agency type, searchable) + add custom.
5. Apply dependencies to rooms (matrix; default all rooms, untick where not applicable).
6. Escalation policy + terms (decided by PM + management for this project).

### 4.2 Site visit
PM opens visit (date defaults to today) → floor → room → each item: **Done** (with completion date) / **Pending** (date observed) / **N.A.**, optional note and photo. Progress shows checked vs total. Then **Finalize**.

### 4.3 Review and send (PM triggers; nothing goes automatically)
Finalize builds drafts: one email + one WhatsApp per agency. PM reviews recipients, level, items, warnings, then sends each.
- Email: from the PM's own @vtechpl.com mailbox.
- WhatsApp: wa.me link per recipient (PM taps send) until VTech decides on the paid API.
- Reminder count increments **once per item per visit**, even if both channels go out.

### 4.4 Escalation (per project, editable)
Reminder *n* for an item goes to:
- L1 contacts while `n ≤ l2_after` (default 3)
- L2 while `n ≤ l3_after` (default 6)
- L3 after that.
A dispatch's level = highest level among its items. **To** = contacts at that level; **CC** = lower levels.
If nobody exists at the target level, it falls back downward and warns. Super admins are CC'd on email when level ≥ `mgmt_cc_level` (default 3; 4 = never).
An item marked Done and later found Pending again starts a new episode (new first-raised date, count from 0).

### 4.5 Weekly digest
Mondays 08:00 IST to all super admins: per project pending, escalated (L2+), closed in 7 days, oldest open age, last visit, pending by agency. Same numbers on `/api/dashboard`.

## 5. Architecture
Next.js 16 (App Router) on Vercel (region bom1) · Supabase Postgres + Auth + Storage · RLS enforces access in the database.
The deployed app holds **no service-role key**: user creation (`create_app_user`), the management CC list (`management_contacts`) and the cron digest (`cron_digest_data`, gated by a secret in `app_secrets`) are narrow SECURITY DEFINER functions.
```
app/api/visits/[id]/finalize      POST  apply checks → build drafts
app/api/visits/[id]/dispatches    GET list · POST rebuild drafts
app/api/dispatches/[id]/send      POST  send, or return links (link modes)
app/api/dispatches/[id]/confirm   POST  PM confirms a link-mode send
app/api/admin/users               POST  create login, returns a temporary password (role rules enforced in DB)
app/api/dashboard                 GET   portfolio summary
app/api/cron/weekly-digest        GET   Vercel cron
```
Everything else the UI does is direct Supabase table access under RLS, plus these RPCs:
`add_master_dependencies(project, master_ids[])`, `apply_dependencies(project, dep_ids[], room_ids[])`,
`copy_floor(floor, label)`, `finalize_visit(visit)`, `promote_dependency(project_dependency)`.

## 6. Channels
| Env | Values | Notes |
|---|---|---|
| `EMAIL_MODE` | `compose_link` (default) · `gmail_api` · `dryrun` | `gmail_api` needs a Google Cloud service account with domain-wide delegation, scope `https://www.googleapis.com/auth/gmail.send`, authorised by the vtechpl.com Workspace admin. Sends as the PM. |
| `WHATSAPP_MODE` | `link` (default) · `meta` | `meta` needs a Meta Business account, a WhatsApp number, and an approved utility template with one body variable. |

## 7. Storage cost
Photos are compressed in the browser to ≤1280px WebP (~150–250 KB). 5,000 photos ≈ 1 GB.
Supabase Pro ($25/mo) includes 100 GB; free tier 1 GB. Photos are not a cost concern at VTech's scale.

## 8. Open decisions
1. WhatsApp: stay on free tap-to-send, or move to Meta Cloud API (paid per message, needs template approval).
2. Workspace access for `gmail_api` (Hansal arranging).
4. Vipul's login email and the PM lead's name/email for bootstrap.

## 9. Not in v1
Agency portal or agency self-reporting · offline-first sync (v1 queues failed saves and retries) · merging with the BOQ tool (planned later; same Supabase project can host both).
