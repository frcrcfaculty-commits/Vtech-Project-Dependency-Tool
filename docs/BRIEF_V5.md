# Brief v5 — agencies from "HansalV2", reminder categories, no escalation (VTech, 2026-11-03)

Lead: Claude (spec + review). Builders: **Antigravity** = all UI (U1–U6). **Gemini** = backend (B1–B3).
Live app: https://vtech-hansal.zocomputer.io (Zo Computer; merging to `main` deploys within ~5 min; check `/api/health` sha).
Source: Google Sheet "Ashutosh Project Status" (https://docs.google.com/spreadsheets/d/1yWx6z6mkbqic78XTSxXg8Oe3wcD-CMYQ1J9dX6Omv08),
tabs **"HansalV2"** (agency groups, stuck reasons) and **"Reminder Format"** (reminder categories).

## The 7 changes (Hansal, 2026-11-03)
1. Dashboard matrix: grouping **Room-wise · Agency-wise · Product-wise** (Agency-wise replaces Floor-wise).
2. **Escalation policy removed altogether** (no wizard step, no L1/L2/L3, no thresholds, no escalated counters/badges/filters).
3. Agencies: **only the 7 groups in "HansalV2"** (below). Everything else hidden.
4. Add product page: **one thin line per product** — add controls, tracker (step chain), location, quantity, all on one row; same for placed products.
5. **No emojis** in WhatsApp (or email) text.
6. Every reminder option shows **Send WhatsApp** and **Send Email**; **preview sits on the side**.
7. Reminders are sent **per category** from a new page that reproduces the "Reminder Format" tab; project setup collects agencies to match.

## 3. Agency groups (sheet "HansalV2", rows 20–28)
| Group (agency type name in DB) | Side | Contact slots in setup | "Entries" col D | Default in reminders (col C) |
|---|---|---|---|---|
| Client | External | 3 | 3 | **Selected only** → unchecked by default |
| PMC / Architect / Client person *(new type)* | External | 6 | 6 | **All emails** → checked by default |
| Electrician | External | 2 | 2 | Selected whenever → checked in its own category |
| Carpenter | External | 2 | 2 | Selected whenever → checked in its own category |
| VTECH Sales Team *(new type)* | VTech internal | 1 + add more | — | checked |
| VTech Installers | VTech internal | 1 + add more | — | checked |
| VTech Programmers | VTech internal | 1 + add more | — | checked |

Each contact: **Name · Designation · Email · Phone** (sheet B28). At least one of email/phone. No level field in the UI (escalation is gone).
All other agency types (Painter, Architect, Curtain Vendor, AC Vendor, Network Agency, Programmer, Wallpaper Vendor, VTech, VTech Project
Managers…) become `active = false`: hidden in every picker, kept in the DB for old data.

**Re-pointing defaults that used retired types** (Gemini, migration 0010):
| Where | From | To |
|---|---|---|
| product_steps default + step_reasons | Architect, Painter, Curtain Vendor, AC Vendor | PMC / Architect / Client person |
| product_steps default | Network Agency (internet activation) | Client |
| product_steps default + step_reasons | VTech Project Managers (orange handover docs, "Yet not prepared by VTECH", "Sales clearance", "Stock purchase") | VTECH Sales Team |
| step_reasons "Client approval awaited" | Client | Client (unchanged) |
Existing `agencies`/`dependency_items` rows are **not** changed (old projects keep their data).

## 7. Reminder categories (sheet "Reminder Format")
| Category (key) | Which pending items it lists | Recipient groups offered (checkboxes) |
|---|---|---|
| All dependencies (`all`) | every pending item of the project | Client · PMC / Architect / Client person · VTECH Sales · VTECH Installers · VTECH Prog |
| Installer dependency (`installer`) | pending items waiting on **VTech Installers** | VTECH Sales · VTECH Installers · VTECH Prog |
| Programmer dependency (`programmer`) | pending items waiting on **VTech Programmers** | VTECH Sales · VTECH Installers · VTECH Prog |
| Only electrical dependency (`electrical`) | pending items waiting on **Electrician** | Electrician |
| Only carpentry dependency (`carpentry`) | pending items waiting on **Carpenter** | Carpenter |
"Waiting on" = the item's assigned agency type, falling back to the step's default agency type when unassigned.
Default checkbox state per group comes from the table in §3. Each category row has **Preview Email · Preview WhatsApp** (side panel)
and **Send Email · Send WhatsApp**. A category with 0 pending items shows "Nothing pending" and disabled buttons.

## Backend contract (Gemini builds; Antigravity codes against it)
**B1 — migration `supabase/migrations/0010_v5_agencies_reminders.sql`** (+ SQL tests in `tests/sql/10_behaviour_test.sql`, add file to `scripts/test-sql.sh`):
- `agency_types`: add `active boolean not null default true`, `side text check (side in ('external','internal'))`, `contact_slots int`,
  `sort` reused for display order. Insert `PMC / Architect / Client person` and `VTECH Sales Team`. Set active/side/slots per §3; all others inactive.
- `agency_contacts`: add `designation text` (nullable). AV Vendor is also retired.
- Remap `product_steps.default_agency_type_id` and `step_reasons.agency_type` per the table above.
- `reminder_categories (key text pk, label text, sort int, item_agency_type_id uuid null references agency_types)` — null = all items.
- `reminder_category_recipients (category_key text references reminder_categories, agency_type_id uuid references agency_types, default_checked boolean, sort int, primary key (category_key, agency_type_id))`.
- RLS: read for authenticated, write for admins. Seed the 5 categories and their recipients exactly as in §7/§3.
- View `reminder_category_items (security_invoker)`: `project_id, category_key, item_id` for pending items per category rule.
- Do **not** drop `projects.l2_after/l3_after/mgmt_cc_level`; they become unused.

**B2 — API**
- `GET /api/projects/{projectId}/reminder-categories` →
  `[{ key, label, itemCount, recipients: [{ agencyTypeId, name, defaultChecked, agencies: [{ id, companyName, contacts: [{ name, designation, email, phone }] }] }] }]`
  (recipients only for agencies the project actually has; a group with no agency in the project is returned with `agencies: []`).
- `POST /api/projects/{projectId}/reminder-rounds` body `{ category: string, agencyTypeIds: string[], channel: 'email'|'whatsapp', preview?: boolean }`
  → `preview: true`: returns `{ email: { to, cc, subject, text, html } | null, whatsapp: { to, text } | null, itemCount }` without saving.
  → otherwise: opens an office round (`start_office_followup`), drafts **one message per selected agency** listing **all items of the category**
  (not only items assigned to that agency), all active contacts of that agency as recipients, then sends exactly like today:
  email → `sendDispatch` (Gmail compose link / Gmail API / dryrun), WhatsApp → wa.me links; returns `{ visitId, dispatches:[{id, agency, channel, status, links?}], warnings }`.
  Reminder counts increase once per item per round (existing `mark_dispatch_sent` rule).
- Old `POST /api/projects/{id}/reminders` keeps working (no breaking change) until the UI no longer calls it.

**B3 — wording and cleanup**
- `lib/report.ts`: remove every emoji (🙏, ⚠️ …) from WhatsApp and email; remove escalation tags/levels from subject and body; no management auto-CC.
- New reminder text is per category: greeting to the group, project, category label, numbered items "Floor – Room · Product (location) · Step — reason, since <date>", kind ask, thanks, PM name. Internal groups (VTECH Sales/Installers/Programmers) without the agency terms footer.
- Unit tests: no character outside basic Latin/₹/–/· in WhatsApp text; one draft per selected agency; category filtering.

## UI (Antigravity)
- **U1** Dashboard matrix grouping: Room-wise · Agency-wise · Product-wise (remove Floor-wise). Agency-wise groups lines by waiting-on agency.
- **U2** Remove escalation everywhere: wizard step, Edit project dialog fields, L1/L2/L3 badges, "Escalated" counters/filters/columns
  (Hub, Pending, Reports, review & send, PDFs' UI links). Delete `lib/client/escalation.ts` once unused.
- **U3** Project setup + project Agencies tab: two sections, External (Client 3 slots, PMC/Architect/Client person 6, Electrician 2, Carpenter 2)
  and VTech internal (Sales Team, Installers, Programmers; 1 slot + "Add contact"). Fields Name, Designation, Email, Phone. Only `active` types anywhere.
- **U4** Add product page (`components/room-product-picker.tsx`): one row per product ≤ 44px tall:
  `Product · Location (select + Other…) · Qty − 1 + · step-chain dots · [Add]`; placed products also one row each with `Remove`. No cards.
- **U5** Reminders page `/projects/[projectId]/reminders` — the "Reminder Format" matrix as a page: one row per category: label + pending count,
  recipient checkboxes (from `GET …/reminder-categories`, default state from DB, disabled + "not added to project" when the group has no agency),
  buttons **Send Email** and **Send WhatsApp**; a **preview panel on the right** (tabs Email / WhatsApp) that updates for the focused row and
  current checkboxes (`POST …/reminder-rounds` with `preview: true`). Dashboard "Send reminders" and Pending "Send reminders" go here
  (Pending passes its project). After sending email: open the Gmail link(s); after WhatsApp: open each wa.me link and show "I've sent it"
  (existing confirm API). On a phone the preview drops below the row.
- **U6** Review & send page (`/projects/[id]/visits/[visitId]/dispatches`): two columns, list left, preview right; each draft shows both
  **Send WhatsApp** and **Send Email** when the agency has phone/email. Strip any emoji from UI-generated text.

## Order and dependencies
1. Gemini: B1 → Hansal pastes 0010 in the Supabase SQL editor → Claude verifies live → B2+B3 merged.
2. Antigravity: U1, U2 (UI parts), U4 immediately; U3, U5, U6 after B1 is live and B2 is on `main`.
3. Claude reviews each merge: all checks, live click-through at 1280px and 390px, live DB checks.

## Not in scope (flag only)
- "Hansal" tab now uses a new **magenta** colour (e.g. J5 "Fabric installation from curtain vendor awaited"); `scripts/extract-catalogue.py`
  stops on it by design. Catalogue re-sync needs VTech to say who magenta means — separate task.
- "Hansal Raju" tab (location/height and model/colour confirmations per product) — not requested yet.
