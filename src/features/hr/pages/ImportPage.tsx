import { useId, useRef, useState, type ChangeEvent } from 'react';
import { Link } from 'react-router-dom';
import { AlertCircle, CheckCircle2, Download, FileUp, XCircle } from 'lucide-react';
import type { HrImportResult } from '@/shared/types/dto';
import { useImportEmployees } from '@/shared/api/queries/hr';
import { errorMessage } from '@/shared/api/client';
import { downloadText } from '@/shared/lib/csv';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button, buttonVariants } from '@/shared/ui/button';
import { Breadcrumbs } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';
import {
  CSV_COLUMNS,
  CSV_COLUMN_LABEL,
  CSV_MAX_ROWS,
  checkCsvFile,
  checkParsedCsv,
  employeesAcc,
  fieldLabel,
  groupErrorsByRow,
  parseCsv,
  rowsNom,
  templateCsv,
  type CsvColumn,
} from '../importCsv';
import { HR_BTN, HrCard, HrHeader, HrSectionTitle } from '../ui';
import { t, tm } from '@/i18n';

type Stage =
  | { kind: 'select' }
  | { kind: 'preview'; csv: string; rows: Record<string, string>[]; result: HrImportResult }
  | { kind: 'done'; total: number; added: number };

/** Only the last 4 digits of identifiers are shown in the preview. */
function previewCell(col: CsvColumn, value: string | undefined): string {
  const v = (value ?? '').trim();
  if (!v) return '—';
  if (col === 'pinfl' || col === 'phone') {
    const d = v.replace(/\D/g, '');
    return d.length > 4 ? `••••${d.slice(-4)}` : v;
  }
  return v;
}

export default function ImportPage() {
  useDocumentTitle(t('hr.import.docTitle'));
  const inputId = useId();
  const inputRef = useRef<HTMLInputElement>(null);
  const importer = useImportEmployees();
  const [stage, setStage] = useState<Stage>({ kind: 'select' });
  const [fileError, setFileError] = useState<string | null>(null);
  const [reading, setReading] = useState(false);

  const reset = () => {
    setStage({ kind: 'select' });
    setFileError(null);
    importer.reset();
  };

  const onFile = async (e: ChangeEvent<HTMLInputElement>) => {
    const file = e.target.files?.[0];
    e.target.value = '';
    if (!file) return;
    setFileError(null);
    const problem = checkCsvFile(file);
    if (problem) {
      setFileError(problem);
      return;
    }
    setReading(true);
    try {
      const csv = await file.text();
      const parsed = parseCsv(csv);
      const parsedProblem = checkParsedCsv(parsed);
      if (parsedProblem) {
        setFileError(parsedProblem);
        return;
      }
      const result = await importer.mutateAsync({ csv, commit: false });
      setStage({ kind: 'preview', csv, rows: parsed.rows, result });
    } catch (err) {
      setFileError(errorMessage(err));
    } finally {
      setReading(false);
    }
  };

  const commit = () => {
    if (stage.kind !== 'preview') return;
    importer.mutate(
      { csv: stage.csv, commit: true },
      {
        onSuccess: (r) => {
          const sent = r.requested ?? r.added;
          toast.success(t('hr.import.sent', { n: sent }));
          setStage({ kind: 'done', total: stage.rows.length, added: sent });
        },
        onError: (err) => toast.error(errorMessage(err)),
      },
    );
  };

  return (
    <div className="mx-auto max-w-[1100px]">
      <Breadcrumbs items={[{ label: t('hr.nav.employees'), to: '/hr' }, { label: t('hr.import.title') }]} />
      <HrHeader
        title={t('hr.import.title')}
        subtitle={t('hr.import.subtitle', { max: CSV_MAX_ROWS })}
        className="mt-3"
        actions={
          <Button
            variant="secondary"
            className={HR_BTN}
            onClick={() => {
              downloadText(templateCsv(), 'employees-template.csv');
              toast.success(t('hr.import.templateDownloaded'));
            }}
          >
            <Download className="h-4 w-4" aria-hidden />
            {t('hr.import.downloadTemplate')}
          </Button>
        }
      />

      {stage.kind === 'select' && (
        <HrCard className="flex flex-col items-center gap-4 py-10 text-center">
          <span className="flex h-14 w-14 items-center justify-center rounded-full bg-accent-soft text-accent-text" aria-hidden>
            <FileUp className="h-7 w-7" />
          </span>
          <div>
            <HrSectionTitle>{t('hr.import.selectTitle')}</HrSectionTitle>
            <p className="mt-1 text-muted">
              {t('hr.import.columns', { columns: CSV_COLUMNS.map((c) => `${c} (${CSV_COLUMN_LABEL[c]})`).join(', ') })}
            </p>
          </div>
          <input
            ref={inputRef}
            id={inputId}
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-describedby={fileError ? `${inputId}-err` : undefined}
            onChange={(e) => void onFile(e)}
          />
          <Button className={HR_BTN} loading={reading} onClick={() => inputRef.current?.click()}>
            {t('hr.import.pickFile')}
          </Button>
          <label htmlFor={inputId} className="sr-only">
            {t('hr.import.fileLabel')}
          </label>
          {fileError && (
            <p id={`${inputId}-err`} role="alert" className="flex max-w-xl items-start gap-2 rounded-btn bg-danger-soft p-3 text-left text-danger-text">
              <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
              {fileError}
            </p>
          )}
        </HrCard>
      )}

      {stage.kind === 'preview' && <Preview stage={stage} pending={importer.isPending} onCommit={commit} onReset={reset} />}

      {stage.kind === 'done' && (
        <HrCard className="flex flex-col items-center gap-4 py-10 text-center">
          <CheckCircle2 className="h-12 w-12 text-success" aria-hidden />
          <HrSectionTitle className="text-[22px]">
            {t('hr.import.doneTitle', { n: stage.added, skipped: rowsNom(stage.total - stage.added) })}
          </HrSectionTitle>
          <p className="text-muted">{t('hr.import.doneText')}</p>
          <div className="flex flex-wrap justify-center gap-3">
            <Link to="/hr" className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
              {t('hr.import.toList')}
            </Link>
            <Button variant="secondary" className={HR_BTN} onClick={reset}>
              {t('hr.import.another')}
            </Button>
          </div>
        </HrCard>
      )}
    </div>
  );
}

function Preview({
  stage,
  pending,
  onCommit,
  onReset,
}: {
  stage: Extract<Stage, { kind: 'preview' }>;
  pending: boolean;
  onCommit: () => void;
  onReset: () => void;
}) {
  const byRow = groupErrorsByRow(stage.result.errors);
  const valid = stage.result.valid;
  const invalid = stage.rows.length - valid;

  return (
    <HrCard className="p-0">
      <div className="flex flex-wrap items-center justify-between gap-3 border-b border-border-soft p-5">
        <div>
          <HrSectionTitle>{t('hr.import.checkTitle')}</HrSectionTitle>
          <p className="mt-1 text-muted">
            {t('hr.import.checkSummary', { valid, invalid })}
          </p>
        </div>
        <div className="flex flex-wrap gap-3">
          <Button variant="secondary" className={HR_BTN} onClick={onReset} disabled={pending}>
            {t('hr.import.otherFile')}
          </Button>
          <Button className={HR_BTN} disabled={valid === 0} loading={pending} onClick={onCommit}>
            {t('hr.import.add', { employees: employeesAcc(valid) })}
          </Button>
        </div>
      </div>
      <div className="max-h-[60vh] overflow-auto">
        <table className="w-full border-collapse text-left text-[14px]">
          <caption className="sr-only">{t('hr.import.caption')}</caption>
          <thead className="sticky top-0 bg-surface">
            <tr className="border-b border-border">
              <th scope="col" className="h-10 px-3 font-normal text-muted">
                {t('hr.import.row')}
              </th>
              {CSV_COLUMNS.map((c) => (
                <th key={c} scope="col" className="h-10 whitespace-nowrap px-3 font-normal text-muted">
                  {CSV_COLUMN_LABEL[c]}
                </th>
              ))}
              <th scope="col" className="h-10 px-3 font-normal text-muted">
                {t('hr.import.result')}
              </th>
            </tr>
          </thead>
          <tbody>
            {stage.rows.map((row, idx) => {
              const line = idx + 2;
              const errs = byRow.get(line);
              const bad = new Set(errs?.map((e) => e.field));
              return (
                <tr key={line} data-status={errs ? 'invalid' : 'valid'} className={cn('border-b border-border-soft align-top', errs ? 'bg-danger-soft' : 'bg-success-soft')}>
                  <td className="px-3 py-2.5 text-muted num">{line}</td>
                  {CSV_COLUMNS.map((c) => (
                    <td key={c} className={cn('px-3 py-2.5', bad.has(c) && 'font-semibold text-danger-text')}>
                      {previewCell(c, row[c])}
                    </td>
                  ))}
                  <td className="px-3 py-2.5">
                    {errs ? (
                      <ul className="flex flex-col gap-0.5 text-danger-text">
                        {errs.map((e, i) => (
                          <li key={i} className="flex items-start gap-1.5">
                            <XCircle className="mt-0.5 h-4 w-4 shrink-0" aria-hidden />
                            <span>
                              {t('hr.import.fieldError', { field: fieldLabel(e.field), message: tm(e.message) })}
                            </span>
                          </li>
                        ))}
                      </ul>
                    ) : (
                      <span className="inline-flex items-center gap-1.5 text-success-text">
                        <CheckCircle2 className="h-4 w-4" aria-hidden />
                        {t('hr.import.willAdd')}
                      </span>
                    )}
                  </td>
                </tr>
              );
            })}
          </tbody>
        </table>
      </div>
    </HrCard>
  );
}
