import { defineLabels } from '@/i18n';

const MONTH_IDS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
const MONTH_LABEL = defineLabels('staff.month', MONTH_IDS);

/** Short month name for chart axes, from `YYYY-MM`: `янв`, `yan`, `Jan`. */
export function monthShort(yearMonth: string): string {
  return MONTH_LABEL[MONTH_IDS[Number(yearMonth.slice(5, 7)) - 1] ?? 'jan'];
}
