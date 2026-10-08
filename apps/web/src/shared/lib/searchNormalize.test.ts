import { describe, expect, it } from 'vitest';
import { matchesSearch, normalizeSearch, searchKey } from './searchNormalize';

describe('normalizeSearch', () => {
  it('lower case; ʻ ʼ \' ` ‘ ’ are the same (dropped)', () => {
    expect(normalizeSearch('Fargʻona')).toBe('fargona');
    expect(normalizeSearch("Farg'ona")).toBe('fargona');
    expect(normalizeSearch('Farg`ona')).toBe('fargona');
    expect(normalizeSearch('Fargʼona')).toBe('fargona');
    expect(normalizeSearch('FARG’ONA')).toBe('fargona');
    expect(normalizeSearch('  Toshkent   Agrologistika ')).toBe('toshkent agrologistika');
  });

  it('transliterates Cyrillic into Uzbek Latin: sh, ch, ng, ё/ю/я, ц, ў/ғ/қ/ҳ', () => {
    expect(normalizeSearch('Шахризабз')).toBe('shaxrizabz');
    expect(normalizeSearch('Чирчик')).toBe('chirchik');
    expect(normalizeSearch('Наманган')).toBe('namangan');
    expect(normalizeSearch('Ёшлик')).toBe('yoshlik');
    expect(normalizeSearch('Юнусобод')).toBe('yunusobod');
    expect(normalizeSearch('Яккасарай')).toBe('yakkasaray');
    expect(normalizeSearch('Центр')).toBe('tsentr');
    expect(normalizeSearch('Ўзбекистон')).toBe('ozbekiston');
    expect(normalizeSearch('Ғалаба')).toBe('galaba');
    expect(normalizeSearch('Қарши')).toBe('qarshi');
    expect(normalizeSearch('Ҳамкор')).toBe('hamkor');
    expect(normalizeSearch('объект')).toBe('obekt');
  });
});

describe('searchKey and matchesSearch', () => {
  const name = 'Toshkent Agrologistika';
  it('«Ташкент», «toshkent» and «Toshkent» find Toshkent Agrologistika', () => {
    expect(matchesSearch('Ташкент', name)).toBe(true);
    expect(matchesSearch('toshkent', name)).toBe(true);
    expect(matchesSearch('Toshkent', name)).toBe(true);
    expect(matchesSearch('ТОШКЕНТ', name)).toBe(true);
    expect(matchesSearch('agro', name)).toBe(true);
  });

  it('Russian spellings of Uzbek names match their Latin form', () => {
    expect(matchesSearch('Самарканд', 'Samarqand Tekstil Group')).toBe(true);
    expect(matchesSearch('Фергана', 'Fargʻona Qurilish')).toBe(true);
    expect(matchesSearch('Бухара', 'Buxoro Savdo')).toBe(true);
    expect(matchesSearch('Хорезм', 'Xorazm Logistik')).toBe(true);
    expect(matchesSearch('Андижан', 'Andijon Farm')).toBe(true);
    expect(matchesSearch("farg'ona", 'Fargʻona Qurilish')).toBe(true);
    expect(matchesSearch('Собиров', 'Sobirov Akmal Ravshanovich')).toBe(true);
  });

  it('does not match unrelated names; empty query matches everything', () => {
    expect(matchesSearch('Самарканд', name)).toBe(false);
    expect(matchesSearch('Namangan', 'Navoiy Media')).toBe(false);
    expect(matchesSearch('', name)).toBe(true);
    expect(matchesSearch('  ', name)).toBe(true);
    expect(matchesSearch('x', null, undefined)).toBe(false);
  });

  it('the key folds case, apostrophes and the a/o, e/a, q/k, x/h variants', () => {
    expect(searchKey('Toshkent')).toBe(searchKey('Ташкент'));
    expect(searchKey('Samarqand')).toBe(searchKey('Самарканд'));
    expect(searchKey('Gʻulom')).toBe(searchKey("G'ulom"));
  });
});
