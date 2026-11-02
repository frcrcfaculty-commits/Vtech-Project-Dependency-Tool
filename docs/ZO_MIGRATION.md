# Moving hosting from Vercel to Zo Computer

Status (2026-11-02): Live on Zo Computer at https://vtech-hansal.zocomputer.io. Testing auto-deploy.

## 1. What moves and what stays (decision)
| Piece | Before | After | Why |
|---|---|---|---|
| App hosting (Next.js server) | Vercel Hobby | **Zo Computer, one Service** | This is what Zo is for. The app is a standard Next.js server, so nothing in the code is Vercel-only. |
| Auto-deploy on push to `main` | Vercel Git integration | `scripts/zo/run.sh` polls `main` every 5 min, builds in a separate folder, and swaps in only on success | No inbound webhook needed. A broken commit never takes the site down. |
| Weekly digest cron (Mon 08:00 IST) | Vercel Cron (`vercel.json`) | `scripts/zo/run.sh` calls `/api/cron/weekly-digest` once each Monday | Same endpoint, same `CRON_SECRET`. |
| Code | GitHub | **GitHub (unchanged)** | Zo is not a git host. GitHub keeps the history, PRs, CI and the daily monitor. |
| Database, logins, photo storage | Supabase | **Supabase (unchanged)** | See below. |
| Backups | none (Supabase free has no backups) | optional daily `pg_dump` onto the Zo disk (14 days kept) | New. Needs the DB connection string in `zo.env`. |

**Why the database stays on Supabase.** Supabase is not only Postgres. The app relies on:
- Supabase Auth for every sign-in and password change;
- Row Level Security, with 39 policies built on `auth.uid()`;
- PostgREST for every query, plus 28 SQL functions called as RPC;
- Supabase Storage for the evidence photos.

Taking the database off Supabase means one of two things:
- **Self-hosting the Supabase stack** (about 10 Docker containers). That is more than the single service Zo Basic includes, and you would then own patching and backups.
- **Rewriting auth, the data layer and storage.** That takes weeks and carries real risk.

The gain from either would be zero cost, because Supabase is already free at this size (14 MB, 6 users). If that ever changes, the daily `pg_dump` here is the starting point for a move.

## 2. What is in the repo for this
- `scripts/zo/run.sh` is the whole Zo service:
  - serves the app and restarts it if it dies;
  - auto-deploys new commits on `main`;
  - runs the Monday digest;
  - takes the optional daily backup;
  - logs to `~/vtech/logs/`.

  Tested on Linux for: first build; auto-redeploy; a broken commit (rejected, old version keeps serving, no retry loop); an app crash (back within 30 s); the supervisor being killed and restarted (no stale server left); the Monday trigger.
- `scripts/zo/zo.env.example` is the template for `~/vtech/zo.env` (secrets, kept on Zo only).
- `app/api/health` returns `{"ok":true,"sha":"<commit>"}`, so you can see which commit is live.

## 3. One-time setup on Zo (terminal on the Zo machine)
```bash
node -v      # must be 20.9 or newer (CI uses 22). If missing or old, install Node 22.
git --version
mkdir -p ~/vtech && git clone https://github.com/frcrcfaculty-commits/Vtech-Project-Dependency-Tool.git ~/vtech/repo
cp ~/vtech/repo/scripts/zo/zo.env.example ~/vtech/zo.env && chmod 600 ~/vtech/zo.env
```
Fill `~/vtech/zo.env`:
- `NEXT_PUBLIC_SUPABASE_ANON_KEY`: Supabase → Project settings → API → anon public key.
- `CRON_SECRET`: Supabase SQL editor → `select value from app_secrets where key = 'cron_secret';`
- `NEXT_PUBLIC_LOGO_URL`: set it once the Zo URL is known (section 4). Saving the file triggers a rebuild within 5 minutes.
- Optional `SUPABASE_DB_URL`: Supabase → Connect → Session pooler URI, with the DB password. Backups also need `pg_dump` version 17 (`sudo apt-get install -y postgresql-client-17`, or the PGDG repo).

If the repo is private, cloning needs a GitHub token. Use a fine-grained token with read-only Contents on this one repo:
`git clone https://<token>@github.com/...`.

## 4. Create the Zo Service
In Zo → Hosting → **Services** → new service:
- **Name:** `vtech` (it becomes part of the URL).
- **Command / entrypoint:** `bash /root/vtech/repo/scripts/zo/run.sh`. Use the real home path: `echo $HOME`.
- **Port:** `3000`. If Zo assigns a port, put the same number in `PORT=` in `zo.env`.
- **Visibility: Public.** PMs sign in with their own app accounts, so the URL must open without a Zo login. The URL will look like `vtech-<handle>.zocomputer.io`.

The first start runs `npm ci` and a build (about 1–2 minutes), then serves. The script only fetches from git and never checks files out into `~/vtech/repo`, so the running script never changes under itself. Updates go into `~/vtech/releases/`.

## 5. Verify, then cut over
1. `curl https://<zo-url>/api/health` returns 200 and the latest `main` commit.
2. `/login` loads with the VTech logo. Sign in, open a project, mark a step ✓ and then back.
3. `curl https://<zo-url>/api/cron/weekly-digest` (without a secret) returns 401.
4. Set `NEXT_PUBLIC_LOGO_URL=https://<zo-url>/vtech-logo-email.png` in `zo.env`. Within about 5 minutes the log shows a rebuild.
5. Optional full check from a laptop: `E2E_BASE_URL=https://<zo-url> npx playwright test -c e2e/playwright.config.ts` (see `e2e/README.md`).
6. Open one PR (on a branch, never straight to `main`) that:
   - sets repo variable `APP_URL` to the Zo URL, or edits the default in `.github/workflows/monitor.yml`;
   - replaces `vercel.json` with a permanent redirect from the old Vercel URL to the Zo URL (below). This also removes the Vercel cron, so the digest cannot run twice;
   - updates the Live app and Hosting rows in `docs/HANDOVER.md`, step 2 of `README.md`, and the Stack line in `docs/SPEC.md`.
   ```json
   { "$schema": "https://openapi.vercel.sh/vercel.json",
     "redirects": [{ "source": "/(.*)", "destination": "https://<zo-url>/$1", "permanent": true }] }
   ```
7. Tell Vipul and the PMs the new link. Old bookmarks keep working through the redirect.

**Rollback:** revert that PR. Vercel serves the app again within a minute, because it still auto-deploys `main`.
After about 2 weeks on Zo with no problems, Vercel can stay as the free redirect forever or be deleted (old links then stop working).

## 6. Day-to-day on Zo
- **Logs:** `~/vtech/logs/app.log` (app), `build-<sha>.log` (each deploy), the service output (supervisor), `backup.log`.
- **Deploy:** merge to `main`. It goes live within about 5 minutes; check with `/api/health`.
- **Force a redeploy or env change:** edit `~/vtech/zo.env`. The rebuild happens on the next poll, or restart the service.
- **Restore a backup:** `pg_restore --clean --if-exists --no-owner -d "$SUPABASE_DB_URL" ~/vtech/backups/vtech-YYYY-MM-DD.dump`. Test this on a scratch Supabase project first.
- **Custom domain** (e.g. `tracker.vtechpl.com`): add it in Zo hosting settings if your plan allows, point DNS as Zo says, then update `NEXT_PUBLIC_LOGO_URL` and the Vercel redirect.
