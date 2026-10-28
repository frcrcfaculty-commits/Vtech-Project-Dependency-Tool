#!/usr/bin/env bash
# Runs schema + RLS tests against a throwaway local Postgres (PG 15+).
# Usage: PGHOST=/var/tmp PGPORT=54329 PGUSER=postgres npm run test:sql
set -euo pipefail
DB=vtech_test_$$
OUT=$(mktemp)
psql -v ON_ERROR_STOP=1 -q -c "create database $DB"
trap 'psql -q -c "drop database if exists $DB"; rm -f "$OUT"' EXIT
for f in tests/sql/00_supabase_stub.sql supabase/migrations/0001_init.sql supabase/migrations/0003_admin_create_user.sql supabase/migrations/0004_no_service_key.sql supabase/migrations/0005_project_creator_visibility.sql supabase/seed/seed.sql tests/sql/10_behaviour_test.sql; do
  if ! psql -v ON_ERROR_STOP=1 -q -d "$DB" -f "$f" >"$OUT" 2>&1; then cat "$OUT"; echo "FAILED in $f"; exit 1; fi
done
echo "$(grep -c 'ok -' "$OUT") checks passed"; tail -1 "$OUT"
