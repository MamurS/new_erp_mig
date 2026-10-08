/* The body of `app.job_cleanup_expired()` (jobs migration of step 3, extended by part 2 of step 4). */
/** What `app.job_cleanup_expired()` deletes (epoch columns are milliseconds); later migrations extend the list. */
export const CLEANUP_STATEMENTS: readonly string[] = [
  `delete from public.sessions where last_activity < v_now - 12 * 3600 * 1000; get diagnostics n = row_count; v := v || jsonb_build_object('sessions', n);`,
  `delete from public.challenges where expires_at < v_now; get diagnostics n = row_count; v := v || jsonb_build_object('challenges', n);`,
  `delete from public.grants where expires_at < v_now; get diagnostics n = row_count; v := v || jsonb_build_object('grants', n);`,
  `delete from public.lockouts where until < v_now; get diagnostics n = row_count; v := v || jsonb_build_object('lockouts', n);`,
  `delete from public.login_failures where "at" < v_now - v_day; get diagnostics n = row_count; v := v || jsonb_build_object('login_failures', n);`,
  `delete from public.check_attempts where "at" < v_now - v_day; get diagnostics n = row_count; v := v || jsonb_build_object('check_attempts', n);`,
  `delete from public.check_locks where until < v_now; get diagnostics n = row_count; v := v || jsonb_build_object('check_locks', n);`,
  `delete from public.card_tokens where expires_at < v_now; get diagnostics n = row_count; v := v || jsonb_build_object('card_tokens', n);`,
  `delete from public.access_tokens where expires_at < v_now; get diagnostics n = row_count; v := v || jsonb_build_object('access_tokens', n);`,
  `delete from public.idempotency where "at" < v_now - v_day; get diagnostics n = row_count; v := v || jsonb_build_object('idempotency', n);`,
  `delete from public.api_calls where "at" < v_now - 3600 * 1000; get diagnostics n = row_count; v := v || jsonb_build_object('api_calls', n);`,
];

/** `app.job_cleanup_expired()` deleting what `statements` say (`v_now`, `v_day`: epoch milliseconds). */
export function cleanupFunction(statements: readonly string[]): string {
  const now = `(extract(epoch from now()) * 1000)::bigint`;
  return `-- Expired sessions, challenges, attempt counters and tokens (epoch columns are milliseconds).
create or replace function app.job_cleanup_expired() returns jsonb
  language plpgsql volatile security definer set search_path = ''
as $$
declare
  v_now bigint := ${now};
  v_day bigint := 24 * 3600 * 1000;
  v jsonb := '{}'::jsonb;
  n bigint;
begin
${statements.map((x) => `  ${x}`).join('\n')}
  return v;
end $$;
`;
}
