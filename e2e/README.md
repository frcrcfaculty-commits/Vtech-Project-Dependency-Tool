# End-to-end tests (H5)

The only tests that run the **real app against the real Supabase project**. Nothing is mocked.

## What it covers
Sign in (PM + PM lead) → create project (wizard steps) → copy floor → visit 1 (pending / done / N.A., one photo upload to the
`evidence` bucket, signed URL) → finalize via `POST /api/visits/:id/finalize` → one draft per agency per channel →
send email (`EMAIL_MODE=dryrun`) + confirm WhatsApp link → reminder counts = 1 → visit 2 → counts = 2 → `l2_after = 1` →
visit 3 drafts go To L2, CC L1, with a fallback warning for an agency that has no L2 contact.
Access: a PM not assigned to a project sees none of its rows, gets an empty dispatch list and 404/400 on its visit; after the
PM lead assigns them, the project appears. Roles: PM cannot create users; PM lead cannot create a super admin. Signed-out → 401.

The UI does wizard and visit steps as direct Supabase calls under RLS (docs/SPEC.md §5). The test does the same with the
user's own session, and drives the server steps through the app's HTTP API exactly as the UI will.
When the UI ships, add browser-level specs alongside (`*.e2e.ts`); the helpers already provide signed-in sessions.

## Run
Needs in `.env.local` (never committed): `NEXT_PUBLIC_SUPABASE_URL`, `NEXT_PUBLIC_SUPABASE_ANON_KEY`,
`SUPABASE_SERVICE_ROLE_KEY` (teardown only), `E2E_PM_EMAIL/PASSWORD`, `E2E_LEAD_EMAIL/PASSWORD`, and optionally
`VERCEL_AUTOMATION_BYPASS_SECRET` for protected preview URLs.

```bash
# against a Vercel preview (must have EMAIL_MODE=dryrun in Preview env — it does)
set -a; . ./.env.local; set +a
E2E_BASE_URL=https://<preview>.vercel.app npx playwright test -c e2e/playwright.config.ts

# against a local production build
npm run build && EMAIL_MODE=dryrun npx next start -p 3100 &
E2E_BASE_URL=http://localhost:3100 npx playwright test -c e2e/playwright.config.ts
```

## Data safety
Every project it creates is named `TEST – e2e …`. Setup and teardown delete only projects whose name starts with that
prefix (plus their evidence photos), using the service-role key. Contacts use `example.com` addresses and `+91900000xxxx`
numbers. Never point it at Vipul's account.
