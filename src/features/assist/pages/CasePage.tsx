/* One call-centre case: status, resolution, links to the appointment, letter or claim. */
import { SideColumn } from '@/shared/ui/side-column';
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { Lock } from 'lucide-react';
import type { AssistanceCase } from '@/shared/types';
import { useAssistCase, useUpdateCase } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CASE_CHANNEL_LABEL, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '@/shared/domain/assistance';
import { caseUpdateSchema } from '@/shared/schemas/forms';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Select, Textarea } from '@/shared/ui/input';
import { Card, Kv } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { CaseStatus, SlaBadge } from '../components';
import { BookDialog, RequestGuaranteeDialog } from './InsuredCardPage';
import { t, tm } from '@/i18n';

export default function CasePage() {
  const { caseId = '' } = useParams();
  const q = useAssistCase(caseId);
  useDocumentTitle(t('assist.case.docTitle'));
  useTopbar([{ label: t('assist.cases.title'), to: '/assist/cases' }, { label: q.data?.number ?? t('assist.case.docTitle') }]);
  const update = useUpdateCase();
  const canBook = useCan('assist.appointments.manage');
  const [status, setStatus] = useState<AssistanceCase['status'] | ''>('');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string>();
  const [booking, setBooking] = useState(false);
  const [requesting, setRequesting] = useState(false);

  return (
    <QueryState query={q}>
      {(c) => {
        const readOnly = c.access === 'read';
        const save = async () => {
          const parsed = caseUpdateSchema.safeParse({ status: status || c.status, resolution: resolution || undefined });
          if (!parsed.success) {
            setError(tm(parsed.error.issues[0]?.message));
            return;
          }
          setError(undefined);
          try {
            await update.mutateAsync({ id: c.id, ...parsed.data });
            toast.success(t('assist.case.updated'));
            setStatus('');
            setResolution('');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        };
        return (
          <>
            <div className="flex min-w-0 flex-col gap-4">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[22px] font-bold">{t('assist.case.heading', { number: c.number })}</h1>
                <CaseStatus status={c.status} />
                <SlaBadge dueAt={c.slaDueAt} done={c.status === 'resolved'} />
                {readOnly && (
                  <Chip kind="warning">
                    <Lock className="h-3 w-3" aria-hidden /> {t('assist.case.transferred')}
                  </Chip>
                )}
              </div>
              <Card title={t('assist.cases.essence')}>
                <p className="whitespace-pre-wrap">{c.description}</p>
                {c.resolution && <p className="mt-3 rounded-btn bg-success-soft px-3 py-2 text-success-text">{t('assist.case.resolution', { text: c.resolution })}</p>}
              </Card>
              {!readOnly && c.status !== 'resolved' && (
                <Card title={t('assist.case.work')}>
                  <div className="flex flex-col gap-3">
                    <Field label={t('common.status')}>
                      {(a) => (
                        <Select {...a} value={status || c.status} onChange={(e) => setStatus(e.target.value as AssistanceCase['status'])}>
                          {Object.entries(CASE_STATUS_LABEL).map(([k, v]) => (
                            <option key={k} value={k}>
                              {v}
                            </option>
                          ))}
                        </Select>
                      )}
                    </Field>
                    <Field label={t('common.decision')} error={error} hint={t('assist.case.resolutionHint')}>
                      {(a) => <Textarea {...a} rows={3} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} />}
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button loading={update.isPending} onClick={() => void save()}>
                        {t('common.save')}
                      </Button>
                      {c.type === 'guarantee' && !c.links.guaranteeId && (
                        <Button variant="secondary" onClick={() => setRequesting(true)}>
                          {t('assist.case.requestGuarantee')}
                        </Button>
                      )}
                      {canBook && c.type === 'appointment' && !c.links.appointmentId && (
                        <Button variant="secondary" onClick={() => setBooking(true)}>
                          {t('assist.case.book')}
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </div>
            <SideColumn label={t('assist.case.details')} width={360} testId="case-details-column">
            <Card title={t('assist.case.details')}>
              <dl className="divide-y divide-border-soft">
                <Kv label={t('common.type')}>{CASE_TYPE_LABEL[c.type]}</Kv>
                <Kv label={t('assist.cases.channel')}>{CASE_CHANNEL_LABEL[c.channel]}</Kv>
                <Kv label={t('common.insured')}>
                  <Link className="text-accent-text hover:underline" to={`/assist/insured/${c.insuredId}`}>
                    {c.insuredName}
                  </Link>
                </Kv>
                <Kv label={t('common.created')}>
                  <span className="num">{formatDateTime(c.createdAt)}</span>
                </Kv>
                <Kv label={t('assist.case.slaUntil')}>
                  <span className="num">{formatDateTime(c.slaDueAt)}</span>
                </Kv>
                {c.links.appointmentId && <Kv label={t('assist.case.appointment')}>{t('assist.case.appointmentCreated')}</Kv>}
                {c.links.claimId && <Kv label={t('assist.case.claim')}>{t('assist.case.claimCreated')}</Kv>}
                {c.links.guaranteeId && (
                  <Kv label={t('assist.case.guarantee')}>
                    <Link className="text-accent-text hover:underline" to={`/assist/guarantees/${c.links.guaranteeId}`}>
                      {t('assist.case.open')}
                    </Link>
                  </Kv>
                )}
              </dl>
            </Card>
            </SideColumn>
            {booking && <BookDialog insuredId={c.insuredId} caseId={c.id} onClose={() => setBooking(false)} />}
            {requesting && <RequestGuaranteeDialog insuredId={c.insuredId} caseId={c.id} onClose={() => setRequesting(false)} />}
          </>
        );
      }}
    </QueryState>
  );
}
