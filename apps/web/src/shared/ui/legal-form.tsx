/* Legal form of an entity: a small chip next to the name, a «Форма» column with a filter and sort. */
import { t } from '@/i18n';
import { LEGAL_FORMS, isLegalForm, legalFormFull, legalFormShort, type LegalFormCode } from '@mig/domain/config/legalForms';
import { cn } from '@/shared/lib/cn';
import type { Column } from './data-table';

/** «ООО» / «MChJ» / «LLC» in the interface language; the full name in the tooltip. */
export function LegalFormChip({ code, className }: { code: LegalFormCode | undefined | null; className?: string }) {
  if (!code) return null;
  const full = legalFormFull(code);
  return (
    <span
      title={full}
      aria-label={t('shell.legalForm.aria', { form: full })}
      data-testid="legal-form"
      data-code={code}
      className={cn('inline-flex shrink-0 items-center whitespace-nowrap rounded-btn bg-rail px-1.5 py-0.5 text-[11px] font-medium text-muted', className)}
    >
      {legalFormShort(code)}
    </span>
  );
}

/** URL value of the legal form filter: `llc,jsc`. */
export function parseLegalForms(raw: string | null | undefined): LegalFormCode[] {
  return (raw ?? '').split(',').filter(isLegalForm);
}
export function formatLegalForms(codes: readonly string[]): string | undefined {
  const v = codes.filter(isLegalForm).join(',');
  return v || undefined;
}

/**
 * «Форма» column, right after the name: the abbreviation with the full name on hover, a filter by the
 * forms present (`selected`/`onChange`) and the server sort key `legalForm`.
 */
export function legalFormColumn<T>(
  get: (row: T) => LegalFormCode | undefined | null,
  filter?: { selected: LegalFormCode[]; onChange: (codes: LegalFormCode[]) => void },
): Column<T> {
  return {
    key: 'legalForm',
    header: t('shell.legalForm.column'),
    sortKey: 'legalForm',
    cell: (row) => <LegalFormChip code={get(row)} />,
    filter: filter && {
      options: LEGAL_FORMS.map((c) => ({ value: c, label: legalFormShort(c), title: legalFormFull(c) })),
      selected: filter.selected,
      onChange: (v) => filter.onChange(v.filter(isLegalForm)),
    },
  };
}

/** `<option>`s of a legal form `<Select>`: the code as the value, «ООО — Общество с …» as the text. */
export function LegalFormOptions() {
  return (
    <>
      {LEGAL_FORMS.map((c) => (
        <option key={c} value={c} title={legalFormFull(c)}>
          {legalFormShort(c) === legalFormFull(c) ? legalFormShort(c) : `${legalFormShort(c)} — ${legalFormFull(c)}`}
        </option>
      ))}
    </>
  );
}
