/* Server-side masking. Full PII never leaves the mock except through `reveal`. */
const DOT = '•';

export function maskPinfl(pinfl: string): string {
  return DOT.repeat(Math.max(0, pinfl.length - 4)) + pinfl.slice(-4);
}

/** `+998901234567` → `+998 •• ••• •• 67` */
export function maskPhone(phone: string): string {
  const d = phone.replace(/\D/g, '');
  // A child without an own phone: nothing to show.
  if (!d) return '';
  return `+998 ${DOT.repeat(2)} ${DOT.repeat(3)} ${DOT.repeat(2)} ${d.slice(-2)}`;
}

/** `1987-05-12` → `••.••.1987` */
export function maskBirthDate(iso: string): string {
  return `${DOT.repeat(2)}.${DOT.repeat(2)}.${iso.slice(0, 4)}`;
}

/** `aziz.k@company.uz` → `a•••@company.uz` */
export function maskEmail(email: string): string {
  const [local = '', domain = ''] = email.split('@');
  return `${local.slice(0, 1)}${DOT.repeat(3)}@${domain}`;
}

/** `8600123456784417` → `•••• 4417` */
export function maskCard(card: string): string {
  return `${DOT.repeat(4)} ${card.slice(-4)}`;
}

/** `+998901234567` → `+998 90 123 45 67` (used only for reveal). */
export function formatPhoneFull(phone: string): string {
  const d = phone.replace(/\D/g, '').slice(-9);
  return `+998 ${d.slice(0, 2)} ${d.slice(2, 5)} ${d.slice(5, 7)} ${d.slice(7, 9)}`;
}
