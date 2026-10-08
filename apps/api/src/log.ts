/*
 * The API's own diagnostics (sign-in, SMS adapter, jobs): one JSON line on stdout, no personal data — callers
 * pass counts, codes and reasons, never names, phones, PINFL or tokens (CLAUDE.md, rule 5).
 */
export function serverLog(msg: string, data: Record<string, unknown> = {}): void {
  process.stdout.write(`${JSON.stringify({ level: 'info', time: Date.now(), msg, ...data })}\n`);
}
