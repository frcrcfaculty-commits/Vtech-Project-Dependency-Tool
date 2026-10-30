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
1. WhatsApp: stay on free tap-to-send, or move to Meta Cloud API (paid per message, needs template approval). Live today: `link` (free).
2. Workspace access for `gmail_api` (Hansal arranging). Live today: `compose_link` (opens the PM's own Gmail).
3. ~~Vipul's login email~~: done, vipul@vtechpl.com exists and signs in. **Still open:** the real PM lead's name and email
   (only the test account `hansalgandhi+pmlead@gmail.com` holds that role).
4. The §11 "Defaults to confirm with VTech" still need VTech's confirmation. (The master-list interpretations were approved on 2026-10-28.)

Accounts `e2e-pm@example.com` / `e2e-lead@example.com` ("E2E Test …") exist only for the automated tests (docs/ACCEPTANCE.md).

## 9. Not in v1
Agency portal or agency self-reporting · offline-first sync (v1 queues failed saves and retries) · merging with the BOQ tool (planned later; same Supabase project can host both).

## 10. Office mode (v2, Vipul 2026-10-29) — the default workflow
**Who:** one PM lead (role `pm_lead`) sitting in the office. Site people phone/text him; he enters everything, follows up with
every agency, and reports to Vipul. Desktop first, must still work on a phone.

**What stays:** project creation, agencies and contacts, escalation policy, the dispatch engine, review & send, PDF, digest.
The v1 site-visit screens (S5 visit checklist, project-wide dependency matrix) are **kept in the code and still work** —
reachable as "Site visit mode (classic)". Do not delete them: they are the basis of the future generic multi-vendor app.

**What changes**
1. Setup: floors default to **1** (more can be added/copied).
2. Dependencies are added **per room**: pick a room → full master list (78 items, grouped by agency type, searchable) + custom → save.
3. **Hub (master dashboard)**: project tiles on top → pick a project → rooms (by floor) → every dependency with **Done / Pending / N.A.**
   Any status change can carry a **note and a photo**. Changes apply immediately (no visit to finalize) and are kept in history.
4. **Pending list**: every pending dependency across projects, filterable; select items → send reminders (email + WhatsApp per agency)
   through the existing review & send screen.
5. **"+ Add dependency" on every page**: master list + custom, can be marked Pending immediately (raised today).

**Backend (done, live, tested — 54 SQL checks):**
| Call | Does |
|---|---|
| `rpc('add_room_dependencies', {p_room, p_master_ids, p_custom, p_initial_status, p_date})` | Adds master ids + custom `[{agency_type_id,text}]` to one room. Idempotent. `p_initial_status` `'unchecked'` (default) or `'pending'`. Returns number of new items. Items auto-assigned to the project's agency of that type. |
| `rpc('set_item_status', {p_item, p_status, p_date, p_note, p_photo})` | Done/Pending/N.A. right now. Same rules as a finalized visit (new pending episode → raised date = p_date, reminder count 0; done → completed date). Writes `item_events`. Returns the updated item. |
| table `item_events` | History per item (status, date, note, photo, source office/visit, who, when). RLS by project. |
| `POST /api/projects/{projectId}/reminders` `{agencyIds?, itemIds?}` | Opens an office follow-up round and builds drafts for the chosen pending items. Returns `{visitId, dispatches, warnings}`; `visitId` is null when nothing to send. Then open `/projects/{projectId}/visits/{visitId}/dispatches` (existing review & send). Messages say "As of <date> … still pending" instead of "At our site visit". |
| `site_visits.kind` | `'site'` (classic) or `'office'` (follow-up rounds). |

## 11. Product tracking (v3, VTech 2026-10-30, sheet revision 11:50) — replaces master-list picking for new projects
Source of truth: Google Sheet **"Ashutosh Project Status" → tab "Hansal"** (columns: Products, Location, Dependency 1…14),
extracted to `supabase/seed/products.csv` + `product_steps.csv` → `scripts/gen-catalogue.mjs` → `supabase/seed/catalogue.sql`.
**27 products, 163 steps.** Re-run the extraction whenever VTech edits the sheet (Claude does this).

**Flow (unchanged from this morning):** New project (name, client, site) → Floors → Rooms → Agencies (**External** + **Internal team**) →
Room-wise products (product + location) → Escalation → Hub. Only the dependency list and who owns each dependency come from the sheet.

**Model.** A room gets products (Keypad, Curtain, Speakers, Off Termination…) with a location (Entrance/Bedside…, Sheer/Heavy/Roller/Roman,
Ceiling/Wall…; free text allowed). Each product brings its fixed chain of steps. Every step is a normal `dependency_items` row
(Hub, Pending, reminders, history, PDF all keep working), linked by `room_product_id` + `step_id`.

**Colour legend (sheet rows 36–40) → owner:**
| Colour | Legend text | `responsibility` | Default agency type | Phase |
|---|---|---|---|---|
| green `D9EAD3` | Other agencies | external | by step: cable/ferrule/readiness→Electrician, dustfree→Painter, engraving/opening→Architect, other-vendor schedule→Curtain/AC Vendor, delivery→Client | 1 |
| blue `C9DAF8` (+ `CFE2F3` Fabric installation) | Other agencies | external | carpenter→Carpenter, ferrule→Electrician, partial/complete installation→Electrician, internet activation→Network Agency, fabric→Curtain Vendor, client impressions/scene setting/AMC intro→Client | 2 |
| dark red `E06666` | Installers | internal | VTech Installers | 2 |
| light red `F4CCCC` | Programmers | internal | VTech Programmers | 2 |
| orange `F9CB9C` | Project managers | internal | VTech Project Managers | 2 |

**Gating (Vipul's rule).** Per product placed in a room: all green steps are open at once (several can be Pending together).
**Every other colour stays locked until all green steps of that product are Done or N.A.; then all of them open together.**
Locked steps can't be set Pending/Done (`set_item_status` raises `locked: …`); N.A. is always allowed. Lock state comes only from view `item_gate`.
(Products with no green steps — iPhone programming, Client Side — are open from the start.)

**Who gets chased.** Each step waits on an agency (default from the table above; the PM can reassign per item).
- External agency → reminder to that agency (email + WhatsApp), as today.
- Internal team → reminder with `[Internal]` in the subject and no agency terms footer.
- Agency of type **Client** → **never chased**; `item_gate.waits_on_client = true`; shown under "Waiting on client" and in reports.

**Backend calls (migration 0007 — 72 SQL checks):**
| Call | Does |
|---|---|
| tables `product_catalogue` / `product_steps` | catalogue; admins edit, everyone reads |
| `rpc('add_room_product', {p_project, p_room, p_product, p_location, p_quantity, p_note})` | places a product, creates its steps (unchecked). `p_room` null for project-scope products → room "Project-wide / Handover & client". Returns `room_products.id` |
| `rpc('remove_room_product', {p_room_product})` | removes product + its steps |
| view `item_gate` | `item_id, room_product_id, title, location, seq, label, phase, responsibility, gate, status, locked, waits_on_client` |
| `rpc('item_is_locked', {p_item})` | boolean |
| `rpc('set_item_status', …)` | unchanged signature, enforces the gate |
| `copy_floor` | also copies placed products (fresh steps) |
| `agency_types.internal` | true for VTech, VTech Installers, VTech Programmers, VTech Project Managers |
| `POST /api/projects/{id}/reminders` | unchanged; skips Client-agency items (warning), `[Internal]` wording for internal teams |

**Defaults to confirm with VTech:** "Delivery pending client / VTECH" defaults to the Client agency (so it is reported, not chased; the PM
reassigns to VTech Installers when VTech owes the delivery); blue partial/complete lighting installation → Electrician; Fabric installation's
lighter blue treated as blue; Wi-Fi locations extended to Ceiling/Room/Hall/Entrance/External.
