#!/bin/sh
# Daily backup (BACKEND_SPEC §11): runs inside the `backup` service (postgres client image) —
#
#   docker compose --profile tools run --rm backup /scripts/backup.sh
#
# (deploy/backup/run-backup.sh does it and then copies the result off the server). Writes
# /backups/daily/<UTC timestamp>/:
#   app.dump        pg_dump -Fc of our schemas (public, app, supabase_migrations): tables, functions, RLS, data
#   platform.dump   pg_dump -Fc --data-only of Supabase Auth and Storage and the pg_cron jobs (users, MFA factors,
#                   identities, bucket and object rows); their schemas belong to the services and are created by
#                   the same pinned images on restore
#   storage.tar.gz  the files of Storage (the volume of the `storage` service)
#   manifest.txt    versions, sizes; SHA256SUMS — checksums of the three files
# The first backup of a month is also kept in /backups/monthly/<YYYY-MM>/ (hard links, no extra space).
# Retention: the newest BACKUP_KEEP_DAILY (30) daily and BACKUP_KEEP_MONTHLY (12) monthly backups.
#
# Environment: PG* (connection, a superuser: supabase_admin), STORAGE_DIR (Storage files, '' to skip),
# BACKUP_ROOT (/backups), BACKUP_KEEP_DAILY, BACKUP_KEEP_MONTHLY. Personal data stays encrypted in the dump
# (AES-256-GCM, keys only in the server environment); the dumps are still confidential — store them as such.
set -eu

ROOT=${BACKUP_ROOT:-/backups}
KEEP_DAILY=${BACKUP_KEEP_DAILY:-30}
KEEP_MONTHLY=${BACKUP_KEEP_MONTHLY:-12}
STORAGE=${STORAGE_DIR-/storage}
STAMP=$(date -u +%Y-%m-%dT%H%M%SZ)
MONTH=$(date -u +%Y-%m)
DEST="$ROOT/daily/$STAMP"
TMP="$ROOT/.partial-$STAMP"

log() { echo "$(date -u +%FT%TZ) backup: $*"; }
trap 'rm -rf "$TMP"' EXIT

mkdir -p "$ROOT/daily" "$ROOT/monthly" "$TMP"
umask 077

log "dumping the database ($PGHOST:${PGPORT:-5432})"
pg_dump -Fc -Z 6 --schema=public --schema=app --schema=supabase_migrations -f "$TMP/app.dump"
pg_dump -Fc -Z 6 --data-only --schema=auth --schema=storage --schema=cron \
  --exclude-table-data=auth.schema_migrations --exclude-table-data=storage.migrations \
  --exclude-table-data=cron.job_run_details -f "$TMP/platform.dump"

if [ -n "$STORAGE" ] && [ -d "$STORAGE" ]; then
  log "archiving Storage files ($STORAGE)"
  tar -C "$STORAGE" -czf "$TMP/storage.tar.gz" .
else
  log "no Storage directory: storage.tar.gz is empty"
  tar -czf "$TMP/storage.tar.gz" -T /dev/null
fi

{
  echo "created_at=$STAMP"
  echo "server_version=$(psql -X -At -c 'show server_version')"
  echo "migrations=$(psql -X -At -c "select coalesce(max(version), '') from supabase_migrations.schema_migrations" 2>/dev/null || true)"
  echo "audit_chain=$(psql -X -At -c 'select ok from app.verify_audit_chain()' 2>/dev/null || echo unknown)"
  for f in app.dump platform.dump storage.tar.gz; do echo "size_$f=$(wc -c <"$TMP/$f" | tr -d ' ')"; done
} >"$TMP/manifest.txt"
(cd "$TMP" && sha256sum app.dump platform.dump storage.tar.gz >SHA256SUMS)

mv "$TMP" "$DEST"
trap - EXIT
log "written $DEST"

# The first backup of the month is also the monthly one.
if [ ! -d "$ROOT/monthly/$MONTH" ]; then
  mkdir -p "$ROOT/monthly/$MONTH"
  ln "$DEST"/* "$ROOT/monthly/$MONTH/" 2>/dev/null || cp -p "$DEST"/* "$ROOT/monthly/$MONTH/"
  log "monthly backup $MONTH"
fi

# Retention: names sort by time.
prune() { # $1 directory, $2 how many to keep
  ls -1 "$1" | sort -r | tail -n +"$(($2 + 1))" | while read -r old; do
    rm -rf "${1:?}/$old"
    log "removed $1/$old"
  done
}
prune "$ROOT/daily" "$KEEP_DAILY"
prune "$ROOT/monthly" "$KEEP_MONTHLY"
log "done: $(ls -1 "$ROOT/daily" | wc -l) daily, $(ls -1 "$ROOT/monthly" | wc -l) monthly"
