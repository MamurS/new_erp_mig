#!/bin/sh
# Restore check (BACKEND_SPEC §11: monthly on staging; deploy/README.md «Ежемесячная проверка восстановления»):
# restores a backup into a THROWAWAY stack — its own Compose project, volumes and internal network, no published
# ports, secrets generated for the run — verifies it (deploy/backup/verify.sh) and removes the stack.
#
#   deploy/backup/restore-check.sh <backup directory>          # e.g. a copy of production's latest daily backup
#   deploy/backup/restore-check.sh --latest-offsite production # fetch the newest backup of that environment
#                                                              # from BACKUP_S3_* of deploy/.env first
#
# The running stack of the server is not touched. Exit 0 only when every check passes. KEEP=1 leaves the throwaway
# stack running for inspection (remove it with `docker compose -p <project> down -v`).
set -eu

DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
PROJECT=${RESTORE_PROJECT:-mig-restore-check-$(date -u +%Y%m%d%H%M%S)}
WORK=$(mktemp -d)
ENV_FILE="$WORK/.env"
COMPOSE="docker compose -p $PROJECT -f $DEPLOY/docker-compose.yml --env-file $ENV_FILE"
log() { echo "$(date -u +%FT%TZ) restore-check: $*"; }

cleanup() {
  if [ "${KEEP:-0}" = "1" ]; then
    log "KEEP=1: the stack stays — remove it with: $COMPOSE --profile tools down -v; rm -rf $WORK"
  else
    $COMPOSE --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK"
  fi
}
trap cleanup EXIT

# Throwaway secrets: the check needs no real ones (personal data stays encrypted; the API is not started).
sh "$DEPLOY/scripts/gen-secrets.sh" >"$ENV_FILE"
cat >>"$ENV_FILE" <<EOF
APP_ENV=staging
DOMAIN=restore-check.invalid
CADDY_TLS=internal
BACKUP_DIR=$WORK/unused
EOF

if [ "${1:-}" = "--latest-offsite" ]; then
  ENV_NAME=${2:?usage: restore-check.sh --latest-offsite <environment>}
  # Only the BACKUP_S3_* lines are taken from this file (read-only credentials of the backup bucket are enough).
  SERVER_ENV=${SERVER_ENV_FILE:-$DEPLOY/.env}
  grep '^BACKUP_S3_' "$SERVER_ENV" >>"$ENV_FILE" || true
  BUCKET=$(sed -n 's/^BACKUP_S3_BUCKET=//p' "$ENV_FILE" | tail -n 1)
  [ -n "$BUCKET" ] || { echo "restore-check: BACKUP_S3_BUCKET is not set in $SERVER_ENV" >&2; exit 1; }
  RCLONE="$COMPOSE --profile tools run --rm -T -v $WORK:/work offsite"
  LATEST=$($RCLONE lsf --dirs-only "offsite:$BUCKET/$ENV_NAME/daily/" | sort | tail -n 1 | tr -d '/\r')
  [ -n "$LATEST" ] || { echo "restore-check: no backups under $BUCKET/$ENV_NAME/daily" >&2; exit 1; }
  log "fetching $ENV_NAME/daily/$LATEST"
  $RCLONE copy "offsite:$BUCKET/$ENV_NAME/daily/$LATEST" "/work/backup"
  SRC="$WORK/backup"
else
  SRC=$(cd "${1:?usage: restore-check.sh <backup directory> | --latest-offsite <environment>}" && pwd)
fi
[ -f "$SRC/SHA256SUMS" ] || { echo "restore-check: $SRC is not a backup of deploy/backup/backup.sh" >&2; exit 1; }

log "starting a clean stack $PROJECT (db, auth, rest, storage)"
$COMPOSE up -d --wait --wait-timeout 300 db auth rest storage
# Auth and Storage have created their schemas; they stay stopped while the data goes in.
$COMPOSE stop auth storage rest >/dev/null

log "restoring $SRC"
$COMPOSE --profile tools run --rm -T -v "$SRC:/restore:ro" backup /scripts/restore-db.sh /restore

log "starting Auth and Storage on the restored data"
$COMPOSE up -d --wait --wait-timeout 300 auth rest storage
log "OK: $SRC restores and verifies"
