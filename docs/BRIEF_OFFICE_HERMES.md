# Brief v2 for Hermes — Office mode: reports, demo data, tests, monitoring

Read first: `docs/SPEC.md` §10, `docs/AGENTS.md`, `docs/GIT_WORKFLOW.md`. Backend for office mode is live; Antigravity builds the UI in parallel.

## H7 Office-mode demo data (start now)
Update `scripts/seed-demo.ts`: keep "Demo – Shah Residence"; add a second project "Demo – Mehta Villa" (1 floor, 5 rooms) built **only through
`add_room_dependencies` and `set_item_status`** (the office path), with ~15 items: mix of pending (some reminded 1–7 times), done and N.A.,
notes on a few, item_events history. Idempotent, deletes/recreates only projects named "Demo – …".
- [ ] Hub shows two tiles with realistic counts.

## H8 Portfolio PDF for Vipul (start now)
`GET /api/reports/pending.pdf` (new route, you own `app/api/reports/**`): every pending item across all projects the user can see,
grouped project → agency, with floor – room, dependency, raised date, days open, reminder #, escalation level, note. Cover line:
totals per project. Reuse `lib/pdf/`. Same auth as the existing PDF route.
- [ ] 3 projects × 100 items renders in < 4 s; Devanagari text OK.

## H9 Follow-up wording check (start now)
Office reminders use `occasion: 'follow_up'` (“As of <date> … still pending”). Render one L1 and one L3 follow-up email in Gmail web + Android
and attach screenshots to the PR (evidence goes in the PR, not a separate branch).

## H10 End-to-end tests for office mode (start when Antigravity's first office PR is merged)
API-level (`e2e/office.e2e.ts`): add_room_dependencies (master + custom, idempotent), set_item_status with note → item_events, on-the-go pending
add, reminders endpoint with itemIds → exactly one email + one WhatsApp draft containing only those items → send dryrun + confirm → counts +1,
follow-up wording, access isolation for an unassigned PM.
Browser (`e2e/office.browser.e2e.ts`, PM lead login): wizard has 1 floor by default → room picker adds 5 master + 1 custom → Hub marks
Pending with note + photo → reload shows them → "+ Add dependency" from Pending list as pending → select 2 items → Send reminders → review & send
→ confirm. Keep the existing classic specs green.
- [ ] Both suites green against a local production build; teardown leaves Demo data as seeded.

## H6 Monitoring (still open — start now)
Daily 09:00 IST: Vercel runtime errors (24 h), production deployment READY, `/login` 200, one Supabase read (also keeps the free project awake).
Mondays: weekly-digest run 200. Weekly: DB/storage vs free limits, warn at 70%. Telegram Hansal only on failure.

## Ownership additions
You also own `app/api/reports/**` and `e2e/**` (all of it). Don't edit UI files; ask Antigravity via the PR description.
