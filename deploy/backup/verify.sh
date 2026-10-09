#!/bin/sh
# Verifies a restored database against its backup (deploy/backup/restore-db.sh runs it last):
#   - the row count of every table in app.dump and platform.dump equals the count in the database
#     (counted from the COPY blocks of the dump itself: independent of the source server);
#   - app.verify_audit_chain() reports an unbroken hash chain;
#   - the number of Storage files equals the archive.
# Exit 1 on any difference. Output: one line per check and a summary.
set -eu

SRC=${1:?usage: verify.sh <backup directory>}
STORAGE=${STORAGE_DIR-/storage}
PSQL="psql -X -q -v ON_ERROR_STOP=1 -At"
WORK=$(mktemp -d)
trap 'rm -rf "$WORK"' EXIT
fail=0

# Rows of every table in a dump: COPY text format has one line per row, ended by "\.".
count_dump() {
  pg_restore -f - --data-only "$1" | awk '
    /^COPY / { table = $2; n = 0; inside = 1; next }
    inside && /^\\\.$/ { print table, n; inside = 0; next }
    inside { n++ }'
}

for dump in app.dump platform.dump; do
  count_dump "$SRC/$dump" >"$WORK/$dump.counts"
done
cat "$WORK/app.dump.counts" "$WORK/platform.dump.counts" | sort >"$WORK/expected"

tables=0
rows=0
while read -r table n; do
  actual=$($PSQL -c "select count(*) from $table")
  tables=$((tables + 1))
  rows=$((rows + n))
  if [ "$actual" != "$n" ]; then
    echo "verify: MISMATCH $table: backup $n, restored $actual"
    fail=1
  fi
done <"$WORK/expected"
echo "verify: row counts — $tables tables, $rows rows, $([ "$fail" = 0 ] && echo 'all equal' || echo 'DIFFERENCES ABOVE')"

for t in public.audit_log public.insured public.claims public.files auth.users auth.mfa_factors storage.objects; do
  n=$(awk -v t="$t" '$1 == t { print $2 }' "$WORK/expected")
  [ -n "$n" ] && echo "verify:   $t = $n"
done

chain=$($PSQL -c "select ok::text || ' ' || checked || ' ' || coalesce(first_broken::text, '-') from app.verify_audit_chain()")
echo "verify: audit chain (ok, entries, first broken) — $chain"
case "$chain" in true\ *) ;; *) fail=1 ;; esac

if [ -n "$STORAGE" ] && [ -d "$STORAGE" ]; then
  in_archive=$(tar -tzf "$SRC/storage.tar.gz" | grep -v '/$' | wc -l | tr -d ' ')
  on_disk=$(find "$STORAGE" -type f | wc -l | tr -d ' ')
  echo "verify: Storage files — archive $in_archive, restored $on_disk"
  [ "$in_archive" = "$on_disk" ] || fail=1
fi

if [ "$fail" = 0 ]; then echo "verify: OK"; else echo "verify: FAILED" >&2; fi
exit "$fail"
