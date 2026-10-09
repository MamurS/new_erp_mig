#!/bin/sh
# Smoke test of the whole deployment on one machine (locally and in CI, job `deploy`): a throwaway Compose project
# of deploy/docker-compose.yml in production mode — generated secrets, Caddy with `tls internal` on 127.0.0.1 —
# then migrations, the first administrator (create-admin.mjs) and deploy/scripts/smoke-check.mjs through Caddy
# (headers, SPA, 401/403/413, no demo routes, Supabase not exposed, sign-in with TOTP, RLS, logout), a backup
# of the result restored into a second throwaway stack (deploy/backup/restore-check.sh). Removes everything at the
# end (KEEP=1 keeps the stack).
#
#   deploy/scripts/smoke-test.sh          # builds the images (docker compose build)
#   SKIP_BUILD=1 API_IMAGE=… CADDY_IMAGE=… deploy/scripts/smoke-test.sh
#
# Ports: HTTPS_PORT (8443) and HTTP_PORT (8088) on 127.0.0.1. Needs Docker and Node 20 on the host.
set -eu

DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
PROJECT=${SMOKE_PROJECT:-mig-smoke}
WORK=$(mktemp -d)
ENV_FILE="$WORK/.env"
HTTPS_PORT=${HTTPS_PORT:-8443}
COMPOSE="docker compose -p $PROJECT -f $DEPLOY/docker-compose.yml --env-file $ENV_FILE"
log() { echo "$(date -u +%FT%TZ) smoke: $*"; }

cleanup() {
  code=$?
  if [ "$code" != 0 ]; then
    log "FAILED — last logs:"
    $COMPOSE logs --tail 40 api worker caddy auth 2>/dev/null | tail -120 || true
  fi
  if [ "${KEEP:-0}" = "1" ]; then
    log "KEEP=1: remove with: $COMPOSE --profile tools down -v; rm -rf $WORK"
  else
    $COMPOSE --profile tools down -v --remove-orphans >/dev/null 2>&1 || true
    rm -rf "$WORK" 2>/dev/null || true
  fi
  exit "$code"
}
trap cleanup EXIT

sh "$DEPLOY/scripts/gen-secrets.sh" >"$ENV_FILE"
cat >>"$ENV_FILE" <<EOF
APP_ENV=production
DOMAIN=localhost
CADDY_TLS=internal
PUBLISH_ADDR=127.0.0.1
HTTP_PORT=${HTTP_PORT:-8088}
HTTPS_PORT=$HTTPS_PORT
API_IMAGE=${API_IMAGE:-mig-dms/api:smoke}
CADDY_IMAGE=${CADDY_IMAGE:-mig-dms/caddy:smoke}
BACKUP_DIR=$WORK/backups
SMTP_HOST=smtp.smoke.invalid
SMTP_FROM=MIG DMS <noreply@smoke.invalid>
EOF

log "configuration"
$COMPOSE config -q
if [ "${SKIP_BUILD:-0}" != 1 ]; then
  log "building the images"
  $COMPOSE build api caddy
fi

log "starting Supabase"
$COMPOSE up -d --wait --wait-timeout 300 db auth rest storage kong
log "starting migrate (one-shot), api, worker, caddy"
$COMPOSE up -d --wait --wait-timeout 300
$COMPOSE logs migrate 2>/dev/null | grep -q 'migrations: 8 applied\|migrations: [0-9]* applied' || { echo "smoke: migrate did not run" >&2; exit 1; }
log "migrations again (nothing pending)"
$COMPOSE run --rm -T migrate 2>/dev/null | grep -q 'migrations: 0 applied' || { echo "smoke: the second run applied migrations" >&2; exit 1; }

log "published ports (only Caddy):"
docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | grep -- '->' || true
published=$(docker ps --filter "label=com.docker.compose.project=$PROJECT" --format '{{.Names}} {{.Ports}}' | grep -- '->' | grep -vc -- '-caddy-' || true)
[ "$published" = 0 ] || { echo "smoke: a service other than Caddy publishes a port" >&2; exit 1; }

log "first administrator"
PASSWORD=$($COMPOSE run --rm -T api node deploy/scripts/create-admin.mjs --email smoke-admin@example.com --name "Smoke Test Admin" | sed -n 's/^One-time password (shown once): //p')
[ -n "$PASSWORD" ] || { echo "smoke: create-admin printed no password" >&2; exit 1; }

docker cp "$($COMPOSE ps -q caddy)":/data/caddy/pki/authorities/local/root.crt "$WORK/caddy-root.crt" >/dev/null
log "checks through Caddy"
node "$DEPLOY/scripts/smoke-check.mjs" "https://localhost:$HTTPS_PORT" --ca "$WORK/caddy-root.crt" --admin smoke-admin@example.com --password "$PASSWORD" --expect production >"$WORK/check.log" ||
  { cat "$WORK/check.log"; exit 1; }
grep -v '^TOTP_SECRET=' "$WORK/check.log"
TOTP_SECRET=$(sed -n 's/^TOTP_SECRET=//p' "$WORK/check.log")

log "password reset by the server administrator, sign-in with the new password and the connected factor"
PASSWORD2=$($COMPOSE run --rm -T api node deploy/scripts/create-admin.mjs --email smoke-admin@example.com --reset-password | sed -n 's/^One-time password of [^:]*: //p')
[ -n "$PASSWORD2" ] && [ "$PASSWORD2" != "$PASSWORD" ] || { echo "smoke: --reset-password printed no new password" >&2; exit 1; }
node "$DEPLOY/scripts/smoke-check.mjs" "https://localhost:$HTTPS_PORT" --ca "$WORK/caddy-root.crt" --admin smoke-admin@example.com --password "$PASSWORD2" --totp-secret "$TOTP_SECRET" --expect production >"$WORK/check2.log" ||
  { cat "$WORK/check2.log"; exit 1; }
tail -n 1 "$WORK/check2.log"

log "Caddy access log has no query strings"
NODE_EXTRA_CA_CERTS="$WORK/caddy-root.crt" node -e "fetch('https://localhost:$HTTPS_PORT/api/insured?q=SecretName').then(r=>r.arrayBuffer())"
sleep 1
if $COMPOSE logs caddy 2>/dev/null | grep -q SecretName; then echo "smoke: a query string reached the Caddy log" >&2; exit 1; fi

log "backup of this stack and its restore into a second throwaway stack"
$COMPOSE --profile tools run --rm -T backup /scripts/backup.sh >"$WORK/backup.log" 2>&1 || { cat "$WORK/backup.log"; exit 1; }
tail -n 1 "$WORK/backup.log"
# The backup container writes as root with umask 077: hand the files to the user running the test (a CI runner
# is not root) so they can be listed and restored.
docker run --rm -v "$WORK/backups:/backups" postgres:15.19-alpine3.24 chown -R "$(id -u):$(id -g)" /backups
LATEST=$(ls -1 "$WORK/backups/daily" | tail -n 1)
RESTORE_PROJECT="$PROJECT-restore" sh "$DEPLOY/backup/restore-check.sh" "$WORK/backups/daily/$LATEST" >"$WORK/restore.log" 2>&1 ||
  { tail -n 40 "$WORK/restore.log"; exit 1; }
grep -E 'verify|restore-check: OK' "$WORK/restore.log"
log "OK"
