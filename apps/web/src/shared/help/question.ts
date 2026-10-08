/*
 * «Найдите термин или задайте вопрос»: is the text a question (the answer starts by itself after a pause in
 * typing) or a search (only the results)? A question ends with «?», starts with a question word followed by more
 * words (ru, uz-Latn, en — any of them, whatever the interface language) or is longer than five words. «гп», «STIR» — a search.
 */

/* eslint-disable mig/no-cyrillic-ui -- words recognized in what people type, not interface text */
const QUESTION_WORDS = [
  // ru
  'как', 'где', 'что', 'кто', 'почему', 'когда', 'зачем', 'сколько', 'какой', 'какая', 'какое', 'какие', 'куда', 'откуда', 'чем', 'можно ли', 'что делать', 'нужно ли', 'надо ли',
  // uz-Latn
  'qanday', 'qayerda', 'qayerga', 'nima', 'nimaga', 'kim', 'nega', 'qachon', 'qancha', 'qaysi', 'mumkinmi',
  // en
  'how', 'where', 'what', 'who', 'why', 'when', 'which', 'can', 'could', 'should', 'do', 'does', 'is', 'are',
];
/* eslint-enable mig/no-cyrillic-ui */

/** Words of the text: lower case, ё → е, the apostrophes of Uzbek dropped. */
function words(text: string): string[] {
  return text
    .toLowerCase()
    // eslint-disable-next-line mig/no-cyrillic-ui -- ё → е in what people type
    .replace(/ё/g, 'е')
    .replace(/['`ʻʼ‘’]/g, '')
    .replace(/[^\p{L}\p{N}\s-]/gu, ' ')
    .split(/\s+/)
    .filter(Boolean);
}

export const MAX_SEARCH_WORDS = 5;

export function isQuestion(text: string): boolean {
  const raw = text.trim();
  if (raw.length < 3) return false;
  if (raw.endsWith('?')) return true;
  const w = words(raw);
  if (w.length > MAX_SEARCH_WORDS) return true;
  const head = w.join(' ');
  return QUESTION_WORDS.some((q) => {
    const n = words(q).join(' ');
    // The question word and at least one more word: a bare «как» is still being typed.
    return head.startsWith(`${n} `);
  });
}
