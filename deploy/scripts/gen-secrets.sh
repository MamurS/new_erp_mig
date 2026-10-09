#!/bin/sh
# Generates every secret of deploy/.env with openssl (nothing leaves the server):
#
#   sh scripts/gen-secrets.sh            # prints KEY=value lines
#   sh scripts/gen-secrets.sh --fill .env  # fills only the keys that are empty in .env (never overwrites a value)
#
# ANON_KEY and SERVICE_ROLE_KEY are HS256 JWTs signed with JWT_SECRET (role anon / service_role, 10 years), as the
# self-hosted Supabase expects. With --fill, an existing JWT_SECRET is reused to sign missing keys. Rotation of
# each secret: deploy/README.md «Ротация секретов».
set -eu

b64url() { openssl base64 -A | tr '+/' '-_' | tr -d '='; }
rand_b64() { openssl rand -base64 "$1" | tr -d '\n'; }
rand_hex() { openssl rand -hex "$1"; }

jwt() { # $1 role, $2 secret
  now=$(date +%s)
  exp=$((now + 10 * 365 * 24 * 3600))
  header=$(printf '{"alg":"HS256","typ":"JWT"}' | b64url)
  payload=$(printf '{"role":"%s","iss":"supabase","iat":%s,"exp":%s}' "$1" "$now" "$exp" | b64url)
  sig=$(printf '%s.%s' "$header" "$payload" | openssl dgst -sha256 -hmac "$2" -binary | b64url)
  printf '%s.%s.%s' "$header" "$payload" "$sig"
}

current() { # value of $1 in the file $2 ('' when absent or empty)
  [ -f "$2" ] || return 0
  sed -n "s/^$1=//p" "$2" | tail -n 1 | sed "s/^['\"]//; s/['\"]\$//"
}

FILL=''
if [ "${1:-}" = "--fill" ]; then
  FILL=${2:?usage: gen-secrets.sh --fill <env file>}
  [ -f "$FILL" ] || { echo "$FILL not found (cp .env.example .env first)" >&2; exit 1; }
fi

JWT_SECRET=$(current JWT_SECRET "$FILL")
[ -n "$JWT_SECRET" ] || JWT_SECRET=$(rand_b64 48)

out=$(cat <<EOF
POSTGRES_PASSWORD=$(rand_hex 24)
JWT_SECRET=$JWT_SECRET
ANON_KEY=$(jwt anon "$JWT_SECRET")
SERVICE_ROLE_KEY=$(jwt service_role "$JWT_SECRET")
DASHBOARD_PASSWORD=$(rand_hex 16)
PII_KEYS=1:$(rand_b64 32)
PII_KEY_CURRENT=1
PII_HMAC_KEY=$(rand_b64 48)
SESSION_SECRET=$(rand_b64 48)
SMS_HOOK_SECRET=v1,whsec_$(rand_b64 32)
EOF
)

if [ -z "$FILL" ]; then
  printf '%s\n' "$out"
  exit 0
fi

tmp=$(mktemp)
cp "$FILL" "$tmp"
printf '%s\n' "$out" | while IFS= read -r line; do
  key=${line%%=*}
  value=${line#*=}
  if grep -q "^$key=" "$tmp"; then
    if [ -z "$(current "$key" "$tmp")" ]; then
      awk -v k="$key" -v v="$value" 'BEGIN { FS = OFS = "=" } $1 == k && $2 == "" { print k "=" v; next } { print }' "$tmp" >"$tmp.new" && mv "$tmp.new" "$tmp"
      echo "filled  $key" >&2
    else
      echo "kept    $key (already set)" >&2
    fi
  else
    printf '%s=%s\n' "$key" "$value" >>"$tmp"
    echo "added   $key" >&2
  fi
done
cat "$tmp" >"$FILL"
rm -f "$tmp"
chmod 600 "$FILL"
echo "$FILL: secrets filled; keep a copy of PII_KEYS and PII_HMAC_KEY outside the server (deploy/README.md)" >&2
