/* Last user/network activity timestamp for the inactivity timeout. */
let last = Date.now();
export function markActivity(): void {
  last = Date.now();
}
export function lastActivity(): number {
  return last;
}
