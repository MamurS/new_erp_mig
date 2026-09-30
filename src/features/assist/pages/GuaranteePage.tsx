/* One guarantee letter for the assistance doctor: approve up to the authority limit, reject, ask for documents or escalate. */
import { useState } from 'react';
import { useParams } from 'react-router-dom';
import { Download } from 'lucide-react';
import { useAssistDecideGuarantee, useAssistGuarantee, useAssistOverview } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { downloadFile } from '@/shared/api/files';
import { useCan } from '@/shared/auth/guards';
import { needsEscalation } from '@/shared/domain/assistance';
import { GUARANTEE_STATUS_CHIP, GUARANTEE_STATUS_LABEL } from '@/shared/domain/clinics';
import { assistGuaranteeDecisionSchema } from '@/shared/schemas/forms';
import { addDaysISO, formatDate, formatDateTime, formatMoney, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { Card, Kv } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';

type Mode = 'approve' | 'reject' | 'request_info' | 'escalate';

export default function GuaranteePage() {
  const { guaranteeId = '' } = useParams();
  const q = useAssistGuarantee(guaranteeId);
  const overview = useAssistOverview();
  useDocumentTitle('Гарантийное письмо');
  useTopbar([{ label: 'Гарантийные письма', to: '/assist/guarantees' }, { label: q.data?.number ?? 'Письмо' }]);
  const canDecide = useCan('assist.guarantees.decide');
  const decide = useAssistDecideGuarantee();
  const limit = overview.data?.authorityLimit ?? 10_000_000;
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState('');
  const [validUntil, setValidUntil] = useState(addDaysISO(todayISO(), 30));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});

  return (
    <QueryState query={q}>
      {(g) => {
        const over = needsEscalation(g.estimatedCost, limit);
        const current: Mode = mode ?? (over ? 'escalate' : 'approve');
        const amountNum = Number((amount || String(g.estimatedCost)).replace(/\s/g, ''));
        const open = canDecide && g.status === 'requested' && !g.escalated;
        const submit = async () => {
          const raw = current === 'approve' ? { action: current, amount: amountNum, validUntil } : { action: current, reason };
          const parsed = assistGuaranteeDecisionSchema.safeParse(raw);
          if (!parsed.success) {
            setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), i.message])));
            return;
          }
          if (parsed.data.action === 'approve' && needsEscalation(parsed.data.amount, limit)) {
            setErrors({ amount: `Выше полномочий (${formatMoney(limit)}): эскалируйте в МИГ` });
            return;
          }
          setErrors({});
          try {
            const res = await decide.mutateAsync({ id: g.id, body: parsed.data });
            toast.success(res.escalated ? 'Письмо передано на решение в МИГ' : res.status === 'approved' ? 'Письмо одобрено, лимит зарезервирован' : res.status === 'rejected' ? 'Письмо отклонено' : 'Клинике отправлен запрос документов');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        };
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[22px] font-bold">
                  Гарантийное письмо <span className="num">{g.number}</span>
                </h1>
                <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
                {g.escalated && <Chip kind="warning">{g.status === 'requested' ? 'Передано в МИГ' : 'Решение МИГ'}</Chip>}
              </div>
              <Card title="Запрос клиники">
                <dl className="grid gap-x-6 sm:grid-cols-2">
                  <Kv label="Пациент">{g.insuredName}</Kv>
                  <Kv label="Клиника">{g.clinicName}</Kv>
                  <Kv label="Услуга">
                    {g.serviceCode} · {g.serviceName}
                  </Kv>
                  <Kv label="МКБ-10">{g.icd10}</Kv>
                  <Kv label="Оценка стоимости">
                    <span className="num">{formatMoney(g.estimatedCost)}</span>
                  </Kv>
                  <Kv label="Запрошено">
                    <span className="num">{formatDateTime(g.createdAt)}</span>
                  </Kv>
                  {g.approvedAmount !== undefined && (
                    <Kv label="Одобрено">
                      <span className="num">{formatMoney(g.approvedAmount)}</span>
                      {g.validUntil ? ` до ${formatDate(g.validUntil)}` : ''}
                    </Kv>
                  )}
                </dl>
                {g.comment && <p className="mt-3 rounded-btn bg-rail px-3 py-2 text-[13px]">Комментарий клиники: {g.comment}</p>}
                {g.assistanceOpinion && <p className="mt-2 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text">Заключение врача ассистанса: {g.assistanceOpinion}</p>}
                {g.reason && <p className="mt-2 text-[13px] text-muted">Причина решения: {g.reason}</p>}
                {g.attachments.length > 0 && (
                  <ul className="mt-3 flex flex-wrap gap-2">
                    {g.attachments.map((a) => (
                      <li key={a.id}>
                        <Button size="sm" variant="secondary" onClick={() => void downloadFile(a.id, a.fileName).catch((e: unknown) => toast.error(errorMessage(e)))}>
                          <Download className="h-3.5 w-3.5" aria-hidden /> {a.fileName}
                        </Button>
                      </li>
                    ))}
                  </ul>
                )}
              </Card>
              {open && (
                <Card title="Решение">
                  {over && (
                    <p className="mb-3 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="over-authority">
                      Сумма выше полномочий ассистанса ({formatMoney(limit)}). Дайте заключение и передайте решение в МИГ.
                    </p>
                  )}
                  <div className="mb-3 flex flex-wrap gap-3" role="radiogroup" aria-label="Решение">
                    {(
                      [
                        ['approve', 'Одобрить'],
                        ['reject', 'Отклонить'],
                        ['request_info', 'Запросить документы'],
                        ['escalate', 'Эскалировать в МИГ'],
                      ] as const
                    ).map(([m, label]) => (
                      <label key={m} className="flex items-center gap-1.5">
                        <input type="radio" name="decision" checked={current === m} onChange={() => setMode(m)} disabled={m === 'approve' && over} />
                        {label}
                      </label>
                    ))}
                  </div>
                  {current === 'approve' ? (
                    <div className="grid gap-3 sm:grid-cols-2">
                      <Field label="Сумма, UZS" error={errors.amount} hint={`Полномочия ассистанса — до ${formatMoney(limit)}`}>
                        {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={amount || String(g.estimatedCost)} onChange={(e) => setAmount(e.target.value)} />}
                      </Field>
                      <Field label="Действует до" error={errors.validUntil}>
                        {(a) => <Input {...a} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
                      </Field>
                    </div>
                  ) : (
                    <Field label={current === 'escalate' ? 'Заключение врача для МИГ' : current === 'reject' ? 'Причина отказа' : 'Какие документы нужны'} error={errors.reason}>
                      {(a) => <Textarea {...a} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
                    </Field>
                  )}
                  <Button className="mt-3" loading={decide.isPending} onClick={() => void submit()}>
                    {current === 'approve' ? 'Одобрить' : current === 'reject' ? 'Отклонить' : current === 'escalate' ? 'Передать в МИГ' : 'Запросить документы'}
                  </Button>
                </Card>
              )}
            </div>
            <Card title="История решений">
              {g.approvals.length === 0 ? (
                <p className="text-muted">Решений пока нет</p>
              ) : (
                <ul className="flex flex-col gap-2">
                  {g.approvals.map((a) => (
                    <li key={`${a.byId}-${a.at}`}>
                      <span className="font-medium">{a.byName}</span> <span className="num text-muted">{formatDateTime(a.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Card>
          </div>
        );
      }}
    </QueryState>
  );
}
