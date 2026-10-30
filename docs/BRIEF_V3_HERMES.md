# Brief v3 for Hermes — product tracking: demo data, tests, client-pending report (small scope)

Read `docs/SPEC.md` §11. Backend done; Antigravity builds all UI. Keep this light.

## H11 Demo project v3 (start now)
Extend `scripts/seed-demo.ts`: add "Demo – Gandhi Residency 2" built ONLY through `add_room_product` + `set_item_status`:
2 floors, 6 rooms, external agencies (Electrician, Painter, Architect, Curtain Vendor, Client) and internal team (VTech Installers,
VTech Programmers, VTech Project Managers) each with 1–2 contacts. ~20 products incl. Keypad×2 (Entrance, Bedside), Curtain (Sheer),
Speakers (Ceiling), Dimmer dali, Switch/Router, plus project-wide "Client Side". States: some products still in green with 2 greens pending
at once, some unlocked into red (Installation pending), one Dimmer waiting on client "Scene setting", one Switch/Router on "Internet activation".
- [ ] Hub shows all three lanes non-empty for this project.

## H12 Client-pending PDF (start now)
`GET /api/reports/client-pending.pdf?project=<id optional>` (you own `app/api/reports/**`): items with `responsibility='client'` and
status pending/unchecked-but-unlocked, grouped project → room → product, with step, since-date, note. Title "Waiting on client".
Reuse `lib/pdf/`.

## H13 E2E for product tracking (start after Antigravity merges P3)
API spec `e2e/products.e2e.ts`: add_room_product (room + project-scope), gate (two greens pending together; installation locked until
both done/N.A.; sound testing after installation; N.A. allowed when locked), remove_room_product, copy_floor copies products,
reminders: client step never drafted, internal step → "[Internal]" draft to the internal agency only.
Browser spec `e2e/products.browser.e2e.ts`: picker adds 3 products to a room → Hub shows locked steps disabled → complete greens → Installation enabled.
Keep all existing suites green.

## H6 Monitoring — confirm it is running (reply with the time of the last successful run).
