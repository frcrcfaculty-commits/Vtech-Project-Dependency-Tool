# Acceptance status — every check from the briefs

Last run: **2026-10-31 (IST)** against the live Supabase project and a local production build (Vercel Sandbox, bom1).
- `npm run typecheck` clean · `npm test` 33/33 · `npm run test:sql` 72 checks.
- e2e: API 24/24 (`flow` 10, `office` 8, `products` 6). Browser 10/10 (`products.browser` 3, `office.browser` 5, `s5-s6.browser` 2).

How to re-run: see `e2e/README.md`. Without the service-role key, `admin()` falls back to the PM lead session; then delete
`TEST – e2e…` projects afterwards (`delete from projects where name like 'TEST – e2e%'`).

Legend: ✅ test = an automated test proves it · ✅ checked = verified from the code or live data, no dedicated test ·
⬜ manual = needs a person or a real device; not verified yet.

## v1 — site-visit app (docs/BRIEF_ANTIGRAVITY.md)
| Check | Status | Evidence |
|---|---|---|
| New user signs in with the temporary password, changes it, lands on S2 | ⬜ manual | Change-password dialog exists (`components/app-header.tsx`); first-login flow not tested |
| PM sees only assigned projects; Vipul sees all | ✅ test | `flow.e2e` "access: a PM not assigned…" + RLS (`can_access_project`) |
| 3-floor project, 30 rooms, 60 dependencies set up in < 10 min | ⬜ manual | Timing with a real user |
| Copying a floor produces identical rooms and dependencies | ✅ test | `flow.e2e` "copy floor duplicates rooms and their dependencies"; `products.e2e` copy_floor copies products |
| PM can add a custom dependency mid-project and apply it to selected rooms | ✅ test | `office.e2e` "on-the-go"; `office.browser.e2e` "+ Add dependency" from Pending |
| 120 items checked on a mid-range Android phone without reload | ⬜ manual | Needs a device |
| Airplane mode mid-visit loses nothing | ⬜ manual | Offline queue exists (`lib/client/visit-sync.ts`); needs a device |
| Every agency with pending items gets exactly one email + one WhatsApp draft | ✅ test | `flow.e2e` visit 1; `s5-s6.browser.e2e` S6 |
| After confirming, reminder counts +1 | ✅ test | `flow.e2e`, `office.e2e`, `s5-s6.browser.e2e` S6 ("counts +1 exactly") |
| PM lead cannot see the "super admin" role option | ✅ test + checked | `flow.e2e` roles (DB refuses); admin page renders the option only for super admins |

## v2 — office mode (docs/BRIEF_OFFICE_ANTIGRAVITY.md, docs/BRIEF_OFFICE_HERMES.md)
| Check | Status | Evidence |
|---|---|---|
| New project → floors step shows exactly 1 floor | ✅ test | `office.browser.e2e` "wizard: 1 floor by default" |
| Adding 10 items to a room ≤ 3 clicks after search/select-all | ⬜ manual | Picker has select-all; click count not measured |
| Pending with note + photo, reload shows note, photo, history | ✅ test | `office.browser.e2e` "Hub: mark Pending with note + photo…" |
| 3 items of one agency → exactly one email + one WhatsApp draft with those 3 | ✅ test | `office.e2e` "reminders with itemIds…"; `office.browser.e2e` Pending list select 2 |
| Custom dependency added as pending from the Pending list appears without reload | ✅ test | `office.browser.e2e` "+ Add dependency from the Pending page…" |
| H7 Hub shows two demo tiles with realistic counts | ✅ checked | Demo – Mehta Villa 9 pending / 4 done (3 escalated), Demo – Shah Residence 43 pending |
| H8 portfolio PDF: 3 projects × 100 items < 4 s, Devanagari OK | ✅ test | `lib/pdf/portfolioReport.test.ts` (Marathi names, 3 × 100 items) |
| H10 both suites green against a local production build; Demo data left as seeded | ✅ test | 10/10 browser; Demo – Shah Residence still has only its seeded visit after S5/S6 teardown |

## v3 — product tracking (docs/BRIEF_V3_ANTIGRAVITY.md, docs/BRIEF_V3_HERMES.md)
| Check | Status | Evidence |
|---|---|---|
| P1 project can have external + internal; never mixed in the lists | ✅ test + checked | `products.e2e` setup (internal flag on exactly the 3 VTech teams); setup page filters on `agency_types.internal` |
| P2 Living room with 2 keypads, curtain, speakers in under a minute | ✅ test (partly) | `products.browser.e2e` picker adds Keypad, Speakers, Door lock with locations; the one-minute timing is manual |
| P3 Speaker: 3 greens pending together; Installation + Sound testing unlock together | ✅ test | `products.e2e` gate; `products.browser.e2e` "complete the Speakers greens in the UI…" |
| P3 Door lock: blue carpenter step locked until 3 greens done | ✅ test | `products.e2e` gate (Door lock) |
| P4 2 internal items → one "[Internal]" draft to the VTech team only | ✅ test | `products.e2e` reminders (internal → VTech Installers only, "[Internal]" subject) |
| P5 new product "Video door phone" selectable in the picker immediately | ✅ checked | Picker reads `product_catalogue` where `active` on every load, ordered by `sort`; no dedicated test |
| H11 all three Pending lanes non-empty for Demo – Gandhi Residency 2 | ✅ checked | Live data: external 12, internal 6, waiting on client 8 |
| H13 product e2e (API + browser) | ✅ test | `e2e/products.e2e.ts` 6/6, `e2e/products.browser.e2e.ts` 3/3 |

## Bugs found while running these
- Hub and Pending stamped status dates in **UTC**: anything marked between 00:00 and 05:30 IST got yesterday's date.
  Fixed (`lib/client/date.ts` → `todayIST()`).
- The Pending screen had no app header (no navigation from it). Fixed.

## Still open (decisions, not code)
See docs/SPEC.md §8.
