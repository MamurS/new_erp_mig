/*
 * Search that works the way people type in Uzbekistan: the same name may be typed in Latin or in
 * Cyrillic (Russian or Uzbek spelling), with any apostrophe or none.
 *
 * normalizeSearch(): lower case, ʻ ʼ ' ` ‘ ’ unified (dropped), Cyrillic transliterated into Uzbek
 * Latin (ш → sh, ч → ch, ц → ts, ё → yo, ю → yu, я → ya, ў → o, ғ → g, қ → q, ҳ → h, нг → ng).
 *
 * searchKey(): normalizeSearch() plus a loose phonetic folding for the Russian spelling of Uzbek
 * names: «Ташкент» ~ «Toshkent» (a/o, e/a), «Самарканд» ~ «Samarqand» (k/q), «Бухара» ~ «Buxoro» (h/x).
 * Lists compare keys: the query's key must be a substring of the text's key.
 */

const CYR: Record<string, string> = {
  а: 'a', б: 'b', в: 'v', г: 'g', д: 'd', е: 'e', ё: 'yo', ж: 'j', з: 'z', и: 'i', й: 'y', к: 'k',
  л: 'l', м: 'm', н: 'n', о: 'o', п: 'p', р: 'r', с: 's', т: 't', у: 'u', ф: 'f', х: 'x', ц: 'ts',
  ч: 'ch', ш: 'sh', щ: 'sh', ъ: '', ы: 'i', ь: '', э: 'e', ю: 'yu', я: 'ya',
  // Uzbek Cyrillic letters.
  ў: 'o', қ: 'q', ғ: 'g', ҳ: 'h',
};

const APOSTROPHES = /['`ʻʼ‘’]/g;

export function normalizeSearch(text: string): string {
  let out = '';
  for (const ch of text.toLowerCase().normalize('NFC')) out += CYR[ch] ?? ch;
  return out.replace(APOSTROPHES, '').replace(/\s+/g, ' ').trim();
}

/** Loose key for matching (see the header). */
export function searchKey(text: string): string {
  return normalizeSearch(text)
    .replace(/q/g, 'k')
    .replace(/x/g, 'h')
    .replace(/kh/g, 'h')
    .replace(/[oe]/g, 'a')
    .replace(/yu/g, 'u')
    .replace(/(.)\1+/g, '$1');
}

/** Whether a free-text query matches any of the fields (empty query matches everything). */
export function matchesSearch(query: string, ...fields: (string | null | undefined)[]): boolean {
  const q = searchKey(query);
  if (!q) return true;
  return fields.some((f) => !!f && searchKey(f).includes(q));
}
