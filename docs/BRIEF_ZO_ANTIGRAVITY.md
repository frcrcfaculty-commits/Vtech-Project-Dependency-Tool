# Brief: finish moving the VTech tracker's hosting to Zo Computer (Antigravity)

You are finishing a hosting move for the VTech Site Dependency Tracker: a Next.js 16 app with a Supabase database. The code is in
GitHub `frcrcfaculty-commits/Vtech-Project-Dependency-Tool`, it is live today on Vercel at https://vtech-dependency-tracker.vercel.app,
and it is moving to Hansal's **Zo Computer (Basic plan)**. Everything that could be prepared without access to the Zo machine is already merged
to `main`. Your job is the part that has to happen on Zo, then the cutover.

## Read first
1. `docs/ZO_MIGRATION.md`: the runbook. Follow sections 3 → 5 in order. It also explains what moves and what stays.
2. `scripts/zo/run.sh`: the single Zo service (serve, auto-deploy from `main`, Monday digest, optional daily backup). Don't rewrite it.
   If something on Zo really requires a change, make the smallest fix on a branch, open a PR, and say why.
3. `AGENTS.md` and `docs/GIT_WORKFLOW.md`: never push to `main`; branch, then PR.

## Fixed decisions (don't reopen)
- **Only the hosting moves.** Supabase stays as the database, logins and photo storage, and GitHub stays as the code host.
  Don't migrate the database, don't run Postgres on Zo, and don't change any Supabase schema.
- One Zo **Service**, set to **public** (users sign in with their app accounts), running `bash <home>/vtech/repo/scripts/zo/run.sh`.
- Secrets live only in `~/vtech/zo.env` on Zo (chmod 600). Never commit them, never paste them into PRs, issues or logs.

## Steps
1. Get a terminal on the Zo machine: Zo's own terminal or SSH, whichever Hansal has set up. If you can't get one, ask Hansal to open
   the Zo terminal and run the commands from runbook §3 for you, then continue from there.
2. Runbook §3: check Node ≥ 20.9 (install 22 if needed), clone to `~/vtech/repo`, and create `~/vtech/zo.env` from the example.
   Values you need:
   - `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase dashboard → project `jqjoxlunlbmwyxowvkyf` → Settings → API → anon key. It is public by design.
   - `CRON_SECRET`: Supabase SQL editor → `select value from app_secrets where key = 'cron_secret';`
   - Backups (`SUPABASE_DB_URL` + `pg_dump` 17): set them up if Hansal gives you the DB password. Otherwise leave them empty and say so in your report.
3. Runbook §4: create the Zo Service. Check Zo's current docs on creating a service (name, command, port, public visibility),
   because the exact UI may differ from the runbook. Watch the service output until it logs `app started`.
4. Runbook §5 checks 1–4: health returns the current `main` commit, `/login` renders, the digest without a secret returns 401, and
   `NEXT_PUBLIC_LOGO_URL` is set to the Zo URL and a rebuild has happened. Then a manual sign-in smoke test. Use the e2e lead account from
   `e2e/README.md` if Hansal gives you its password, never a real user's account.
   Optional: the Playwright suite with `E2E_BASE_URL=<zo-url>` and `EMAIL_MODE=dryrun` semantics (see `e2e/README.md`). Afterwards delete any
   `TEST – e2e…` projects it leaves behind.
5. Test auto-deploy for real: on a branch, make a harmless change (for example one line in `docs/ZO_MIGRATION.md` recording the Zo URL and today's
   date), open a PR, and let Hansal merge it, or merge it yourself if he has told you that you may. Then confirm `/api/health` shows the new commit within about 6 minutes.
6. Cutover PR (runbook §5.6), only after steps 4–5 pass:
   - replace `vercel.json` with the redirect to the Zo URL (this also removes the Vercel cron);
   - point the monitor at Zo: set repo variable `APP_URL` if you can, otherwise change the default in `.github/workflows/monitor.yml`;
   - update `docs/HANDOVER.md` (Live app, Hosting rows, the "Vercel functions + Vercel Cron" stack line), `README.md` step 2 and `docs/SPEC.md` §Stack.
   Hansal merges it. Then confirm that the old Vercel URL redirects (301/308) to Zo and that GitHub Actions → Monitor → "Run workflow" is green.
7. Don't delete the Vercel project. It stays as the redirect and the rollback (revert the cutover PR).

## Report back to Hansal (short)
- the Zo URL, and the commit `/api/health` shows;
- each check from step 4 with pass or fail;
- whether auto-deploy was confirmed, and the PR links;
- whether daily backups are on, and if not, exactly what is missing;
- anything you had to change in `scripts/zo/run.sh`, and why.
