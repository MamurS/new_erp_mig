#!/bin/sh
# Daily backup on the server (cron of root, deploy/README.md «Резервные копии»):
#
#   15 2 * * * /opt/mig-dms/deploy/backup/run-backup.sh >> /var/log/mig-backup.log 2>&1
#
# 1. backup.sh in the `backup` service: pg_dump of the database and the Storage files to $BACKUP_DIR, retention
#    30 daily + 12 monthly;
# 2. a copy to separate storage: S3-compatible (rclone, service `offsite`, BACKUP_S3_*) or rsync over SSH
#    (BACKUP_RSYNC_TARGET). Without either the run fails: a backup only on the same server is not a backup.
# Exit code ≠ 0 on any failure (cron mails it / the monitoring of MIG watches the log).
set -eu

DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
ENV_FILE=${ENV_FILE:-$DEPLOY/.env}
COMPOSE="docker compose -f $DEPLOY/docker-compose.yml --env-file $ENV_FILE"
get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }

$COMPOSE --profile tools run --rm -T backup /scripts/backup.sh

BUCKET=$(get BACKUP_S3_BUCKET)
RSYNC=$(get BACKUP_RSYNC_TARGET)
ENV_NAME=$(get APP_ENV)
if [ -n "$BUCKET" ]; then
  # `copy`, not `sync`: a server that lost its local backups (or an intruder on it) does not delete the copies.
  # Retention on the bucket: a lifecycle rule (deploy/README.md), ideally with object lock/versioning.
  $COMPOSE --profile tools run --rm -T offsite copy /backups "offsite:$BUCKET/$ENV_NAME" --transfers 4 --checksum
  echo "$(date -u +%FT%TZ) backup: copied to s3 $BUCKET/$ENV_NAME"
elif [ -n "$RSYNC" ]; then
  BACKUP_DIR=$(get BACKUP_DIR)
  case "${BACKUP_DIR:-./backups}" in /*) SRC=${BACKUP_DIR} ;; *) SRC=$DEPLOY/${BACKUP_DIR:-./backups} ;; esac
  rsync -a --delete-after "$SRC/" "$RSYNC/"
  echo "$(date -u +%FT%TZ) backup: copied to $RSYNC"
else
  echo "$(date -u +%FT%TZ) backup: no BACKUP_S3_BUCKET or BACKUP_RSYNC_TARGET — the copy stays only on this server" >&2
  exit 2
fi
