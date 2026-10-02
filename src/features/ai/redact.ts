/*
 * Redaction before any provider except `local` (AI_COVERAGE_SPEC §3.3): names, PINFL, phones, policy,
 * contract and certificate numbers are replaced with internal labels. The mapping stays on the server.
 */
export interface RedactResult {
  text: string;
  /** label → original; never leaves the server and never goes to the provider. */
  labels: Record<string, string>;
}

const RULES: { kind: string; re: RegExp }[] = [
  { kind: 'СЕРТИФИКАТ', re: /СЕРТ-\d{4}-\d{6}-\d{4}/giu },
  { kind: 'ДОГОВОР', re: /ДМС-Д-\d{4}-\d{6}/giu },
  { kind: 'ПОЛИС', re: /ДМС-\d{4}-\d{6}/giu },
  { kind: 'ПИНФЛ', re: /(?<!\d)\d{14}(?!\d)/gu },
  { kind: 'ТЕЛЕФОН', re: /(?:\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/gu },
  { kind: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.-]+/gu },
];

/** Three capitalised Cyrillic words, the last with a patronymic ending: «Иванов Иван Иванович». */
const FULL_NAME = /(?<!\p{L})[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|ична)(?!\p{L})/gu;

export function redactForAi(input: string, known: { names?: readonly string[] } = {}): RedactResult {
  const labels: Record<string, string> = {};
  const counters: Record<string, number> = {};
  const put = (kind: string, original: string) => {
    const existing = Object.entries(labels).find(([, v]) => v === original)?.[0];
    if (existing) return existing;
    counters[kind] = (counters[kind] ?? 0) + 1;
    const label = `[${kind}-${counters[kind]}]`;
    labels[label] = original;
    return label;
  };
  let text = input;
  for (const name of known.names ?? []) {
    if (!name.trim()) continue;
    const parts = name.trim().split(/\s+/);
    // The full name and the surname alone.
    for (const variant of [name.trim(), parts[0]!].filter((v) => v.length >= 3)) {
      if (text.includes(variant)) text = text.split(variant).join(put('ФИО', variant));
    }
  }
  text = text.replace(FULL_NAME, (m) => put('ФИО', m));
  for (const r of RULES) text = text.replace(r.re, (m) => put(r.kind, m));
  return { text, labels };
}
