# Rules for every agent on this repo (Claude, Antigravity/Gemini, Hermes)

Read docs/SPEC.md first. If anything here conflicts with your instinct, this file wins.

## Ownership — edit only your paths
| Agent | Owns | May read |
|---|---|---|
| Claude (architect, reviewer) | `supabase/**`, `lib/**` (except below), `app/api/**`, `proxy.ts`, `vercel.json`, `docs/SPEC.md` | everything |
| Antigravity (UI) | `app/(app)/**`, `app/login/**`, `app/page.tsx`, `app/layout.tsx`, `components/**`, `lib/client/**`, styles | everything |
| Hermes (notifications, QA) | HTML block inside `lib/report.ts` (keep signature + tests), `lib/pdf/**`, `app/api/projects/[projectId]/report/**`, `scripts/seed-demo.ts`, `e2e/**`, `app/api/reports/**`, `docs/whatsapp-template.md` | everything |

Need a change outside your paths (new column, new endpoint, changed rule)? Stop and write a request in your PR description. Claude makes it.

## Non-negotiables
1. **Never edit an existing migration.** Schema changes = new numbered file under `supabase/migrations/`, written or approved by Claude.
2. **Never use the service-role key in client code.** Browser code uses the anon key + the user's session; RLS does the access control.
3. **Escalation and recipient logic lives only in `lib/escalation.ts`.** Do not re-implement levels in UI or SQL.
4. **Nothing is sent without the PM pressing Send** on a reviewed draft.
5. All of these must pass before a PR: `npm run typecheck`, `npm test`, `npm run build`, and (Claude/Hermes) `npm run test:sql`.

## How to work (Karpathy rules)
- Think before coding: write your assumptions and the tradeoff you chose at the top of the PR.
- Simplest thing that works. No new dependency without a one-line reason in the PR.
- Surgical changes: touch only what the task needs. No drive-by refactors or reformatting.
- Goal-driven: every task has acceptance checks below; show evidence (screenshot, test output) that each one passes.

## Git (read docs/GIT_WORKFLOW.md — mandatory)
Push within 10 minutes of starting, then at least every 30 minutes. Draft PR on first push. Nothing unpushed at end of session.

## Flow
1 branch per task → PR to `main` → **CI green → the agent merges its own PR** (no human approval needed) → Claude reviews merged work afterwards and opens fix PRs if needed.
Never merge a PR whose CI is red or still running. Never merge another agent's PR.
