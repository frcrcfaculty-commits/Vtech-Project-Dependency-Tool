# Brief for Antigravity (Gemini) — build the whole UI

Paste this file, docs/SPEC.md and docs/AGENTS.md into Antigravity as context. Work in the paths you own (AGENTS.md).

## Context you must know
- Backend is done and tested: schema + RLS in `supabase/migrations/0001_init.sql`, API routes in `app/api/**`, logic in `lib/**`.
- Talk to the database with `@supabase/ssr` browser client (anon key + user session) — RLS already limits what each user sees.
  Use the RPCs listed in SPEC §5 for multi-row operations. Use the API routes for finalize/send/users/dashboard.
- Main users are PMs **on a phone, standing in a half-finished flat, often with weak signal**. Design for one thumb.
- Apply taste-skill (Leonxlnx/taste-skill) for colour, type, spacing and motion. No template look: no purple gradients,
  no card-in-card nesting, no decorative icons. Neutral base, one accent, red only for escalation/pending-overdue.
- Stack: Next.js 16 App Router, React 19, Tailwind (add it), no component library unless justified in the PR.

## Screens and acceptance checks

**S1 Sign in** (`app/login`) — email + password; "Forgot password"; handle invite link (set password).
- [ ] Invited user can set a password and lands on S2.

**S2 Projects** (`app/(app)/page.tsx` — move the placeholder) — list of projects the user can see: name, client, pending count, escalated count, last visit (from `GET /api/dashboard`). "New project" button.
- [ ] A PM sees only assigned projects; Vipul sees all.

**S3 Project setup wizard** — 6 steps from SPEC §4.1. Can be left and resumed (each step saves immediately).
- Floors: "How many floors?" → creates N floors with editable labels (e.g. "12th Floor") and order.
- Rooms: chip picker from `app_settings.room_presets` + free-text add; per floor. "Copy this floor" → `rpc('copy_floor', {p_floor, p_label})`.
- Agencies: type (from `agency_types`), company, escalation toggle, contacts (name, designation, level 1–3, phone, email; at least one of phone/email).
- Dependencies: master list grouped by agency type with search and select-all per group → `rpc('add_master_dependencies', …)`. "Add custom dependency" (agency type + text) → insert into `project_dependencies` with `master_dependency_id = null`.
- Apply to rooms: matrix (dependency groups × rooms), default everything ticked; quick "untick for this room/floor" → `rpc('apply_dependencies', {p_project, p_dep_ids, p_room_ids})`.
- Escalation + terms: `l2_after`, `l3_after` (> l2_after), `mgmt_cc_level` (1–3 or "never" = 4), terms textarea prefilled.
- [ ] A 3-floor project with 30 rooms and 60 dependencies is set up in under 10 minutes.
- [ ] Copying a floor produces identical rooms and dependencies.

**S4 Project home** — tabs: Overview (pending by agency, by floor) · Grid (rooms × items with status colours, filter by agency/status) · Agencies & contacts · Settings (edit S3 data later, add dependencies/rooms anytime).
- [ ] PM can add a new custom dependency mid-project and apply it to selected rooms.

**S5 Site visit — the most important screen**
- Start visit (date default today, editable). Navigate Floor → Room → item list (grouped by agency).
- Each item: three large buttons **Done / Pending / N.A.**; Done asks completion date (default visit date); Pending shows first-raised date and reminder count already on the item; optional note; optional photo.
- Photo: `<input type="file" accept="image/*" capture="environment">`, resize in browser to max 1280px, encode WebP quality 0.7, upload to bucket `evidence` at `<project_id>/<item_id>/<uuid>.webp`, store the path on the check.
- Save each tap immediately: upsert `visit_checks` (unique `visit_id,item_id`). If the save fails, keep it in a local queue (localStorage), show a "3 unsaved" badge, retry on reconnect.
- Header shows progress "86 / 120 checked" and per-room completion ticks. "Copy last status" shortcut for rooms with nothing changed.
- "Finalize visit" → `POST /api/visits/{id}/finalize` → go to S6.
- [ ] 120 items can be checked on a mid-range Android phone without a page reload.
- [ ] Airplane mode mid-visit loses nothing once the phone reconnects.

**S6 Review & send** — after finalize, list drafts from `GET /api/visits/{id}/dispatches`: agency, channel, level badge (L2 amber, L3 red), recipients (to/cc), item count, warnings. Preview: email HTML in a sandboxed iframe; WhatsApp text in a chat bubble.
- "Send" → `POST /api/dispatches/{id}/send`. If response `status: 'needs_confirmation'`, open each link (Gmail compose / WhatsApp) and show "I've sent it" → `POST /api/dispatches/{id}/confirm`. "Send all email" convenience button. "Rebuild drafts" → `POST /api/visits/{id}/dispatches`.
- [ ] Every agency with pending items gets exactly one email and one WhatsApp draft.
- [ ] After confirming, the item reminder counts increase by 1.

**S7 Admin** (super_admin + pm_lead) — Users (invite via `POST /api/admin/users`, deactivate) · Project assignment (`project_members`) · Master list (edit text, activate/deactivate items, add new, see custom project items and "Promote" → `rpc('promote_dependency')`).
- [ ] PM lead cannot see the "super admin" role option.

**S8 Dashboard** (super_admin) — portfolio table from `GET /api/dashboard`, sorted by escalated then pending.

## Done means
All checks ticked with screenshots in the PR, `npm run typecheck && npm test && npm run build` green, Lighthouse mobile performance ≥ 85 on S5.
