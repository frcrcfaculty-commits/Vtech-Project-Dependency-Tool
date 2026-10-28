# Brief v2 for Antigravity — Office mode UI (Vipul's changes)

Read first: `docs/SPEC.md` §10 (the backend you call is already live and tested), `docs/AGENTS.md`, `docs/GIT_WORKFLOW.md`.
**Never delete existing screens.** The v1 site-visit flow stays in the code and reachable (see O7). Move code if needed; don't remove it.

## Who uses it
One PM lead in the office, mostly at a desktop (1280px), sometimes on a phone (390px). Everyone calls him; he types it in.
Speed of entry is the whole product: fewest clicks from "the electrician just called" to "status saved".

## Screens and acceptance checks

**O1 Setup tweak** — in the existing project wizard: floors default to **1** ("12th Floor"-style label editable; add/copy floor still there).
Replace the project-wide dependency pick + matrix steps **in the wizard flow** with O2. Keep the old step components in the codebase (used by classic mode).
- [ ] New project → floors step shows exactly 1 floor pre-filled.

**O2 Room-by-room dependency picker** (`/projects/[projectId]/rooms/[roomId]/dependencies`, also used as the wizard step)
- Room switcher (floor → room), shows how many dependencies each room already has.
- Full active master list grouped by agency type, search box, select-all per group; items already in this room show as added (disabled).
- "Add custom dependency": agency type + text; can add several before saving.
- Save → `rpc('add_room_dependencies', { p_room, p_master_ids, p_custom })`. Then "Next room →".
- "Copy from another room" convenience: preselect the master items that room has.
- [ ] Adding 10 items to a room takes ≤ 3 clicks after search/select-all.

**O3 Hub — master dashboard** (`/hub`, and the new home: `/` redirects here; move the old projects list to `/projects`, don't delete it)
- Top: project tiles (name, client, pending count, escalated count, last update). Selected tile highlighted; remember selection (URL `?p=`).
- Below: rooms grouped by floor (collapsible), each with counts. Inside each room: its dependencies grouped by agency, each row with
  **Done / Pending / N.A.** buttons, current status clearly shown (not pre-selected-looking when unchecked), raised date, reminder #, agency name, note/photo icons.
- Tapping a status opens a compact sheet: date (default today), optional note, optional photo (reuse `lib/client/image.ts`, upload to bucket `evidence` at `<project_id>/<item_id>/<uuid>.webp`) → Save → `rpc('set_item_status', { p_item, p_status, p_date, p_note, p_photo })`. One-tap save when no note/photo needed.
- Item history (from `item_events`) in a drawer.
- Item with no agency: red "No agency" badge + assign (update `dependency_items.agency_id` to one of the project's agencies).
- Filters: status, agency. "Send reminders for this project" → see O4 action.
- [ ] Marking an item Pending with a note and a photo, then reloading, shows the note, the photo and a history entry.

**O4 Pending list** (`/pending`)
- Every pending item across all projects: project, floor – room, dependency, agency, raised date, days open, reminder #, escalation level.
- Filters: project, agency type, agency, "escalated only", age. Group by project → agency.
- Select items (checkbox per row, per agency, per project) → **Send reminders** → for each project with selected items:
  `POST /api/projects/{projectId}/reminders` with `{ itemIds }` → go to the returned `/projects/{id}/visits/{visitId}/dispatches` (existing review & send).
  If several projects are selected, process one project at a time with a "Next project" step.
- Row quick actions: Done / N.A. (same sheet as O3), "WhatsApp now" (reminders for just that item), call contact (`tel:`).
- [ ] Selecting 3 items of one agency produces exactly one email + one WhatsApp draft listing those 3 items.

**O5 "+ Add dependency" everywhere** — floating button on every signed-in page (not on login).
- Dialog: project (preselected from the current page), room (preselected if known), master list with search, custom entry,
  toggle **"Mark as pending now"** (default ON once the project has any status set; OFF in the wizard).
- Save → `rpc('add_room_dependencies', { p_room, p_master_ids, p_custom, p_initial_status: 'pending' | 'unchecked' })`.
- [ ] From the Pending list, adding a custom dependency as pending makes it appear in the list without a reload.

**O6 Navigation** — top nav: Hub · Pending · Projects · Dashboard · Admin. Fix the review & send badge: L1 reads "First notice"; "Escalation L2/L3" only from L2.

**O7 Classic mode kept** — Admin page link "Site visit mode (classic)" and a project-page link "Site visit (classic)" to the existing S5/S6 screens. They must keep working (Hermes's existing e2e must stay green).

## Rules
- Escalation shown in the UI must use `reminder_count > l2_after` (L2) / `> l3_after` (L3), same as `/api/dashboard`. Put it in one helper in `lib/client/`.
- Use role/label-accessible buttons (`getByRole` friendly) — Hermes tests through them.
- No service key in the browser. No new dependencies without a one-line reason in the PR.
- Taste: neutral base, one accent, red only for pending/escalation, no gradients, no card-inside-card, dense but readable tables on desktop.
