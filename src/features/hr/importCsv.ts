/* Pure helpers for the HR CSV import: template, file checks, local parsing and error grouping. */
import Papa from 'papaparse';
import type { HrImportError } from '@/shared/types/dto';
import { toCsv } from '@/shared/lib/csv';
import { formatFileSize, plural } from '@/shared/lib/format';

export const CSV_COLUMNS = ['fullName', 'birthDate', 'pinfl', 'phone', 'position', 'startDate'] as const;
export type CsvColumn = (typeof CSV_COLUMNS)[number];
export const CSV_MAX_BYTES = 2 * 1024 * 1024;
export const CSV_MAX_ROWS = 1000;
const CSV_MIME = ['text/csv', 'application/vnd.ms-excel', ''];

export const CSV_COLUMN_LABEL: Record<CsvColumn, string> = {
  fullName: 'ФИО',
  birthDate: 'Дата рождения',
  pinfl: 'ПИНФЛ',
  phone: 'Телефон',
  position: 'Должность',
  startDate: 'Начало страхования',
};

/** Template with the header row and one example row of fictional data. */
export function templateCsv(): string {
  return toCsv(CSV_COLUMNS, [['Тестов Тест Тестович', '15.03.1990', '31503900000000', '998 90 000 00 00', 'Менеджер', '01.11.2026']]);
}

/** Returns a human-readable problem with the chosen file, or null when it can be read. */
export function checkCsvFile(file: { name: string; type: string; size: number }): string | null {
  if (!file.name.toLowerCase().endsWith('.csv') || !CSV_MIME.includes(file.type)) {
    return 'Можно загрузить только файл .csv. Сохраните таблицу в формате CSV (UTF-8) и выберите его снова';
  }
  if (file.size === 0) return 'Файл пустой. Заполните шаблон и загрузите его снова';
  if (file.size > CSV_MAX_BYTES) {
    return `Файл весит ${formatFileSize(file.size)}, а можно не больше 2 МБ. Разделите список на несколько файлов`;
  }
  return null;
}

export interface ParsedCsv {
  rows: Record<string, string>[];
  fields: string[];
}

/** Parses exactly like the server does, so row numbers match (header = line 1). */
export function parseCsv(text: string): ParsedCsv {
  const parsed = Papa.parse<Record<string, string>>(text.replace(/^\ufeff/, ''), { header: true, skipEmptyLines: true });
  return { rows: parsed.data, fields: parsed.meta.fields ?? [] };
}

/** Local checks before upload: row count and required columns. */
export function checkParsedCsv(p: ParsedCsv): string | null {
  if (p.rows.length === 0) return 'В файле нет строк с сотрудниками. Заполните шаблон и загрузите его снова';
  if (p.rows.length > CSV_MAX_ROWS) {
    return `В файле ${p.rows.length} строк, а можно не больше ${CSV_MAX_ROWS}. Разделите список на несколько файлов`;
  }
  const missing = CSV_COLUMNS.filter((c) => !p.fields.includes(c));
  if (missing.length) return `В файле нет колонок: ${missing.join(', ')}. Скачайте шаблон и заполните его`;
  return null;
}

/** CSV line number (header is line 1) → errors for that line. */
export function groupErrorsByRow(errors: readonly HrImportError[]): Map<number, HrImportError[]> {
  const map = new Map<number, HrImportError[]>();
  for (const e of errors) map.set(e.row, [...(map.get(e.row) ?? []), e]);
  return map;
}

export function fieldLabel(field: string): string {
  return (CSV_COLUMN_LABEL as Record<string, string>)[field] ?? field;
}

/** «Добавить 1 сотрудника / 3 сотрудника / 5 сотрудников» */
export const employeesAcc = (n: number) => `${n} ${plural(n, ['сотрудника', 'сотрудника', 'сотрудников'])}`;
/** «1 сотрудник / 3 сотрудника / 5 сотрудников» */
export const employeesNom = (n: number) => `${n} ${plural(n, ['сотрудник', 'сотрудника', 'сотрудников'])}`;
export const rowsNom = (n: number) => `${n} ${plural(n, ['строка', 'строки', 'строк'])}`;
