/* Policy issuance wizard (POLICY_SPEC §4): terms → list of insured persons → review and HR invite. */
import { defineLabels, t, tm } from '@/i18n';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, FileUp } from 'lucide-react';
import type { InsuredRelation, LimitCategory, ProgramCode } from '@/shared/types';
import { RELATIONS, RELATION_LABEL } from '@/shared/domain/family';
import type { PolicyListCheck } from '@/shared/types/dto';
import { useClient } from '@/shared/api/queries/staff';
import { useCheckPolicyList, useIssuePolicy } from '@/shared/api/queries/policies';
import { errorMessage } from '@/shared/api/client';
import { LIMIT_CATEGORY_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { PROGRAMS } from '@/shared/domain/programs';
import { defaultEndDate, defaultTariff, POLICY_CSV_HEADER, POLICY_CSV_MAX_BYTES, POLICY_CSV_MAX_ROWS, policyPeriodProblem, policyPremium } from '@/shared/domain/policies';
import { policyHrInviteSchema, policyTermsSchema } from '@/shared/schemas/forms';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { groupErrorsByRow, parseCsv } from '@/features/hr/importCsv';
import { addDaysISO, formatDate, formatMoney, formatNumber, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { LegalFormChip } from '@/shared/ui/legal-form';
import { Card, Kv } from '@/shared/ui/page';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { TableScroll } from '@/shared/ui/table-scroll';

const PROGRAM_CODES: ProgramCode[] = ['basic', 'standard', 'standard_plus', 'premium'];
const STEPS = ['terms', 'list', 'review'] as const;
const STEP_LABEL = defineLabels('staffLc.issue.step', STEPS);

interface Terms {
  program: ProgramCode;
  startDate: string;
  endDate: string;
  employee: string;
  family: string;
}

const toNumber = (v: string) => Number(v.replace(/\s/g, ''));
const PREVIEW_ROWS = 200;

/** Relation of a raw CSV row (empty — an employee); an unknown value is shown as is. */
function relationCell(v: string | undefined): string {
  const key = (v ?? '').trim().toLowerCase() || 'employee';
  return (RELATIONS as readonly string[]).includes(key) ? RELATION_LABEL[key as InsuredRelation] : (v ?? '');
}

/** Rows of the file with the server's verdict: valid ones green, invalid ones red. No PINFL or phone on screen. */
function ListPreview({ csv, result }: { csv: string; result: PolicyListCheck }) {
  const rows = parseCsv(csv).rows;
  const byRow = groupErrorsByRow(result.errors);
  return (
    <TableScroll className="mt-3 max-h-[420px] rounded-btn border border-border">
      <table className="w-full border-collapse text-left text-[13px]">
        <caption className="sr-only">{t('staffLc.issue.previewCaption')}</caption>
        <thead>
          <tr className="text-[12px] text-muted">
            <th className="px-2 py-1.5 font-normal">{t('staffLc.issue.colRow')}</th>
            <th className="px-2 py-1.5 font-normal">{t('common.fullName')}</th>
            <th className="px-2 py-1.5 font-normal">{t('common.position')}</th>
            <th className="px-2 py-1.5 font-normal">{t('staffLc.issue.colFamily')}</th>
            <th className="px-2 py-1.5 font-normal">{t('staffLc.issue.colCheck')}</th>
          </tr>
        </thead>
        <tbody>
          {rows.slice(0, PREVIEW_ROWS).map((r, i) => {
            const line = i + 2;
            const errs = byRow.get(line);
            return (
              <tr key={line} data-status={errs ? 'invalid' : 'valid'} className={cn('border-b border-border-soft align-top', errs ? 'bg-danger-soft' : 'bg-success-soft')}>
                <td className="num px-2 py-1.5">{line}</td>
                <td className="px-2 py-1.5">{r.fullName}</td>
                <td className="px-2 py-1.5">{r.position}</td>
                <td className="px-2 py-1.5">{relationCell(r.relation)}</td>
                <td className={cn('px-2 py-1.5', errs ? 'text-danger-text' : 'text-success-text')}>
                  {errs ? errs.map((e) => `${e.field ? `${e.field}: ` : ''}${tm(e.message)}`).join('; ') : t('staffLc.issue.valid')}
                </td>
              </tr>
            );
          })}
        </tbody>
      </table>
      {rows.length > PREVIEW_ROWS && <p className="px-2 py-1.5 text-[12px] text-muted">{t('staffLc.issue.previewLimited', { shown: PREVIEW_ROWS, total: rows.length })}</p>}
    </TableScroll>
  );
}

function Steps({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label={t('staffLc.issue.stepsAria')}>
      {STEPS.map((id, i) => (
        <li
          key={id}
          aria-current={i === step ? 'step' : undefined}
          className={cn('rounded-full border px-3 py-1 text-[13px]', i === step ? 'border-accent bg-accent-soft font-semibold text-accent-text' : i < step ? 'border-border text-text' : 'border-border text-muted')}
        >
          {i + 1}. {STEP_LABEL[id]}
        </li>
      ))}
    </ol>
  );
}

export default function PolicyIssuePage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const client = useClient(clientId);
  useDocumentTitle(t('staffLc.issue.title'));
  useTopbar([{ label: t('staffLc.issue.clients'), to: '/staff/clients' }, { label: client.data?.name ?? t('common.client'), to: `/staff/clients/${clientId}` }, { label: t('staffLc.issue.title') }]);
  const check = useCheckPolicyList();
  const issue = useIssuePolicy();

  const [step, setStep] = useState(0);
  const start = addDaysISO(todayISO(), 1);
  const [terms, setTerms] = useState<Terms>(() => {
    const tr = defaultTariff('standard');
    return { program: 'standard', startDate: start, endDate: defaultEndDate(start), employee: String(tr.employee), family: String(tr.family) };
  });
  const [termErrors, setTermErrors] = useState<Record<string, string>>({});
  const [csv, setCsv] = useState<string | null>(null);
  const [fileError, setFileError] = useState<string | null>(null);
  const [preview, setPreview] = useState<PolicyListCheck | null>(null);
  const [inviteHr, setInviteHr] = useState(true);
  const [hr, setHr] = useState({ fullName: '', email: '' });
  const [hrErrors, setHrErrors] = useState<Record<string, string>>({});

  const tariff = { employee: toNumber(terms.employee), family: toNumber(terms.family) };
  const premium = preview ? policyPremium(tariff, preview.employees, preview.familyMembers) : 0;

  if (client.isLoading) return <SkeletonRows rows={8} />;
  if (client.isError || !client.data) return <ErrorState error={client.error} onRetry={() => void client.refetch()} />;
  const c = client.data;

  const pickProgram = (program: ProgramCode) => {
    const tr = defaultTariff(program);
    setTerms((s) => ({ ...s, program, employee: String(tr.employee), family: String(tr.family) }));
  };

  const nextFromTerms = () => {
    const parsed = policyTermsSchema.safeParse({ program: terms.program, startDate: terms.startDate, endDate: terms.endDate, tariff });
    const errors: Record<string, string> = {};
    if (!parsed.success) for (const i of parsed.error.issues) errors[String(i.path[i.path.length - 1])] = i.message;
    else {
      const period = policyPeriodProblem(parsed.data.startDate, parsed.data.endDate);
      if (period) errors.endDate = period;
    }
    setTermErrors(errors);
    if (!Object.keys(errors).length) setStep(1);
  };

  const template = () => {
    // eslint-disable-next-line mig/no-cyrillic-ui -- sample row of the CSV template (data, not UI)
    const rows = [
      ['Ivanov Ivan Ivanovich', '15.03.1990', '31503900000001', '+998901234567', 'Инженер', 'employee', '', ''],
      ['Ivanova Anna Petrovna', '02.04.1992', '40204920000002', '', '', 'spouse', '31503900000001', ''],
      ['Ivanov Pavel Ivanovich', '10.10.2015', '31010150000003', '', '', 'child', '31503900000001', ''],
    ];
    downloadText(toCsv(POLICY_CSV_HEADER, rows), 'policy-insured-template.csv');
  };

  const onFile = async (file: File) => {
    setPreview(null);
    setCsv(null);
    if (!/\.csv$/i.test(file.name) || (file.type && !['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.type))) {
      setFileError(t('staffLc.issue.needCsv'));
      return;
    }
    if (file.size > POLICY_CSV_MAX_BYTES) {
      setFileError(t('staffLc.issue.tooBig'));
      return;
    }
    setFileError(null);
    const text = await file.text();
    try {
      const r = await check.mutateAsync({ clientId, csv: text });
      setCsv(text);
      setPreview(r);
    } catch (e) {
      setFileError(errorMessage(e));
    }
  };

  const submit = async () => {
    if (!csv) return;
    let hrBody: { fullName: string; email: string } | undefined;
    if (inviteHr) {
      const parsed = policyHrInviteSchema.safeParse(hr);
      if (!parsed.success) {
        setHrErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
        return;
      }
      hrBody = parsed.data;
    }
    setHrErrors({});
    try {
      const policy = await issue.mutateAsync({ clientId, body: { program: terms.program, startDate: terms.startDate, endDate: terms.endDate, tariff, csv, hr: hrBody } });
      toast.success(t('staffLc.issue.issued', { number: policy.number }));
      navigate(`/staff/policies/${policy.id}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold">{t('staffLc.issue.title')}</h1>
        <p className="text-muted">
          {c.name} <LegalFormChip code={c.legalForm} /> · {t('staffLc.deals.inn')} <span className="num">{c.inn}</span>
        </p>
      </div>
      <Steps step={step} />

      {step === 0 && (
        <Card title={t('staffLc.issue.termsTitle')}>
          <fieldset>
            <legend className="mb-2 text-[12px] font-medium text-muted">{t('common.program')}</legend>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label={t('common.program')}>
              {PROGRAM_CODES.map((code) => (
                <button
                  key={code}
                  type="button"
                  role="radio"
                  aria-checked={terms.program === code}
                  onClick={() => pickProgram(code)}
                  className={cn('rounded-card border p-3 text-left', terms.program === code ? 'border-accent bg-accent-soft' : 'border-border hover:bg-rail')}
                >
                  <span className="block font-semibold">{PROGRAM_LABEL[code]}</span>
                  <span className="block text-[12px] text-muted">{t('staffLc.issue.ratePerYear', { amount: formatMoney(defaultTariff(code).employee) })}</span>
                  <dl className="mt-2 text-[12px]">
                    {(Object.keys(PROGRAMS[code].limits) as LimitCategory[]).map((cat) => (
                      <div key={cat} className="flex justify-between gap-2">
                        <dt className="text-muted">{LIMIT_CATEGORY_LABEL[cat]}</dt>
                        <dd className="num">{formatMoney(PROGRAMS[code].limits[cat], false)}</dd>
                      </div>
                    ))}
                  </dl>
                </button>
              ))}
            </div>
          </fieldset>
          <div className="mt-4 grid gap-3 sm:grid-cols-2 lg:grid-cols-4">
            <Field label={t('common.start')} error={tm(termErrors.startDate) || undefined}>
              {(a) => <Input {...a} type="date" value={terms.startDate} onChange={(e) => setTerms((s) => ({ ...s, startDate: e.target.value, endDate: e.target.value ? defaultEndDate(e.target.value) : s.endDate }))} />}
            </Field>
            <Field label={t('common.end')} error={tm(termErrors.endDate) || undefined}>
              {(a) => <Input {...a} type="date" value={terms.endDate} onChange={(e) => setTerms((s) => ({ ...s, endDate: e.target.value }))} />}
            </Field>
            <Field label={t('staffLc.issue.rateEmployee')} error={tm(termErrors.employee) || undefined}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={13} value={terms.employee} onChange={(e) => setTerms((s) => ({ ...s, employee: e.target.value }))} />}
            </Field>
            <Field label={t('staffLc.issue.rateFamily')} error={tm(termErrors.family) || undefined}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={13} value={terms.family} onChange={(e) => setTerms((s) => ({ ...s, family: e.target.value }))} />}
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate(`/staff/clients/${clientId}`)}>
              {t('common.cancel')}
            </Button>
            <Button onClick={nextFromTerms}>{t('common.next')}</Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title={t('staffLc.issue.step.list')}>
          <p className="text-muted">
            {t('staffLc.issue.listHelp', { rows: formatNumber(POLICY_CSV_MAX_ROWS), columns: POLICY_CSV_HEADER.join(', ') })}
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={template}>
              <Download className="h-3.5 w-3.5" aria-hidden /> {t('staffLc.issue.downloadTemplate')}
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-border px-3 text-[13px] font-medium hover:bg-rail">
              <FileUp className="h-3.5 w-3.5" aria-hidden /> {check.isPending ? t('staffLc.issue.checking') : t('staffLc.contract.uploadList')}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label={t('staffLc.issue.fileAria')}
                onChange={(e) => {
                  const f = e.target.files?.[0];
                  e.target.value = '';
                  if (f) void onFile(f);
                }}
              />
            </label>
          </div>
          {fileError && (
            <p role="alert" className="mt-3 rounded-btn bg-danger-soft px-3 py-2 text-danger-text">
              {fileError}
            </p>
          )}
          {preview && (
            <div className="mt-4" data-testid="policy-list-preview">
              <p className="font-medium">
                {t('staffLc.issue.fileStats', { total: preview.total, valid: preview.valid, invalid: preview.total - preview.valid })}
              </p>
              <p className="text-muted">
                {t('staffLc.issue.peopleStats', { employees: preview.employees, family: preview.familyMembers })}
              </p>
              {csv && <ListPreview csv={csv} result={preview} />}
              {preview.errors.length > 0 && <p className="mt-2 text-[13px] text-muted">{t('staffLc.issue.errorsNote')}</p>}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>
              {t('common.back')}
            </Button>
            <Button disabled={!preview || preview.valid === 0} onClick={() => setStep(2)}>
              {t('common.next')}
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && preview && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title={t('staffLc.issue.summary')}>
            <dl className="divide-y divide-border-soft" data-testid="policy-summary">
              <Kv label={t('common.program')}>{PROGRAM_LABEL[terms.program]}</Kv>
              <Kv label={t('staffLc.contracts.term')}>
                {formatDate(terms.startDate)} — {formatDate(terms.endDate)}
              </Kv>
              <Kv label={t('staffLc.census.employeesCount')}>{formatNumber(preview.employees)}</Kv>
              <Kv label={t('staffLc.census.familyCount')}>{formatNumber(preview.familyMembers)}</Kv>
              <Kv label={t('staffLc.issue.rates')}>
                {formatMoney(tariff.employee)} / {formatMoney(tariff.family)}
              </Kv>
              <Kv label={t('common.premium')}>
                <span className="num font-semibold">{formatMoney(premium)}</span>
              </Kv>
              {(Object.keys(PROGRAMS[terms.program].limits) as LimitCategory[]).map((cat) => (
                <Kv key={cat} label={t('staffLc.issue.limit', { category: LIMIT_CATEGORY_LABEL[cat].toLowerCase() })}>
                  <span className="num">{formatMoney(PROGRAMS[terms.program].limits[cat])}</span>
                </Kv>
              ))}
            </dl>
          </Card>
          <Card title={t('staffLc.endorsements.clientHr')}>
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={inviteHr} onChange={(e) => setInviteHr(e.target.checked)} />
              {t('staffLc.issue.inviteHr')}
            </label>
            {inviteHr && (
              <div className="mt-3 grid gap-3">
                <Field label={t('staffLc.issue.hrName')} error={tm(hrErrors.fullName) || undefined}>
                  {(a) => <Input {...a} autoComplete="off" maxLength={120} value={hr.fullName} onChange={(e) => setHr((s) => ({ ...s, fullName: e.target.value }))} />}
                </Field>
                <Field label={t('staffLc.issue.hrEmail')} error={tm(hrErrors.email) || undefined}>
                  {(a) => <Input {...a} type="email" autoComplete="off" maxLength={254} value={hr.email} onChange={(e) => setHr((s) => ({ ...s, email: e.target.value }))} />}
                </Field>
                <p className="text-[12px] text-muted">{t('staffLc.issue.hrExists')}</p>
              </div>
            )}
          </Card>
          <div className="flex justify-end gap-2 lg:col-span-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              {t('common.back')}
            </Button>
            <Button loading={issue.isPending} onClick={() => void submit()}>
              {t('staffLc.issue.issue')}
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
