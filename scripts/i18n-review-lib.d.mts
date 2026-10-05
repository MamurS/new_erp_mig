export const LOCALES: readonly string[];
export const HEADER: readonly string[];
export function parseDictFile(text: string): { key: string; value: string }[];
type Locale = 'ru' | 'uz-Latn' | 'en';
export function readDicts(dictRoot: string): {
  values: Record<Locale, Map<string, string>>;
  files: Record<Locale, Map<string, string>>;
};
export function findUsages(srcRoot: string, keys: string[], repoRoot: string): Map<string, string>;
export function toCsv(rows: string[][]): string;
export function buildRows(dictRoot: string, srcRoot: string, repoRoot: string): string[][];
export function normalizeUz(s: string): string;
export function applyCsv(
  csvText: string,
  dictRoot: string,
  opts?: { dryRun?: boolean },
): { updated: number; unchanged: number; unknown: string[]; added: number };
