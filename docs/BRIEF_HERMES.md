# Brief for Hermes — notifications polish, PDF, demo data, QA, monitoring

Read docs/SPEC.md and docs/AGENTS.md. Work only in the paths you own. Each task = one PR.

## H1 Email template polish
Improve the HTML inside `buildAgencyReport` in `lib/report.ts` (only the HTML string).
- Keep: function signature, all data shown, escaping via `esc()`, and `tests/report.test.ts` green.
- Add optional VTech logo via `process.env.NEXT_PUBLIC_LOGO_URL` (skip the img if unset).
- Must render cleanly in Gmail web, Gmail Android, and Outlook desktop (table layout, inline styles only, no web fonts).
- Acceptance: screenshots from all three clients in the PR, for an L1 and an L3 email.

## H2 PDF of pending items (Specimen format)
`GET /api/projects/[projectId]/report.pdf?agency=<optional>` → PDF matching the Specimen sheet: No · Room (Floor – Room) · Agency · Dependency · First raised · Reminder #, grouped by agency, Terms at the bottom.
- Use `pdf-lib` (pure JS, works on Vercel). Put helpers in `lib/pdf/`. Auth with `requireUser()` from `lib/auth.ts` (RLS applies).
- Acceptance: a 150-row report renders in < 3 s on a preview deploy; Hindi/Marathi room names don't crash it (embed a Unicode font).

## H3 WhatsApp Business template (for when VTech decides on the paid API)
Write `docs/whatsapp-template.md`: a utility-category template named `site_dependency_reminder`, language `en`, with exactly one body variable `{{1}}` that receives the item list (see `sendMetaTemplate` in `lib/channels/whatsapp.ts` — newlines are flattened to " | "). Include sample values and the submission steps in Meta Business Manager.
Also research and table the current Meta per-message price for India utility templates, with source links and date checked.

## H4 Demo data
`scripts/seed-demo.ts` (run with `npx tsx --env-file=.env.local scripts/seed-demo.ts`): creates project "Demo – Shah Residence" mirroring the Specimen sheet — 12th, 13th, 14th floors, the rooms named there, agencies Electrician / Carpenter / Curtain Vendor / Painter / VTech / Wallpaper Vendor with 2–3 contacts each at levels 1–3, ~40 pending items, one finalized visit. Use the service-role key; idempotent (delete + recreate the demo project only).

## H5 End-to-end tests
Playwright in `e2e/`, run against a Vercel preview URL (`E2E_BASE_URL`), with `EMAIL_MODE=dryrun`.
Cover: sign in → create project via wizard → copy floor → visit (mark pending/done/na, one photo) → finalize → drafts exist per agency → send email (dryrun) → confirm WhatsApp → reminder counts = 1 → second visit → counts = 2 → set `l2_after=1` → third visit draft shows L2 recipients.
Also: a PM not assigned to the project gets an empty list and a 404/empty response on its visit.
This is the only test that exercises the real Supabase REST layer — it matters.

## H6 Monitoring (after first production deploy)
Daily 09:00 IST: check Vercel runtime errors (last 24 h) and whether Monday's cron returned 200; message Hansal on Telegram only if something failed. Weekly: Supabase database size and storage usage.

## Done means
Each PR: assumptions at top, acceptance evidence attached, `npm run typecheck && npm test && npm run build` green.
