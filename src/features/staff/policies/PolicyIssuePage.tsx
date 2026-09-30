/* Policy issuance wizard (POLICY_SPEC §4): terms → list of insured persons → review and HR invite. */
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, FileUp } from 'lucide-react';
import type { LimitCategory, ProgramCode } from '@/shared/types';
import type { PolicyListCheck } from '@/shared/types/dto';
import { useClient } from '@/shared/api/queries/staff';
import { useCheckPolicyList, useIssuePolicy } from '@/shared/api/queries/policies';
import { errorMessage } from '@/shared/api/client';
import { LIMIT_CATEGORY_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { PROGRAMS } from '@/shared/domain/programs';
import { defaultEndDate, defaultTariff, POLICY_CSV_HEADER, POLICY_CSV_MAX_BYTES, POLICY_CSV_MAX_ROWS, policyPeriodProblem, policyPremium } from '@/shared/domain/policies';
import { policyHrInviteSchema, policyTermsSchema } from '@/shared/schemas/forms';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { addDaysISO, formatDate, formatMoney, formatNumber, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Field, Input } from '@/shared/ui/input';
import { Card, Kv } from '@/shared/ui/page';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

const PROGRAM_CODES: ProgramCode[] = ['basic', 'standard', 'standard_plus', 'premium'];
const STEPS = ['Условия', 'Список застрахованных', 'Проверка'] as const;

interface Terms {
  program: ProgramCode;
  startDate: string;
  endDate: string;
  employee: string;
  family: string;
}

const toNumber = (v: string) => Number(v.replace(/\s/g, ''));

function Steps({ step }: { step: number }) {
  return (
    <ol className="flex flex-wrap gap-2" aria-label="Шаги оформления">
      {STEPS.map((label, i) => (
        <li
          key={label}
          aria-current={i === step ? 'step' : undefined}
          className={cn('rounded-full border px-3 py-1 text-[13px]', i === step ? 'border-accent bg-accent-soft font-semibold text-accent-text' : i < step ? 'border-border text-text' : 'border-border text-muted')}
        >
          {i + 1}. {label}
        </li>
      ))}
    </ol>
  );
}

export default function PolicyIssuePage() {
  const { clientId = '' } = useParams();
  const navigate = useNavigate();
  const client = useClient(clientId);
  useDocumentTitle('Оформление полиса');
  useTopbar([{ label: 'Клиенты', to: '/staff/clients' }, { label: client.data?.name ?? 'Клиент', to: `/staff/clients/${clientId}` }, { label: 'Оформление полиса' }]);
  const check = useCheckPolicyList();
  const issue = useIssuePolicy();

  const [step, setStep] = useState(0);
  const start = addDaysISO(todayISO(), 1);
  const [terms, setTerms] = useState<Terms>(() => {
    const t = defaultTariff('standard');
    return { program: 'standard', startDate: start, endDate: defaultEndDate(start), employee: String(t.employee), family: String(t.family) };
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
    const t = defaultTariff(program);
    setTerms((s) => ({ ...s, program, employee: String(t.employee), family: String(t.family) }));
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
    const rows = [['Иванов Иван Иванович', '15.03.1990', '31503900000001', '+998901234567', 'Инженер', 2]];
    downloadText(toCsv(POLICY_CSV_HEADER, rows), 'policy-insured-template.csv');
  };

  const onFile = async (file: File) => {
    setPreview(null);
    setCsv(null);
    if (!/\.csv$/i.test(file.name) || (file.type && !['text/csv', 'application/vnd.ms-excel', 'text/plain'].includes(file.type))) {
      setFileError('Нужен файл .csv — в Excel: «Сохранить как» → CSV UTF-8');
      return;
    }
    if (file.size > POLICY_CSV_MAX_BYTES) {
      setFileError('Файл больше 5 МБ — разделите список на несколько файлов');
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
      toast.success(`Полис ${policy.number} оформлен`);
      navigate(`/staff/policies/${policy.id}`, { replace: true });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex flex-col gap-4">
      <div>
        <h1 className="text-[22px] font-bold">Оформление полиса</h1>
        <p className="text-muted">
          {c.legalForm} «{c.name}» · ИНН <span className="num">{c.inn}</span>
        </p>
      </div>
      <Steps step={step} />

      {step === 0 && (
        <Card title="Условия полиса">
          <fieldset>
            <legend className="mb-2 text-[12px] font-medium text-muted">Программа</legend>
            <div className="grid gap-3 md:grid-cols-2 xl:grid-cols-4" role="radiogroup" aria-label="Программа">
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
                  <span className="block text-[12px] text-muted">тариф {formatMoney(defaultTariff(code).employee)} в год</span>
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
            <Field label="Начало" error={termErrors.startDate}>
              {(a) => <Input {...a} type="date" value={terms.startDate} onChange={(e) => setTerms((s) => ({ ...s, startDate: e.target.value, endDate: e.target.value ? defaultEndDate(e.target.value) : s.endDate }))} />}
            </Field>
            <Field label="Окончание" error={termErrors.endDate}>
              {(a) => <Input {...a} type="date" value={terms.endDate} onChange={(e) => setTerms((s) => ({ ...s, endDate: e.target.value }))} />}
            </Field>
            <Field label="Тариф на сотрудника, UZS в год" error={termErrors.employee}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={13} value={terms.employee} onChange={(e) => setTerms((s) => ({ ...s, employee: e.target.value }))} />}
            </Field>
            <Field label="Тариф на члена семьи, UZS в год" error={termErrors.family}>
              {(a) => <Input {...a} inputMode="numeric" maxLength={13} value={terms.family} onChange={(e) => setTerms((s) => ({ ...s, family: e.target.value }))} />}
            </Field>
          </div>
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => navigate(`/staff/clients/${clientId}`)}>
              Отмена
            </Button>
            <Button onClick={nextFromTerms}>Далее</Button>
          </div>
        </Card>
      )}

      {step === 1 && (
        <Card title="Список застрахованных">
          <p className="text-muted">
            Список сотрудников от клиента — приложение 1 к полису. Файл .csv в UTF-8, до 5 МБ и {formatNumber(POLICY_CSV_MAX_ROWS)} строк. Колонки: <code>{POLICY_CSV_HEADER.join(', ')}</code>; <code>familyMembers</code> — сколько членов семьи
            застраховано вместе с сотрудником (0–10, можно не заполнять).
          </p>
          <div className="mt-3 flex flex-wrap items-center gap-2">
            <Button variant="secondary" onClick={template}>
              <Download className="h-3.5 w-3.5" aria-hidden /> Скачать шаблон CSV
            </Button>
            <label className="inline-flex h-8 cursor-pointer items-center gap-1.5 rounded-btn border border-border px-3 text-[13px] font-medium hover:bg-rail">
              <FileUp className="h-3.5 w-3.5" aria-hidden /> {check.isPending ? 'Проверяем…' : 'Загрузить список'}
              <input
                type="file"
                accept=".csv,text/csv"
                className="sr-only"
                aria-label="Файл со списком застрахованных"
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
                Строк в файле: {preview.total} · корректных: {preview.valid} · с ошибками: {preview.total - preview.valid}
              </p>
              <p className="text-muted">
                Сотрудников: {preview.employees}, членов семьи: {preview.familyMembers}
              </p>
              {preview.errors.length > 0 && (
                <ul className="mt-2 max-h-56 overflow-auto rounded-btn bg-danger-soft p-2 text-[13px] text-danger-text">
                  {preview.errors.slice(0, 200).map((e, i) => (
                    <li key={`${e.row}-${e.field}-${i}`}>
                      Строка {e.row}
                      {e.field ? `, ${e.field}` : ''}: {e.message}
                    </li>
                  ))}
                </ul>
              )}
              {preview.errors.length > 0 && <p className="mt-2 text-[13px] text-muted">Строки с ошибками не попадут в полис — исправьте их в файле и загрузите снова.</p>}
            </div>
          )}
          <div className="mt-4 flex justify-end gap-2">
            <Button variant="secondary" onClick={() => setStep(0)}>
              Назад
            </Button>
            <Button disabled={!preview || preview.valid === 0} onClick={() => setStep(2)}>
              Далее
            </Button>
          </div>
        </Card>
      )}

      {step === 2 && preview && (
        <div className="grid gap-4 lg:grid-cols-2">
          <Card title="Итоги">
            <dl className="divide-y divide-border-soft" data-testid="policy-summary">
              <Kv label="Программа">{PROGRAM_LABEL[terms.program]}</Kv>
              <Kv label="Срок">
                {formatDate(terms.startDate)} — {formatDate(terms.endDate)}
              </Kv>
              <Kv label="Сотрудников">{formatNumber(preview.employees)}</Kv>
              <Kv label="Членов семьи">{formatNumber(preview.familyMembers)}</Kv>
              <Kv label="Тарифы">
                {formatMoney(tariff.employee)} / {formatMoney(tariff.family)}
              </Kv>
              <Kv label="Премия">
                <span className="num font-semibold">{formatMoney(premium)}</span>
              </Kv>
            </dl>
          </Card>
          <Card title="HR клиента">
            <label className="flex items-center gap-2">
              <input type="checkbox" checked={inviteHr} onChange={(e) => setInviteHr(e.target.checked)} />
              Пригласить HR клиента в кабинет
            </label>
            {inviteHr && (
              <div className="mt-3 grid gap-3">
                <Field label="ФИО HR" error={hrErrors.fullName}>
                  {(a) => <Input {...a} autoComplete="off" maxLength={120} value={hr.fullName} onChange={(e) => setHr((s) => ({ ...s, fullName: e.target.value }))} />}
                </Field>
                <Field label="Email HR" error={hrErrors.email}>
                  {(a) => <Input {...a} type="email" autoComplete="off" maxLength={254} value={hr.email} onChange={(e) => setHr((s) => ({ ...s, email: e.target.value }))} />}
                </Field>
                <p className="text-[12px] text-muted">Если у компании уже есть HR в системе, новый пользователь не создаётся.</p>
              </div>
            )}
          </Card>
          <div className="flex justify-end gap-2 lg:col-span-2">
            <Button variant="secondary" onClick={() => setStep(1)}>
              Назад
            </Button>
            <Button loading={issue.isPending} onClick={() => void submit()}>
              Оформить полис
            </Button>
          </div>
        </div>
      )}
    </div>
  );
}
