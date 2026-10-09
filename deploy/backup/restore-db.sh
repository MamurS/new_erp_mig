#!/bin/sh
# Restores one backup of deploy/backup/backup.sh into a CLEAN stack and verifies it. Runs inside the `backup`
# service (postgres client image, PG* = a superuser of the target, STORAGE_DIR = the Storage volume):
#
#   docker compose --profile tools run --rm -v <backup dir>:/restore:ro backup /scripts/restore-db.sh /restore
#
# Called by deploy/backup/restore.sh (a clean server) and restore-check.sh (the monthly check). The target must
# be a fresh database of the same pinned images whose Auth and Storage services have started once (they create
# their schemas) and are stopped now. Order:
#   1. checksums of the backup;
#   2. refuses a database that already has our tables (unless RESTORE_FORCE=1);
#   3. the extensions our migrations create (pgcrypto, pg_trgm, pg_cron);
#   4. platform.dump: the data of Auth, Storage and the pg_cron jobs into the service schemas (emptied first);
#   5. app.dump: our schemas with their data, functions, RLS and grants (one transaction);
#   6. the Storage files;
#   7. verify.sh: row counts of every table against the dump, the audit hash chain, the Storage files.
set -eu

SRC=${1:?usage: restore-db.sh <backup directory>}
STORAGE=${STORAGE_DIR-/storage}
PSQL="psql -X -q -v ON_ERROR_STOP=1"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
log() { echo "$(date -u +%FT%TZ) restore: $*"; }

log "checking $SRC"
(cd "$SRC" && sha256sum -c SHA256SUMS >/dev/null) || { echo "restore: checksum mismatch in $SRC" >&2; exit 1; }

if [ "$($PSQL -At -c "select to_regclass('public.audit_log') is not null")" = "t" ] && [ "${RESTORE_FORCE:-0}" != "1" ]; then
  echo "restore: the target already has our tables (public.audit_log); restore only into a clean stack" >&2
  exit 1
fi
for s in auth storage; do
  [ "$($PSQL -At -c "select count(*) from information_schema.schemata where schema_name = '$s'")" = "1" ] ||
    { echo "restore: schema $s is missing — start the auth and storage services once before restoring" >&2; exit 1; }
done

log "extensions"
$PSQL <<'SQL'
create extension if not exists pgcrypto with schema extensions;
create extension if not exists pg_trgm with schema extensions;
create extension if not exists pg_cron;
SQL

log "platform data (Auth, Storage, pg_cron jobs)"
pg_restore -l "$SRC/platform.dump" | awk '/ TABLE DATA / { print $(NF-2) "." $(NF-1) }' | sort -u >"$WORK/platform-tables"
if [ -s "$WORK/platform-tables" ]; then
  tables=$(sed 's/^/"/; s/\./"."/; s/$/"/' "$WORK/platform-tables" | paste -sd, -)
  $PSQL -c "truncate $tables cascade"
fi
pg_restore -d "${PGDATABASE:-postgres}" --data-only --disable-triggers --single-transaction --exit-on-error "$SRC/platform.dump"

log "our schemas (public, app, supabase_migrations)"
# The Supabase image already has the schema `public` (with its grants): its CREATE entry is skipped.
pg_restore -l "$SRC/app.dump" | grep -v -E '; [0-9]+ [0-9]+ (SCHEMA - public |COMMENT - SCHEMA public )' >"$WORK/app.toc"
pg_restore -d "${PGDATABASE:-postgres}" -L "$WORK/app.toc" --single-transaction --exit-on-error "$SRC/app.dump"

if [ -n "$STORAGE" ]; then
  log "Storage files → $STORAGE"
  mkdir -p "$STORAGE"
  find "$STORAGE" -mindepth 1 -maxdepth 1 -exec rm -rf {} +
  tar -C "$STORAGE" -xzf "$SRC/storage.tar.gz"
fi

$PSQL -c 'analyze'
sh "$(dirname "$0")/verify.sh" "$SRC"
