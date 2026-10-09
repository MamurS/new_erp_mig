#!/bin/sh
# Round trip of the backup scripts, runnable locally and in CI (job `deploy` of .github/workflows/ci.yml):
# dump a running database with deploy/backup/backup.sh → restore it into a fresh throwaway stack of
# deploy/docker-compose.yml → verify row counts of every table and app.verify_audit_chain()
# (deploy/backup/restore-check.sh). The source is only read.
#
#   deploy/backup/test-local.sh           # the local Supabase stack (npx supabase start; db reset done)
#
# Environment: SOURCE_PGHOST (127.0.0.1), SOURCE_PGPORT (54322), SOURCE_PGUSER (supabase_admin),
# SOURCE_PGPASSWORD (postgres), SOURCE_STORAGE_VOLUME (supabase_storage_mig-dms: the Storage files of the local
# stack; '' to skip), OUT (where the backup is written; a temporary directory by default, removed at the end).
set -eu

DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
IMAGE=postgres:15.19-alpine3.24
OUT_DIR=${OUT:-$(mktemp -d)}
VOLUME=${SOURCE_STORAGE_VOLUME-supabase_storage_mig-dms}
[ -n "${OUT:-}" ] || trap 'rm -rf "$OUT_DIR" 2>/dev/null || true' EXIT

storage_args=''
if [ -n "$VOLUME" ] && docker volume inspect "$VOLUME" >/dev/null 2>&1; then
  storage_args="-v $VOLUME:/storage:ro -e STORAGE_DIR=/storage"
else
  storage_args="-e STORAGE_DIR="
fi

echo "test-local: backup of ${SOURCE_PGHOST:-127.0.0.1}:${SOURCE_PGPORT:-54322} → $OUT_DIR"
# shellcheck disable=SC2086
docker run --rm --network host \
  -e PGHOST="${SOURCE_PGHOST:-127.0.0.1}" -e PGPORT="${SOURCE_PGPORT:-54322}" \
  -e PGUSER="${SOURCE_PGUSER:-supabase_admin}" -e PGPASSWORD="${SOURCE_PGPASSWORD:-postgres}" -e PGDATABASE=postgres \
  -e BACKUP_ROOT=/backups $storage_args \
  -v "$OUT_DIR:/backups" -v "$DEPLOY/backup:/scripts:ro" \
  "$IMAGE" sh /scripts/backup.sh

# The backup container runs as root and keeps the files private (umask 077): give them to the user running the
# test (a CI runner is not root) so the manifest can be read and the temporary directory removed.
docker run --rm -v "$OUT_DIR:/backups" "$IMAGE" chown -R "$(id -u):$(id -g)" /backups

LATEST=$(ls -1 "$OUT_DIR/daily" | sort | tail -n 1)
cat "$OUT_DIR/daily/$LATEST/manifest.txt"
sh "$DEPLOY/backup/restore-check.sh" "$OUT_DIR/daily/$LATEST"
