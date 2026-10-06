/* Input masks for phone, PINFL, dates and money. Pure string functions. */

export function digitsOnly(s: string): string {
  return s.replace(/\D/g, '');
}

/** `+998 90 000 00 01` from any input; keeps the +998 prefix fixed. */
export function maskPhone(input: string): string {
  let d = digitsOnly(input);
  if (d.startsWith('998')) d = d.slice(3);
  d = d.slice(0, 9);
  const parts = [d.slice(0, 2), d.slice(2, 5), d.slice(5, 7), d.slice(7, 9)].filter(Boolean);
  return parts.length ? `+998 ${parts.join(' ')}` : '+998 ';
}

export function normalizePhone(input: string): string {
  let d = digitsOnly(input);
  if (d.startsWith('998')) d = d.slice(3);
  return `+998${d}`;
}

export function formatPhone(normalized: string): string {
  return maskPhone(normalized);
}

export function maskPinfl(input: string): string {
  return digitsOnly(input).slice(0, 14);
}

/** `8600 1234 5678 9012`: a bank card number while typing (16 digits in groups of four). */
export function maskCardNumber(input: string): string {
  const d = digitsOnly(input).slice(0, 16);
  return (d.match(/.{1,4}/g) ?? []).join(' ');
}

/** `dd.mm.yyyy` */
export function maskDate(input: string): string {
  const d = digitsOnly(input).slice(0, 8);
  return [d.slice(0, 2), d.slice(2, 4), d.slice(4, 8)].filter(Boolean).join('.');
}

/** `dd.mm.yyyy` → `yyyy-mm-dd` or null. */
export function parseRuDate(input: string): string | null {
  const m = /^(\d{2})\.(\d{2})\.(\d{4})$/.exec(input.trim());
  if (!m) return null;
  const [, dd, mm, yyyy] = m;
  const iso = `${yyyy}-${mm}-${dd}`;
  const date = new Date(`${iso}T00:00:00Z`);
  if (Number.isNaN(date.getTime()) || date.toISOString().slice(0, 10) !== iso) return null;
  return iso;
}

/** Groups digits: `1 250 000`. */
export function maskMoney(input: string): string {
  const d = digitsOnly(input).replace(/^0+(?=\d)/, '').slice(0, 12);
  return d.replace(/\B(?=(\d{3})+(?!\d))/g, ' ');
}

export function parseMoney(input: string): number {
  const d = digitsOnly(input);
  return d ? Number(d) : 0;
}
