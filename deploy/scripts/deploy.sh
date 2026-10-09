#!/bin/sh
# Deploys the checked-out release on this server (the GitHub Actions workflows run it on the self-hosted runner;
# by hand: the same command). deploy/README.md «Обновление» and «Откат».
#
#   deploy/scripts/deploy.sh                 # build images for this commit, migrate, start, check
#   deploy/scripts/deploy.sh --backup        # production: a backup BEFORE the migrations (stops on failure)
#   deploy/scripts/deploy.sh --rollback <sha>   # start the images of an earlier commit again (no build, no migrations)
#
# Images are tagged with the commit (mig-dms/api:<sha>, mig-dms/caddy:<sha>), so earlier releases stay on the
# server for a rollback. Migrations only go forward: a rollback that must undo a migration is a restore of the
# backup taken before it (deploy/backup/restore.sh).
# Staging (APP_ENV=staging) gets the demo data on an empty database (the API's demo reset, the same seed as CI);
# production never — the demo routes do not exist there, and the script refuses demo settings.
set -eu

DEPLOY=$(cd "$(dirname "$0")/.." && pwd)
REPO=$(cd "$DEPLOY/.." && pwd)
ENV_FILE=${ENV_FILE:-$DEPLOY/.env}
get() { sed -n "s/^$1=//p" "$ENV_FILE" | tail -n 1; }
log() { echo "$(date -u +%FT%TZ) deploy: $*"; }

[ -f "$ENV_FILE" ] || { echo "deploy: $ENV_FILE not found" >&2; exit 1; }
APP_ENV=$(get APP_ENV)
case "$APP_ENV" in production | staging) ;; *) echo "deploy: APP_ENV must be production or staging" >&2; exit 1 ;; esac
if [ "$APP_ENV" = production ] && [ -n "$(get DEMO_PASSWORD)" ]; then
  echo "deploy: DEMO_PASSWORD must be empty in production" >&2
  exit 1
fi

BACKUP=0
ROLLBACK=''
while [ $# -gt 0 ]; do
  case "$1" in
    --backup) BACKUP=1 ;;
    --rollback) ROLLBACK=${2:?--rollback <commit>}; shift ;;
    *) echo "deploy: unknown option $1" >&2; exit 1 ;;
  esac
  shift
done

SHA=${ROLLBACK:-$(git -C "$REPO" rev-parse --short=12 HEAD)}
export API_IMAGE="mig-dms/api:$SHA" CADDY_IMAGE="mig-dms/caddy:$SHA"
COMPOSE="docker compose -f $DEPLOY/docker-compose.yml --env-file $ENV_FILE"

if [ -n "$ROLLBACK" ]; then
  docker image inspect "$API_IMAGE" "$CADDY_IMAGE" >/dev/null || { echo "deploy: images of $SHA are not on this server" >&2; exit 1; }
  log "rollback to $SHA (images only; the database stays as it is)"
  $COMPOSE up -d --wait --wait-timeout 300 api worker caddy
  log "rolled back to $SHA"
  exit 0
fi

log "building $SHA ($APP_ENV)"
$COMPOSE build api caddy

log "starting Supabase"
$COMPOSE up -d --wait --wait-timeout 300 db auth rest storage kong

if [ "$BACKUP" = 1 ]; then
  log "backup before the migrations"
  set +e
  "$DEPLOY/backup/run-backup.sh"
  code=$?
  set -e
  # 2 = no separate storage configured: the local copy exists, the deploy goes on with a warning.
  if [ "$code" != 0 ] && [ "$code" != 2 ]; then
    echo "deploy: the backup failed (exit $code) — nothing was migrated" >&2
    exit 1
  fi
fi

log "migrations"
$COMPOSE --profile tools run --rm -T migrate

log "starting the application"
$COMPOSE up -d --wait --wait-timeout 300 --remove-orphans

if [ "$APP_ENV" = staging ]; then
  empty=$($COMPOSE exec -T db psql -U postgres -At -c "select not exists (select 1 from public.clients)")
  if [ "$empty" = t ] || [ "${RESEED:-0}" = 1 ]; then
    log "staging: loading the demo data (POST /api/__demo/reset)"
    $COMPOSE exec -T api node -e "fetch('http://127.0.0.1:8787/api/__demo/reset',{method:'POST',headers:{'content-type':'application/json','x-requested-with':'mig-web'},body:'{}'}).then(async r=>{if(!r.ok){console.error(r.status,await r.text());process.exit(1)}})"
  fi
fi

log "checks"
$COMPOSE exec -T api node --input-type=module -e "
const base='http://127.0.0.1:8787/api';
const me=await fetch(base+'/auth/me'); if(me.status!==401) throw new Error('/api/auth/me: '+me.status);
const demo=await fetch(base+'/__demo/failures'); const prod=process.env.APP_ENV==='production';
if(prod && demo.status!==404) throw new Error('production must not have the demo routes: '+demo.status);
if(!prod && demo.status!==200) throw new Error('staging demo routes: '+demo.status);
console.log('api ok', process.env.APP_ENV);
"
log "deployed $SHA to $APP_ENV"
