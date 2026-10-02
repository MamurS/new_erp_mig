/*
 * «Данные для оценки» (LIFECYCLE_SPEC §4): an anonymous census — gender, birth year, relation.
 * Names, PINFL and phones are never accepted at this stage: such columns are dropped with a warning.
 */
import Papa from 'papaparse';
import type { AgeBand, CensusRelation, ISODate } from '@/shared/types';
import { toCsv } from '@/shared/lib/csv';
import { AGE_BANDS, ageOn, bandOf, type CensusRow } from './tariff';

export const CENSUS_COLUMNS = ['gender', 'birthYear', 'relation'] as const;
export const CENSUS_MAX_ROWS = 5000;
export const CENSUS_MAX_BYTES = 1024 * 1024;

/** Column names that look like personal data: dropped, never stored. */
const PII_COLUMN = /(name|fio|фио|имя|фамил|отчеств|pinfl|пинфл|jshshir|phone|tel|телеф|email|почт|passport|паспорт|birthdate|дата.?рожд|address|адрес)/i;

export const RELATION_LABEL: Record<CensusRelation, string> = { employee: 'Сотрудник', spouse: 'Супруг(а)', child: 'Ребёнок' };

export function censusTemplateCsv(): string {
  return toCsv(CENSUS_COLUMNS, [
    ['m', '1985', 'employee'],
    ['f', '1987', 'spouse'],
    ['f', '2015', 'child'],
  ]);
}

export interface CensusParseResult {
  rows: CensusRow[];
  errors: { row: number; message: string }[];
  /** Columns dropped as personal data. */
  dropped: string[];
}

function gender(v: string): 'm' | 'f' | null {
  const s = v.trim().toLowerCase();
  if (['m', 'м', 'муж', 'male', 'мужской', 'e', 'erkak'].includes(s)) return 'm';
  if (['f', 'ж', 'жен', 'female', 'женский', 'a', 'ayol'].includes(s)) return 'f';
  return null;
}

function relation(v: string): CensusRelation | null {
  const s = v.trim().toLowerCase();
  if (['employee', 'сотрудник', 'работник', 'xodim'].includes(s)) return 'employee';
  if (['spouse', 'супруг', 'супруга', 'супруг(а)', 'жена', 'муж', "turmush o'rtog'i"].includes(s)) return 'spouse';
  if (['child', 'ребёнок', 'ребенок', 'дети', 'farzand', 'bola'].includes(s)) return 'child';
  return null;
}

/** Parses the census CSV the same way on the client (preview) and on the server. */
export function parseCensusCsv(text: string, today: ISODate): CensusParseResult {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
  const fields = parsed.meta.fields ?? [];
  const dropped = fields.filter((f) => PII_COLUMN.test(f));
  const errors: CensusParseResult['errors'] = [];
  const rows: CensusRow[] = [];
  const missing = CENSUS_COLUMNS.filter((c) => !fields.includes(c));
  if (missing.length) return { rows, errors: [{ row: 1, message: `Нет столбцов: ${missing.join(', ')}. Скачайте шаблон` }], dropped };
  if (parsed.data.length > CENSUS_MAX_ROWS) return { rows, errors: [{ row: 1, message: `Строк ${parsed.data.length}, можно не больше ${CENSUS_MAX_ROWS}` }], dropped };
  const thisYear = Number(today.slice(0, 4));
  parsed.data.forEach((r, i) => {
    const line = i + 2;
    const g = gender(r.gender ?? '');
    const rel = relation(r.relation ?? '');
    const year = Number((r.birthYear ?? '').trim());
    if (!g) errors.push({ row: line, message: 'Пол: m или f' });
    if (!Number.isInteger(year) || year < thisYear - 100 || year > thisYear) errors.push({ row: line, message: 'Год рождения: четыре цифры' });
    if (!rel) errors.push({ row: line, message: 'Тип: employee, spouse или child' });
    if (g && rel && Number.isInteger(year) && year >= thisYear - 100 && year <= thisYear) rows.push({ gender: g, birthYear: year, relation: rel });
  });
  if (!rows.length && !errors.length) errors.push({ row: 1, message: 'В файле нет строк' });
  return { rows, errors, dropped };
}

export interface CensusStats {
  total: number;
  employees: number;
  family: number;
  maleShare: number;
  femaleShare: number;
  averageAge: number;
  bands: { band: AgeBand; employees: number; family: number }[];
}

export function censusStats(rows: readonly CensusRow[], onDate: ISODate): CensusStats {
  const total = rows.length;
  const ages = rows.map((r) => ageOn(r.birthYear, onDate));
  const male = rows.filter((r) => r.gender === 'm').length;
  return {
    total,
    employees: rows.filter((r) => r.relation === 'employee').length,
    family: rows.filter((r) => r.relation !== 'employee').length,
    maleShare: total ? male / total : 0,
    femaleShare: total ? (total - male) / total : 0,
    averageAge: total ? Math.round((ages.reduce((s, a) => s + a, 0) / total) * 10) / 10 : 0,
    bands: AGE_BANDS.map((band) => ({
      band,
      employees: rows.filter((r, i) => r.relation === 'employee' && bandOf(ages[i]!) === band).length,
      family: rows.filter((r, i) => r.relation !== 'employee' && bandOf(ages[i]!) === band).length,
    })),
  };
}
