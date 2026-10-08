/* Cryptographically random helpers for runtime-created entities and sessions. */
export function randomId(): string {
  return crypto.randomUUID();
}

export function randomToken(bytes = 32): string {
  const buf = new Uint8Array(bytes);
  crypto.getRandomValues(buf);
  let bin = '';
  for (const x of buf) bin += String.fromCharCode(x);
  return btoa(bin).replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/, '');
}
