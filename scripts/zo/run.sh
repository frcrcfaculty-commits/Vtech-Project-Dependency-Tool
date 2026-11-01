#!/usr/bin/env bash
# The one long-running Zo service for the VTech tracker. It replaces what Vercel did:
#   1. Serves the app (next start) and restarts it if it dies.
#   2. Auto-deploys: every POLL_SECONDS checks origin/$BRANCH; a new commit is built in its own folder and only
#      swapped in when the build succeeds, so a broken commit never takes the site down.
#   3. Weekly digest cron: Mondays 08:00 IST (02:30 UTC) calls /api/cron/weekly-digest once.
#   4. Optional daily database backup (pg_dump) when SUPABASE_DB_URL is set.
# Layout under $VTECH_HOME (default ~/vtech): repo/ (git clone), releases/<sha>/, current -> releases/<sha>,
# zo.env (secrets), state/, logs/, backups/.
set -uo pipefail

VTECH_HOME="${VTECH_HOME:-$HOME/vtech}"
REPO_URL="${REPO_URL:-https://github.com/frcrcfaculty-commits/Vtech-Project-Dependency-Tool.git}"
ENV_FILE="$VTECH_HOME/zo.env"
mkdir -p "$VTECH_HOME"/{releases,state,logs,backups}
log() { echo "[vtech $(date -u +%FT%TZ)] $*" >&2; }

load_env() {
  [ -f "$ENV_FILE" ] || { log "missing $ENV_FILE (copy scripts/zo/zo.env.example)"; exit 1; }
  set -a; . "$ENV_FILE"; set +a
  PORT="${PORT:-3000}"; BRANCH="${BRANCH:-main}"; POLL_SECONDS="${POLL_SECONDS:-300}"
  export NODE_ENV=production NEXT_TELEMETRY_DISABLED=1
}
load_env
env_hash() { sha256sum "$ENV_FILE" | cut -c1-12; }

[ -d "$VTECH_HOME/repo/.git" ] || git clone --quiet "$REPO_URL" "$VTECH_HOME/repo"

# Build commit $1 into releases/<sha>-<envhash>. Prints the release dir on success.
build_release() {
  local sha="$1" dir="$VTECH_HOME/releases/$1-$(env_hash)"
  if [ -f "$dir/.ok" ]; then echo "$dir"; return 0; fi
  [ -f "$VTECH_HOME/state/failed-$(basename "$dir")" ] && return 1   # don't retry a broken commit every poll
  rm -rf "$dir"
  git -C "$VTECH_HOME/repo" worktree prune
  git -C "$VTECH_HOME/repo" worktree add --quiet --detach "$dir" "$sha" || return 1
  log "building $sha"
  if (cd "$dir" && npm ci --include=dev --no-audit --no-fund && npm run build) > "$VTECH_HOME/logs/build-$sha.log" 2>&1; then
    touch "$dir/.ok"; echo "$dir"
  else
    log "build FAILED for $sha (see logs/build-$sha.log); keeping the current release"
    touch "$VTECH_HOME/state/failed-$(basename "$dir")"
    git -C "$VTECH_HOME/repo" worktree remove --force "$dir" 2>/dev/null || rm -rf "$dir"
    return 1
  fi
}

APP_PID=""
start_app() {
  local dir; dir="$(readlink -f "$VTECH_HOME/current")"
  export GIT_SHA="$(basename "$dir" | cut -d- -f1)"
  # Own process group, so stopping it also stops the next-server child it forks.
  setsid bash -c "cd '$dir' && exec node_modules/.bin/next start -p '$PORT'" >> "$VTECH_HOME/logs/app.log" 2>&1 &
  APP_PID=$!
  echo "$APP_PID" > "$VTECH_HOME/state/app.pgid"
  log "app started (pid $APP_PID, $GIT_SHA, port $PORT)"
}
stop_app() {
  local pg="${APP_PID:-$(cat "$VTECH_HOME/state/app.pgid" 2>/dev/null)}"
  if [ -n "$pg" ]; then
    kill -TERM -- "-$pg" 2>/dev/null
    for _ in $(seq 1 20); do kill -0 -- "-$pg" 2>/dev/null || break; sleep 0.5; done
    kill -KILL -- "-$pg" 2>/dev/null
  fi
  rm -f "$VTECH_HOME/state/app.pgid"; APP_PID=""
}
trap 'stop_app; exit 0' TERM INT

deploy_if_new() {
  git -C "$VTECH_HOME/repo" fetch --quiet origin "$BRANCH" || { log "git fetch failed"; return; }
  local sha cur dir
  sha="$(git -C "$VTECH_HOME/repo" rev-parse --short=12 "origin/$BRANCH")"
  cur="$(basename "$(readlink -f "$VTECH_HOME/current" 2>/dev/null || echo none)")"
  [ "$cur" = "$sha-$(env_hash)" ] && return
  dir="$(build_release "$sha")" || return
  ln -sfn "$dir" "$VTECH_HOME/current.new" && mv -T "$VTECH_HOME/current.new" "$VTECH_HOME/current"
  log "deploying $sha"
  stop_app; start_app
  # keep the 3 newest releases
  ls -1dt "$VTECH_HOME"/releases/*/ | tail -n +4 | while read -r old; do
    [ "$(readlink -f "$VTECH_HOME/current")/" = "$old" ] || { git -C "$VTECH_HOME/repo" worktree remove --force "$old" 2>/dev/null || rm -rf "$old"; }
  done
}

weekly_digest() {
  # Monday, 02:30–02:59 UTC, once per date
  [ "$(date -u +%u)" = 1 ] || return
  local hm; hm="$(date -u +%H%M)"; [ "$hm" -ge 0230 ] && [ "$hm" -le 0259 ] || return
  local today; today="$(date -u +%F)"
  [ "$(cat "$VTECH_HOME/state/digest" 2>/dev/null)" = "$today" ] && return
  local last; last="$(cat "$VTECH_HOME/state/digest-attempt" 2>/dev/null || echo 0)"
  [ $(( $(date +%s) - last )) -ge 300 ] || return   # on failure, retry every 5 minutes, not every loop
  date +%s > "$VTECH_HOME/state/digest-attempt"
  local out; out="$(curl -s -w ' %{http_code}' -H "Authorization: Bearer $CRON_SECRET" "http://127.0.0.1:$PORT/api/cron/weekly-digest")"
  log "weekly digest: $out"
  case "$out" in *' 200') echo "$today" > "$VTECH_HOME/state/digest" ;; esac
}

daily_backup() {
  [ -n "${SUPABASE_DB_URL:-}" ] || return
  local today; today="$(date -u +%F)"
  [ "$(cat "$VTECH_HOME/state/backup" 2>/dev/null)" = "$today" ] && return
  [ "$(date -u +%H)" -ge 21 ] || return   # 02:30 IST onwards, quiet hours
  command -v pg_dump >/dev/null || { log "backup skipped: pg_dump not installed"; echo "$today" > "$VTECH_HOME/state/backup"; return; }
  local f="$VTECH_HOME/backups/vtech-$today.dump"
  if pg_dump --format=custom --no-owner --no-privileges --schema=public --schema=auth --schema=storage \
       -f "$f.tmp" "$SUPABASE_DB_URL" 2>> "$VTECH_HOME/logs/backup.log"; then
    mv "$f.tmp" "$f"; echo "$today" > "$VTECH_HOME/state/backup"; log "backup ok: $(du -h "$f" | cut -f1)"
    ls -1t "$VTECH_HOME"/backups/vtech-*.dump | tail -n +15 | xargs -r rm -f
  else
    rm -f "$f.tmp"; log "backup FAILED (see logs/backup.log)"
  fi
}

# First start: build whatever is on the branch now.
if [ ! -e "$VTECH_HOME/current" ]; then
  git -C "$VTECH_HOME/repo" fetch --quiet origin "$BRANCH"
  dir="$(build_release "$(git -C "$VTECH_HOME/repo" rev-parse --short=12 "origin/$BRANCH")")" || { log "first build failed"; exit 1; }
  ln -sfn "$dir" "$VTECH_HOME/current"
fi
stop_app   # a server left over from a previous run of this script
start_app

last_poll=0
while true; do
  sleep 30 & wait $!
  if [ -z "$APP_PID" ] || ! kill -0 "$APP_PID" 2>/dev/null; then log "app is not running; restarting"; start_app; fi
  now=$(date +%s)
  if [ $((now - last_poll)) -ge "$POLL_SECONDS" ]; then last_poll=$now; load_env; deploy_if_new; fi
  weekly_digest
  daily_backup
done
