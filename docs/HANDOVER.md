# Handover — VTech Site Dependency Tracker (state on 2026-10-31)

Written by Claude (architect/reviewer until 2026-10-31) for the next lead developer. No secrets in this file — logins and keys are
in the private prompt Hansal gives you.

## 1. What it is
A web app for **VTech Technologies** (owner Vipul Shah, Jogeshwari, Mumbai; home automation / AV integrator). One **PM lead in the office**
sets up each client project, places the **products VTech sells** in each room, and moves every product through its **steps**. Each step
waits on someone: an **external agency** (electrician, painter, carpenter, curtain/AC vendor, network agency, architect), the **internal
VTech team** (Installers, Programmers, Project Managers) or the **client**. The PM lead sends grouped reminders by email/WhatsApp,
escalates by reminder count, and Vipul gets a weekly digest and PDFs.

## 2. Where everything is
| Thing | Where |
|---|---|
| Code | https://github.com/frcrcfaculty-commits/Vtech-Project-Dependency-Tool (branch `main` = production) |
| Live app | https://vtech-dependency-tracker.vercel.app |
| Hosting | Vercel team `hansalpersonalai-7040s-projects`, project `vtech-dependency-tracker` (id `prj_ZzgZRtZMfCVdxbzINYW2aYaYc5w0`), region bom1, **free (Hobby) plan**, auto-deploys every push to `main` |
| Database/Auth/Storage | Supabase project `vtech-dependency-tracker`, ref `jqjoxlunlbmwyxowvkyf`, Mumbai, **free plan** — dashboard https://supabase.com/dashboard/project/jqjoxlunlbmwyxowvkyf |
| SQL editor (apply migrations) | https://supabase.com/dashboard/project/jqjoxlunlbmwyxowvkyf/sql/new |
| Product catalogue source | Google Sheet "Ashutosh Project Status", tab **"Hansal"** — https://docs.google.com/spreadsheets/d/1yWx6z6mkbqic78XTSxXg8Oe3wcD-CMYQ1J9dX6Omv08 |
| Original dependency sheet (v1/v2 master list) | https://docs.google.com/spreadsheets/d/1QqYLHk7jyGu6fF9Jyoa8x46R7U3HGiqHFvtywIoDce4 |
| Archive of everything before the 2026-10-31 cleanup | branch `archive/all-workflows-2026-10-31` (v1 site visit, v2 office + 78-item master list, v3 products) |
| Specs | `docs/SPEC.md` (§1–9 v1, §10 office mode v2, **§11 product tracking v3 = current**) |
| Agent rules | `AGENTS.md`, `docs/AGENTS.md`, `docs/GIT_WORKFLOW.md` |

## 3. Stack
Next.js 16 (App Router, React 19, Tailwind 4) · `@supabase/ssr` · Supabase Postgres 17 with **RLS doing all access control** ·
Vercel functions + Vercel Cron (Mondays 02:30 UTC weekly digest) · pdf-lib for PDFs · Vitest (unit) · SQL tests on local Postgres ·
Playwright e2e (`e2e/`, run manually against a local prod build or preview) · GitHub Actions CI on every PR/push: typecheck, unit, SQL, build.

**The deployed app holds no service-role key.** Privileged actions are narrow SECURITY DEFINER functions:
`create_app_user` (role rules enforced in DB), `management_contacts`, `cron_digest_data` (gated by `app_secrets.cron_secret`).

## 4. Data model (current, v3)
- `profiles` (role `super_admin` | `pm_lead` | `pm`), `projects`, `project_members`, `floors`, `rooms`
- `agency_types` (`internal` boolean), `agencies` (per project), `agency_contacts` (level 1–3 for escalation)
- `product_catalogue` (27) + `product_steps` (163; `phase`, `responsibility`, `gate`, `default_agency_type_id`, `sheet_colour`)
- `room_products` (a product + location placed in a room) → its steps become `dependency_items` rows (`room_product_id`, `step_id`)
- view **`item_gate`** — per item `locked` and `waits_on_client`. **The only source of lock state.**
- `item_events` (history), `site_visits` (`kind` site|office; office = reminder rounds), `dispatches` + `dispatch_items` (drafted/sent messages)
- Legacy, still in the DB: `master_dependencies` (78), `project_dependencies` without `step_id`, `visit_checks`

**Gating rule (Vipul):** per placed product, all green steps are open together; every other colour stays locked until every green step
of that product is Done or N.A., then all of them open at once. `set_item_status` refuses Pending/Done on a locked step; N.A. always allowed.

**Who gets chased:** external agency → reminder; internal team → reminder with `[Internal]` subject, no agency terms footer; any item whose
agency type is **Client** → never sent, shown under "Waiting on client" and in `/api/reports/client-pending.pdf`.

## 5. Migrations (all applied to live)
`0001_init` · `0002_storage` · `0003_admin_create_user` · `0004_no_service_key` · `0005_project_creator_visibility` · `0006_office_mode` ·
`0007_product_tracking` (+ `supabase/seed/catalogue.sql`, applied by hand in the SQL editor) · `0008_project_delete_rights`
(**applied live from PR #32 — make sure PR #32 is merged so the code matches**).
New schema change = new numbered file, tested with `npm run test:sql`, applied in the SQL editor, then merged. Never edit an applied migration.

## 6. Re-extracting the catalogue when VTech edits the sheet
1. Sheet → File → Download → Microsoft Excel (.xlsx).
2. `pip install openpyxl && python3 scripts/extract-catalogue.py <file.xlsx>` (stops on an unknown colour — ask VTech what it means).
3. `node scripts/gen-catalogue.mjs` → `supabase/seed/catalogue.sql`. Review the CSV diff with Hansal.
4. Inserts are `on conflict do nothing`: **changed labels or steps of existing products need an UPDATE migration**, not a re-run.
   Already-placed products keep their old steps; only new placements use the new chain.

## 7. Commands
```
npm ci
npm run dev                 # local, needs .env.local
npm run typecheck && npm test && npm run build
PGHOST=... PGPORT=... PGUSER=postgres npm run test:sql   # needs local Postgres 15+
npx playwright test -c e2e/playwright.config.ts          # e2e, see e2e/README.md
```

## 8. Review checklist (lessons from this project)
1. Never embed Supabase tables with `alias:column(...)` hints — `dependency_items` FKs are composite `(col, project_id)` and PostgREST
   returns PGRST200. Embed by table name (`rooms(name, floors(label))`).
2. Lock state only from `item_gate`; never recompute gating in the browser.
3. Insert-then-return on `projects` relies on 0005 (creator can see own row).
4. Escalation level: `reminder_count > l2_after` → L2, `> l3_after` → L3 (`lib/escalation.ts`); UI must match.
5. Free tiers: Supabase pauses after 7 idle days (the Monitor workflow in PR #32 pings daily); Vercel Hobby keeps 1 h of logs.
6. Merge only on green CI. Agents (Antigravity = UI, Hermes = tests/PDF/seed) self-merge their own PRs; the lead reviews afterwards by
   merging all branches locally, running every check, and clicking through the live site as the PM lead at 1280px and 390px.

## 9. Open items on 2026-10-31
- **PR #32** (glass theme + logo, project delete limited to Vipul/Hansal, H13 product e2e, H6 monitor, IST date fix): CI green, reviewed
  by Claude, combined with main passes all checks; its migration 0008 is already live. **Merge it before any other UI work.**
- **Cleanup to v3 only** (Antigravity, `PROMPT_V4_CLEANUP`): remove v1/v2 screens from the live app; code stays on the archive branch.
- Hermes PR #30 (H13) is an empty draft — superseded by PR #32's e2e; close it.
- Email still opens Gmail drafts (`EMAIL_MODE=compose_link`) until a vtechpl.com Workspace admin grants domain-wide delegation
  (scope `https://www.googleapis.com/auth/gmail.send`) to a service account; then set `EMAIL_MODE=gmail_api`, `GOOGLE_SERVICE_ACCOUNT_JSON`,
  `DIGEST_SENDER_EMAIL` in Vercel. The weekly digest is not emailed until then.
- WhatsApp is tap-to-send (`WHATSAPP_MODE=link`). Meta Cloud API path exists (`docs/whatsapp-template.md`), decision pending on cost.
- Defaults VTech hasn't confirmed: "Delivery pending client / VTECH" → Client agency; blue lighting partial/complete installation →
  Electrician; Fabric installation's light-blue treated as blue; Wi-Fi locations extended.
- Vipul should change his initial password. Move to Vercel Pro + Supabase Pro once VTech uses it commercially.
