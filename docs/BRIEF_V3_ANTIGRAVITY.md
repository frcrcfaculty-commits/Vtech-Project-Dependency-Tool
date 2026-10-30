# Brief v3 for Antigravity — Product tracking UI (VTech change request 2026-10-30)

Read first: `docs/SPEC.md` **§11** (backend is built and tested), `docs/AGENTS.md`, `docs/GIT_WORKFLOW.md`.
**Never delete existing code.** Master-list room picker, classic matrix, classic site visit, office Hub all stay reachable.

## Who / what
One PM lead in the office. New flow for a new project:
New project (name, client, site) → Floors (unchanged) → Rooms (unchanged) → **Agencies: External + Internal team** →
**Room-wise products** (title + location; replaces the master-list picker in the wizard) → Escalation (unchanged) → Hub.
Then day to day he moves each product through its steps. Green steps first; red/orange/blue only unlock after all greens are done.

## Slices (one branch + PR each, in this order; merge your own PR only on green CI)

### P1 Agencies: External / Internal (`antigravity/p1-agencies-internal`)
- Wizard agencies step and project Agencies tab show two sections: **External agencies** (types with `agency_types.internal=false`)
  and **Internal team** (`internal=true`: VTech Installers, VTech Programmers, VTech Project Managers, VTech). Same form
  (company/team name, contacts with name, designation, level 1–3, phone, email).
- Internal section pre-suggests the 3 VTech teams with one click "Add VTech team".
- [ ] A project can have both; internal agencies never appear in the External list and vice-versa.

### P2 Room-wise product picker (`antigravity/p2-product-picker`) — biggest slice
- New wizard step "Room products" replacing the master-list step **in the wizard flow** (old step stays reachable as
  "Use master dependency list (classic)" and "Switch to classic bulk matrix setup", both kept).
- Room switcher (floor → room) like today. For the room: list of the 24 room-scope products from `product_catalogue`
  (order by `sort`), each with a location select (`location_options` + "Other…" free text) and quantity.
  Add several products in one go; same product may be added twice with different locations (e.g. 2 keypads: Entrance, Bedside).
- Save → one `rpc('add_room_product', {p_project, p_room, p_product, p_location, p_quantity})` per row. Then "Save & next room →".
- Show what's already placed in the room with its step chain preview (coloured dots green/red/orange/blue) and a remove action
  (`rpc('remove_room_product')`, confirm first).
- Project-scope products ("iPhone programming", "Client Side") added once per project from a "Project-wide" section (`p_room: null`).
- "Copy products from room…" convenience (re-adds the same product+location list to another room).
- [ ] Living room with Keypad(Entrance), Keypad(Bedside), Curtain(Sheer), Speakers(Ceiling) is set up in under a minute.

### P3 Hub product view with gating (`antigravity/p3-hub-products`)
- In the Hub, rooms list their **products**; each product is a row/card: `Speakers · Ceiling` with a step progress bar
  (one segment per step, coloured by responsibility, filled when Done/N.A.).
- Expanding a product shows its steps (from view `item_gate`, order by `seq`): open steps with Done / Pending / N.A. (existing
  status sheet with note + photo); **locked steps greyed with a lock and "Unlocks after: <open green steps>"**; buttons disabled.
- Default filter "What's actionable now": hides locked steps. Toggle "Show all steps".
- Badges: External / Internal (team name) / Client. Colour key shown once per page (green external, red internal, orange PM, blue client).
- When marking Pending, the status sheet shows "Waiting on: [agency dropdown]" prefilled from the item's agency, filtered to
  external agencies for external steps and internal team for internal steps (update `dependency_items.agency_id`).
- Error `locked: …` from `set_item_status` must show as a friendly message (shouldn't happen if UI disables correctly).
- Master-list items (legacy/custom) keep rendering as today in the same room, under "Other dependencies".
- [ ] Speaker: mark Delivery Pending + Readiness Pending together → both pending; Installation stays locked; mark both Done →
      Installation unlocks; Sound testing unlocks only after Installation Done.

### P4 Pending list: three lanes (`antigravity/p4-pending-lanes`)
- Tabs at top: **External (agencies)** · **Internal (VTech team)** · **Waiting on client**. Counts on each tab.
- External and Internal tabs: today's list + select + "Send reminders" (same `/api/projects/{id}/reminders`). Internal drafts show
  "[Internal]" in subject; review & send screen unchanged.
- Waiting on client tab: no reminder buttons. Instead "Copy status note" (plain text summary for the PM to share with Vipul/the
  client) and "Download client-pending PDF" (Hermes builds the route `/api/reports/client-pending.pdf`; link it, show "coming soon" if 404).
- Rows show product + location + step (e.g. "Living Room · Speakers (Ceiling) · Readiness to install").
- [ ] Selecting 2 internal items sends one "[Internal]" draft to the VTech team agency only.

### P5 Catalogue admin + add-anywhere (`antigravity/p5-catalogue-admin`)
- Admin → "Product catalogue": list products (title, scope, locations) and steps (seq, label, colour/responsibility, gate,
  default agency type). Super admin / PM lead can edit labels, locations, add a product, add/reorder steps, deactivate products.
  (RLS already restricts writes to admins.)
- The floating "+ Add" button gets two tabs: **Add product to room** (P2 form, single room) and **Add custom dependency**
  (existing master-list/custom dialog).
- [ ] Adding a new product "Video door phone" with 3 steps makes it selectable in the room picker immediately.

## Rules
- Locked state comes ONLY from view `item_gate.locked` — never recompute gating in the browser.
- Responsibility colours: green `#2f855a`-ish for external, red for internal, orange for PM docs, blue for client; keep them consistent
  in Hub, Pending, picker and the key. Neutral base otherwise (taste-skill).
- Embed tables by name (`rooms(...)`), never `alias:column(...)` hints.
- Desktop 1280 first, must work at 390. Screenshots of every acceptance check in each PR.
