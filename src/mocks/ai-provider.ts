/*
 * The `mock` AI provider (AI_COVERAGE_SPEC §3.3): a synonym dictionary and fuzzy string matching instead
 * of a model. Confidence comes from the similarity; explanations are phrase templates by verdict.
 * It lives on the mock server: a real provider (and its keys) will live on the backend only.
 */
import type { AiProvider, ExplainInput, NormalizeInput, NormalizeOutput } from '@/features/ai/provider';
import { SERVICE_CATALOG } from '@/features/coverage/catalog';
import type { ServiceCatalogItem } from '@/shared/types';

const STOP = new Set(['мл', 'мг', 'шт', 'г', 'гр', 'таб', 'табл', 'тб', 'n', 'х', 'x', 'уп', 'упак', 'фл', 'амп', 'капс', 'и', 'с', 'для', 'на', 'в', 'по', 'от', 'ли', 'покрывается', 'можно', 'сделать', 'нужно', 'нужна', 'хочу', 'qilish', 'kerak', 'uchun', 'va']);

export function norm(s: string): string {
  return s
    .toLowerCase()
    .replace(/ё/g, 'е')
    .replace(/[ʻʼ’‘`´]/g, "'")
    .replace(/[^\p{L}\p{N}']+/gu, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

function tokens(s: string): string[] {
  return norm(s)
    .split(' ')
    .map((t) => t.replace(/^'+|'+$/g, ''))
    .filter((t) => t && !STOP.has(t));
}

function trigrams(t: string): Set<string> {
  const s = `  ${t} `;
  const out = new Set<string>();
  for (let i = 0; i + 3 <= s.length; i++) out.add(s.slice(i, i + 3));
  return out;
}

function dice(a: string, b: string): number {
  const x = trigrams(a);
  const y = trigrams(b);
  let common = 0;
  for (const g of x) if (y.has(g)) common++;
  return (2 * common) / (x.size + y.size);
}

/** Similarity of two tokens: equal, an abbreviation (prefix), or close spelling. */
function tokenSim(q: string, p: string): number {
  if (q === p) return 1;
  const isNum = /^\d+$/;
  if (isNum.test(q) || isNum.test(p)) return 0;
  const [short, long] = q.length <= p.length ? [q, p] : [p, q];
  if (short.length >= 3 && long.startsWith(short)) return 0.9;
  if (short.length >= 4 && long.startsWith(short.slice(0, -1)) && long.length - short.length <= 4) return 0.8;
  const d = dice(q, p);
  return d >= 0.5 ? d : 0;
}

function phraseScore(q: string[], phrase: string): number {
  const p = tokens(phrase);
  if (!q.length || !p.length) return 0;
  const words = q.filter((t) => !/^\d+$/.test(t) || p.includes(t));
  if (!words.length) return 0;
  const best = words.map((t) => Math.max(...p.map((x) => tokenSim(t, x))));
  const qcov = best.reduce((s, x) => s + x, 0) / words.length;
  const pcov = p.map((x) => Math.max(...words.map((t) => tokenSim(t, x)))).reduce((s, x) => s + x, 0) / p.length;
  return 0.6 * qcov + 0.4 * pcov;
}

export function matchService(text: string, catalog: readonly ServiceCatalogItem[] = SERVICE_CATALOG): { code: string; confidence: number }[] {
  const q = tokens(text);
  if (!q.length) return [];
  const scored = catalog
    .map((item) => ({ code: item.code, confidence: Math.max(phraseScore(q, item.name), ...item.synonyms.map((s) => phraseScore(q, s))) }))
    .filter((x) => x.confidence >= 0.3)
    .sort((a, b) => b.confidence - a.confidence);
  return scored.slice(0, 3).map((x) => ({ code: x.code, confidence: Math.round(x.confidence * 100) / 100 }));
}

/** A query may name several services: «МРТ колена и анализ крови». */
function parts(text: string): string[] {
  return text
    .split(/[;,+\n]| и | va /iu)
    .map((s) => s.trim())
    .filter(Boolean);
}

/** Two candidates closer than this are a tie. */
const TIE = 0.04;

const ICD = /\b([A-Z]\d{2}(?:\.\d{1,2})?)\b/g;

function normalize(input: NormalizeInput): NormalizeOutput {
  const list = parts(input.text);
  const codes = new Map<string, number>();
  for (const part of list.length ? list : [input.text]) {
    const found = matchService(part);
    const top = found[0];
    if (!top) continue;
    codes.set(top.code, Math.max(codes.get(top.code) ?? 0, top.confidence));
    // A near tie inside one part is reported as an alternative with a lower confidence.
    for (const alt of found.slice(1)) if (top.confidence - alt.confidence <= TIE && !codes.has(alt.code)) codes.set(alt.code, alt.confidence * 0.8);
  }
  return { codes: [...codes].map(([code, confidence]) => ({ code, confidence })), icd10: [...new Set(input.text.toUpperCase().match(ICD) ?? [])] };
}

const RU = {
  covered: 'Скорее всего покрывается',
  needs_guarantee: 'Нужно гарантийное письмо, его запросит клиника',
  excluded: 'Не покрывается вашей программой',
  limit_exhausted: 'Лимит по этому виду помощи исчерпан',
  policy_inactive: 'Полис не действует на эту дату',
  unknown: 'Нужна проверка специалиста',
} as const;
const UZ = {
  covered: 'Katta ehtimol bilan qoplanadi',
  needs_guarantee: 'Kafolat xati kerak, uni klinika so‘raydi',
  excluded: 'Dasturingiz bo‘yicha qoplanmaydi',
  limit_exhausted: 'Ushbu yordam turi bo‘yicha limit tugagan',
  policy_inactive: 'Polis bu sanada amal qilmaydi',
  unknown: 'Mutaxassis tekshiruvi kerak',
} as const;

function explain(input: ExplainInput): { text: string } {
  const dict = input.lang === 'uz' ? UZ : RU;
  if (input.needsSpecialist) return { text: input.lang === 'uz' ? `${dict.unknown}: so‘rovni aniq tushunib bo‘lmadi.` : `${dict.unknown}: не удалось уверенно определить услугу.` };
  const head = dict[input.verdict.decision];
  const what = input.services.map((s) => s.name).join(', ');
  const why = input.clauses.length ? (input.lang === 'uz' ? ` Asos: ${input.clauses.map((c) => c.label).join('; ')}.` : ` Основание: ${input.clauses.map((c) => c.label).join('; ')}.`) : '';
  const notes = input.verdict.notes.length ? ` ${input.verdict.notes.join('. ')}.` : '';
  return { text: `${head}${what ? `: ${what}` : ''}.${why}${notes}`.slice(0, 1200) };
}

const delay = (ms: number) => new Promise((r) => setTimeout(r, ms));

/** Latency 400–900 ms like a real model; tests switch it off. */
export function createMockProvider(opts: { latency?: boolean } = {}): AiProvider {
  const wait = async () => {
    if (opts.latency) await delay(400 + Math.floor(Math.random() * 500));
  };
  return {
    id: 'mock',
    model: 'mock-synonyms-v1',
    async normalize(input) {
      await wait();
      return normalize(input);
    },
    async explain(input) {
      return explain(input);
    },
  };
}
