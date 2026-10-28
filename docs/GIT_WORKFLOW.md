# Git workflow — how we stop losing work

Repo: https://github.com/frcrcfaculty-commits/Vtech-Project-Dependency-Tool
GitHub is the only source of truth. Work that is not pushed does not exist.

## Rules (every agent, every human)
1. **Always work in a fresh clone of this repo.** Never in a downloaded zip, a copied folder, or an agent's scratch directory.
2. **One branch per agent per task**, named `<agent>/<task>`: `antigravity/s5-site-visit`, `hermes/h2-pdf`, `claude/fix-x`.
   Never commit to `main` directly.
3. **Push early, push often.** First push within 10 minutes of starting a task. After that, commit and push
   **at every working step and at least every 30 minutes** — `git add -A && git commit -m "wip: …" && git push`.
   WIP commits are fine; we squash on merge.
4. **Open a Draft PR on the first push.** It shows everyone what's in flight and keeps a remote copy.
5. **Before you start each session:** `git fetch origin && git rebase origin/main` on your branch.
6. **Never** `git push --force` to `main`, never `git reset --hard` on work you haven't pushed, never delete a branch someone else made.
   If you must rewrite your own branch, use `git push --force-with-lease`.
7. **End of session = everything pushed.** Run `git status` — it must say "nothing to commit" and "up to date with origin".
8. **Secrets never go in git** (`.env*` is ignored). Credentials live in Vercel env vars and the private prompt files.
9. A PR merges only when **CI is green** (typecheck, unit tests, SQL tests, build) and **Claude has reviewed it**.

## Setup for a new machine/agent
```bash
git clone https://github.com/frcrcfaculty-commits/Vtech-Project-Dependency-Tool.git vtech
cd vtech && npm ci
git checkout -b <agent>/<task> && git push -u origin HEAD
```

## Repo settings (owner: Hansal, one-time)
Settings → Branches → Add rule for `main`: require a pull request, require status check **CI / check**, block force pushes, block deletion.
