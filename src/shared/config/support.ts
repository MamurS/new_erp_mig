/*
 * Where people write when the help has no answer. DEMO value: MIG's public address from its offer
 * letters; the real addresses of the DMS curators and of partner support come from MIG.
 */
export const MIG_SUPPORT_EMAIL = 'info@mosaic-insurance.com';

/** `mailto:` with a fixed subject only: the question itself may hold personal data and never goes into a URL. */
export function supportMailto(email: string, subject: string): string {
  return `mailto:${email}?subject=${encodeURIComponent(subject)}`;
}
