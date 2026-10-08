/*
 * Redaction before any provider except `local` (AI_COVERAGE_SPEC §3.3): names, PINFL, phones, policy,
 * contract and certificate numbers are replaced with internal labels. The mapping stays on the server.
 */
export interface RedactResult {
  text: string;
  /** label → original; never leaves the server and never goes to the provider. */
  labels: Record<string, string>;
}

/** Label kind of a person's name. */
// eslint-disable-next-line mig/no-cyrillic-ui -- redaction label sent to the AI provider, not shown in the UI
const NAME_KIND = 'ФИО';

/** Document numbers in the demo templates (src/shared/domain/numbering.ts); the Cyrillic prefixes of older data too. */
const RULES: { kind: string; re: RegExp }[] = [
  // eslint-disable-next-line mig/no-cyrillic-ui -- redaction label sent to the AI provider, not shown in the UI
  { kind: 'СЕРТИФИКАТ', re: /(?:SERT|СЕРТ)-\d{4}-\d{6}-\d{4}/giu },
  // eslint-disable-next-line mig/no-cyrillic-ui -- redaction label sent to the AI provider, not shown in the UI
  { kind: 'ДОГОВОР', re: /(?:DMS-D|ДМС-Д)-\d{4}-\d{6}/giu },
  // eslint-disable-next-line mig/no-cyrillic-ui -- redaction label sent to the AI provider, not shown in the UI
  { kind: 'ПОЛИС', re: /(?:DMS|ДМС)-\d{4}-\d{6}/giu },
  // eslint-disable-next-line mig/no-cyrillic-ui -- redaction label sent to the AI provider, not shown in the UI
  { kind: 'ПИНФЛ', re: /(?<!\d)\d{14}(?!\d)/gu },
  // eslint-disable-next-line mig/no-cyrillic-ui -- redaction label sent to the AI provider, not shown in the UI
  { kind: 'ТЕЛЕФОН', re: /(?:\+?998[\s-]?)?\(?\d{2}\)?[\s-]?\d{3}[\s-]?\d{2}[\s-]?\d{2}(?!\d)/gu },
  { kind: 'EMAIL', re: /[\w.+-]+@[\w-]+\.[\w.-]+/gu },
];

/** Three capitalised Cyrillic words, the last with a patronymic ending: «Иванов Иван Иванович». */
const FULL_NAME = /(?<!\p{L})[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+\s+[А-ЯЁ][а-яё]+(?:вич|вна|ична)(?!\p{L})/gu;
/** Latin names as in the ID card / MyID: «Sobirov Akmal Ravshanovich», «Karimova Dilnoza Bahromovna». */
const FULL_NAME_LATIN = /(?<!\p{L})[A-Z][a-zʻʼ']+\s+[A-Z][a-zʻʼ']+\s+[A-Z][a-zʻʼ']+(?:ovich|evich|ovna|evna)(?!\p{L})/gu;

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
      if (text.includes(variant)) text = text.split(variant).join(put(NAME_KIND, variant));
    }
  }
  text = text.replace(FULL_NAME, (m) => put(NAME_KIND, m));
  text = text.replace(FULL_NAME_LATIN, (m) => put(NAME_KIND, m));
  for (const r of RULES) text = text.replace(r.re, (m) => put(r.kind, m));
  return { text, labels };
}
