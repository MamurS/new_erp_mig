#!/bin/sh
# Applies supabase/migrations/*.sql in name order, each file once, in its own transaction, and records it in
# supabase_migrations.schema_migrations — the table `supabase db push` uses, so either tool can continue after the
# other. Runs in the `migrate` service of deploy/docker-compose.yml (postgres client image, PG* variables):
#
#   docker compose run --rm migrate            # apply what is pending (also runs by itself before `api` starts)
#   docker compose run --rm migrate --status   # list applied and pending, change nothing
#
# A failed file rolls back alone and stops the run (exit 1); the files after it are not tried. Migrations are never
# edited after they reached an environment: a fix is a new file (npm run db:gen, docs/backend/DATABASE.md).
# Demo data is NOT loaded here: staging gets it from the API's demo reset (deploy/scripts/deploy.sh), production never.
set -eu

DIR=${MIGRATIONS_DIR:-/migrations}
MODE=${1:-apply}
PSQL="psql -X -q -v ON_ERROR_STOP=1"

$PSQL <<'SQL'
create schema if not exists supabase_migrations;
create table if not exists supabase_migrations.schema_migrations (version text primary key, statements text[], name text);
SQL

applied=$($PSQL -At -c "select version from supabase_migrations.schema_migrations order by version")
pending=0
failed=0
for f in $(ls "$DIR"/*.sql | sort); do
  base=$(basename "$f" .sql)
  version=${base%%_*}
  name=${base#*_}
  if printf '%s\n' "$applied" | grep -qx "$version"; then
    [ "$MODE" = "--status" ] && echo "applied  $base"
    continue
  fi
  pending=$((pending + 1))
  if [ "$MODE" = "--status" ]; then
    echo "pending  $base"
    continue
  fi
  echo "applying $base"
  if ! $PSQL --single-transaction -f "$f" \
    -c "insert into supabase_migrations.schema_migrations (version, name, statements) values ('$version', '$name', array[]::text[])"; then
    echo "FAILED   $base (rolled back; later migrations not applied)" >&2
    failed=1
    break
  fi
done

if [ "$MODE" = "--status" ]; then
  echo "$pending pending"
elif [ "$failed" = 0 ]; then
  echo "migrations: $pending applied, database up to date"
fi
exit "$failed"
