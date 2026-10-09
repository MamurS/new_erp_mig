#!/bin/sh
# Restore onto a CLEAN server (deploy/README.md «Восстановление на чистый сервер»):
#
#   deploy/backup/restore.sh <backup directory>
#   deploy/backup/restore.sh --latest-offsite production     # newest daily backup from BACKUP_S3_* of deploy/.env
#
# Before: Docker installed, the repository checked out at the release that made the backup (same migrations and
# pinned images), deploy/.env filled in with the SAME PII_KEYS and PII_HMAC_KEY as the source (otherwise personal
# data cannot be read) — the other secrets may be new. Nothing of this stack may be running yet: the script
# refuses a database that already has our tables.
#
# Steps: build the images → start db, auth, rest, storage once (they create their schemas) and stop auth and
# storage → restore-db.sh (data of Auth/Storage/pg_cron, our schemas, Storage files, verification) → start the
# whole stack → pending migrations of a newer release, if any → the API answers through Caddy.
set -eu

DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$DEPLOY/.env}
COMPOSE="docker compose -f $DEPLOY/docker-compose.yml --env-file $ENV_FILE"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
log() { echo "$(date -u +%FT%TZ) restore: $*"; }
get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

[ -f "$ENV_FILE" ] || { echo "restore: $ENV_FILE not found (cp deploy/.env.example deploy/.env and fill it in)" >&2; exit 1; }

if [ "${1:-}" = "--latest-offsite" ]; then
  ENV_NAME=${2:?usage: restore.sh --latest-offsite <environment>}
  BUCKET=$(get BACKUP_S3_BUCKET)
  [ -n "$BUCKET" ] || { echo "restore: BACKUP_S3_BUCKET is not set" >&2; exit 1; }
  RCLONE="$COMPOSE --profile tools run --rm -T -v $WORK:/work offsite"
  LATEST=$($RCLONE lsf --dirs-only "offsite:$BUCKET/$ENV_NAME/daily/" | sort | tail -n 1 | tr -d '/\r')
  [ -n "$LATEST" ] || { echo "restore: no backups under $BUCKET/$ENV_NAME/daily" >&2; exit 1; }
  log "fetching $ENV_NAME/daily/$LATEST"
  $RCLONE copy "offsite:$BUCKET/$ENV_NAME/daily/$LATEST" /work/backup
  SRC="$WORK/backup"
else
  SRC=$(cd "${1:?usage: restore.sh <backup directory> | --latest-offsite <environment>}" && pwd)
fi
[ -f "$SRC/SHA256SUMS" ] || { echo "restore: $SRC is not a backup of deploy/backup/backup.sh" >&2; exit 1; }

log "building the images"
$COMPOSE build
log "starting db, auth, rest, storage on empty volumes"
$COMPOSE up -d --wait --wait-timeout 300 db auth rest storage
$COMPOSE stop auth storage rest

log "restoring $SRC"
$COMPOSE --profile tools run --rm -T -v "$SRC:/restore:ro" backup /scripts/restore-db.sh /restore

log "starting the stack"
$COMPOSE up -d --wait --wait-timeout 300 db auth rest storage kong
$COMPOSE --profile tools run --rm -T migrate
$COMPOSE up -d --wait --wait-timeout 300
log "done: check https://$(get DOMAIN)/ and sign in; then enable the daily backup cron (deploy/README.md)"
