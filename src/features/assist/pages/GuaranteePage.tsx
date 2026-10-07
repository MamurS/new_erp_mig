/* One guarantee letter for the assistance doctor: approve up to the authority limit, reject, ask for documents or escalate. */
import { SideColumn } from '@/shared/ui/side-column';
import { AiHint } from '@/features/ai/AiHint';
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
import { useDmsParam } from '@/shared/api/queries/params';
import { t, tm } from '@/i18n';

type Mode = 'approve' | 'reject' | 'request_info' | 'escalate';

export default function GuaranteePage() {
  const { guaranteeId = '' } = useParams();
  const q = useAssistGuarantee(guaranteeId);
  const overview = useAssistOverview();
  useDocumentTitle(t('assist.guarantee.docTitle'));
  useTopbar([{ label: t('assist.nav.guarantees'), to: '/assist/guarantees' }, { label: q.data?.number ?? t('assist.guarantee.crumb') }]);
  const canDecide = useCan('assist.guarantees.decide');
  const decide = useAssistDecideGuarantee();
  const validityDays = useDmsParam('guaranteeValidityDays');
  const [mode, setMode] = useState<Mode | null>(null);
  const [amount, setAmount] = useState('');
  const [validUntil, setValidUntil] = useState(() => addDaysISO(todayISO(), validityDays));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  // The authority limit comes from the server: the contract value or the DMS parameter.
  const limit = overview.data?.authorityLimit;
  if (limit === undefined) return <QueryState query={overview}>{() => null}</QueryState>;

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
            setErrors(Object.fromEntries(parsed.error.issues.map((i) => [String(i.path[0]), tm(i.message)])));
            return;
          }
          if (parsed.data.action === 'approve' && needsEscalation(parsed.data.amount, limit)) {
            setErrors({ amount: t('assist.guarantee.overAuthority', { amount: formatMoney(limit) }) });
            return;
          }
          setErrors({});
          try {
            const res = await decide.mutateAsync({ id: g.id, body: parsed.data });
            toast.success(res.escalated ? t('assist.guarantee.toastEscalated') : res.status === 'approved' ? t('assist.guarantee.toastApproved') : res.status === 'rejected' ? t('assist.guarantee.toastRejected') : t('assist.guarantee.toastInfo'));
          } catch (e) {
            toast.error(errorMessage(e));
          }
        };
        return (
          <>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[22px] font-bold">{t('assist.guarantee.heading', { number: g.number })}</h1>
                <Chip kind={GUARANTEE_STATUS_CHIP[g.status]}>{GUARANTEE_STATUS_LABEL[g.status]}</Chip>
                {g.escalated && <Chip kind="warning">{g.status === 'requested' ? t('assist.guarantee.sentToMig') : t('assist.guarantee.migDecision')}</Chip>}
              </div>
              <Card title={t('assist.guarantee.clinicRequest')}>
                <dl className="grid gap-x-6 sm:grid-cols-2">
                  <Kv label={t('common.patient')}>{g.insuredName}</Kv>
                  <Kv label={t('common.clinic')}>{g.clinicName}</Kv>
                  <Kv label={t('common.service')}>
                    {g.serviceCode} · {g.serviceName}
                  </Kv>
                  <Kv label={t('assist.guarantee.icd10')}>{g.icd10}</Kv>
                  <Kv label={t('assist.guarantee.estimatedCost')}>
                    <span className="num">{formatMoney(g.estimatedCost)}</span>
                  </Kv>
                  <Kv label={t('assist.guarantee.requested')}>
                    <span className="num">{formatDateTime(g.createdAt)}</span>
                  </Kv>
                  {g.approvedAmount !== undefined && (
                    <Kv label={t('assist.guarantee.approved')}>
                      <span className="num">{formatMoney(g.approvedAmount)}</span>
                      {g.validUntil ? t('assist.guarantee.validUntil', { date: formatDate(g.validUntil) }) : ''}
                    </Kv>
                  )}
                </dl>
                {g.comment && <p className="mt-3 rounded-btn bg-rail px-3 py-2 text-[13px]">{t('assist.guarantee.clinicComment', { text: g.comment })}</p>}
                {g.assistanceOpinion && <p className="mt-2 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text">{t('assist.guarantee.doctorOpinion', { text: g.assistanceOpinion })}</p>}
                {g.reason && <p className="mt-2 text-[13px] text-muted">{t('assist.guarantee.decisionReason', { text: g.reason })}</p>}
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
              <AiHint subject={{ type: 'guarantee', id: g.id }} />
              {open && (
                <Card title={t('common.decision')}>
                  {over && (
                    <p className="mb-3 rounded-btn bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="over-authority">
                      {t('assist.guarantee.overAuthorityNote', { amount: formatMoney(limit) })}
                    </p>
                  )}
                  <div className="mb-3 flex flex-wrap gap-3" role="radiogroup" aria-label={t('common.decision')}>
                    {(
                      [
                        ['approve', t('common.approve')],
                        ['reject', t('common.reject')],
                        ['request_info', t('assist.guarantee.requestDocs')],
                        ['escalate', t('assist.guarantee.escalate')],
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
                      <Field label={t('assist.guarantee.amountUzs')} error={errors.amount} hint={t('assist.guarantee.authorityHint', { amount: formatMoney(limit) })}>
                        {(a) => <Input {...a} inputMode="numeric" maxLength={14} value={amount || String(g.estimatedCost)} onChange={(e) => setAmount(e.target.value)} />}
                      </Field>
                      <Field label={t('common.validUntil')} error={errors.validUntil}>
                        {(a) => <Input {...a} type="date" value={validUntil} onChange={(e) => setValidUntil(e.target.value)} />}
                      </Field>
                    </div>
                  ) : (
                    <Field label={current === 'escalate' ? t('assist.guarantee.opinionForMig') : current === 'reject' ? t('assist.guarantee.rejectReason') : t('assist.guarantee.whichDocs')} error={errors.reason}>
                      {(a) => <Textarea {...a} rows={3} maxLength={1000} value={reason} onChange={(e) => setReason(e.target.value)} />}
                    </Field>
                  )}
                  <Button className="mt-3" loading={decide.isPending} onClick={() => void submit()}>
                    {current === 'approve' ? t('common.approve') : current === 'reject' ? t('common.reject') : current === 'escalate' ? t('assist.guarantee.sendToMig') : t('assist.guarantee.requestDocs')}
                  </Button>
                </Card>
              )}
            </div>
            <SideColumn label={t('assist.guarantee.history')} width={360} testId="guarantee-history-column">
            <Card title={t('assist.guarantee.history')}>
              {g.approvals.length === 0 ? (
                <p className="text-muted">{t('assist.guarantee.noDecisions')}</p>
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
            </SideColumn>
          </>
        );
      }}
    </QueryState>
  );
}
