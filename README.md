# VTech Site Dependency Tracker

Tracks what other trades must finish before VTech can install automation, chases each agency once per visit
by email + WhatsApp, escalates by reminder count, and gives Vipul a weekly picture. Spec: `docs/SPEC.md`.

## Status
| Part | Owner | State |
|---|---|---|
| Schema, RLS, RPCs, seed (master list cleaned) | Claude | Done · 31 database checks pass |
| Escalation, report, email/WhatsApp, digest, API routes | Claude | Done · 16 unit tests pass · production build passes |
| UI (8 screens) | Antigravity | `docs/BRIEF_ANTIGRAVITY.md` |
| Email polish, PDF, WhatsApp template, demo data, e2e, monitoring | Hermes | `docs/BRIEF_HERMES.md` |

## Setup (≈ 20 minutes)
1. **Supabase**: create a project (region Mumbai `ap-south-1`). SQL editor → run in order:
   `supabase/migrations/0001_init.sql`, `0002_storage.sql`, `0003_admin_create_user.sql`, then `supabase/seed/seed.sql`.
   Auth → URL configuration → Site URL = your Vercel URL; add `<url>/login` to redirect URLs.
2. **Vercel**: import the GitHub repo. Add env vars from `.env.example` (at minimum the 3 Supabase keys and `CRON_SECRET`). Region is pinned to Mumbai (`bom1`) in `vercel.json`.
3. **First accounts**: copy `.env.example` → `.env.local`, fill Supabase keys and `BOOTSTRAP_USERS` (Vipul's real email), then `npm run bootstrap`. Each person gets an invite email.
4. **Email as the PM (optional, later)**: in Google Cloud create a service account → enable Gmail API → in Workspace Admin → Security → API controls → Domain-wide delegation, add the service account client ID with scope `https://www.googleapis.com/auth/gmail.send`. Set `EMAIL_MODE=gmail_api`, `GOOGLE_SERVICE_ACCOUNT_JSON`, `DIGEST_SENDER_EMAIL`. Until then `compose_link` opens a pre-filled Gmail draft for the PM.

## Commands
```
npm run dev         # local
npm test            # unit tests
npm run typecheck
npm run build
npm run test:sql    # schema + RLS tests (needs local Postgres 15+; set PGHOST/PGPORT/PGUSER)
npm run gen:seed    # regenerate seed.sql after editing master_dependencies.csv
```

## Rules for contributors
`docs/AGENTS.md` — file ownership, non-negotiables, review flow.
