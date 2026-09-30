/* One call-centre case: status, resolution, links to the appointment, letter or claim. */
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
import { BookDialog } from './InsuredCardPage';

export default function CasePage() {
  const { caseId = '' } = useParams();
  const q = useAssistCase(caseId);
  useDocumentTitle('Обращение');
  useTopbar([{ label: 'Обращения', to: '/assist/cases' }, { label: q.data?.number ?? 'Обращение' }]);
  const update = useUpdateCase();
  const canBook = useCan('assist.appointments.manage');
  const [status, setStatus] = useState<AssistanceCase['status'] | ''>('');
  const [resolution, setResolution] = useState('');
  const [error, setError] = useState<string>();
  const [booking, setBooking] = useState(false);

  return (
    <QueryState query={q}>
      {(c) => {
        const readOnly = c.access === 'read';
        const save = async () => {
          const parsed = caseUpdateSchema.safeParse({ status: status || c.status, resolution: resolution || undefined });
          if (!parsed.success) {
            setError(parsed.error.issues[0]?.message);
            return;
          }
          setError(undefined);
          try {
            await update.mutateAsync({ id: c.id, ...parsed.data });
            toast.success('Обращение обновлено');
            setStatus('');
            setResolution('');
          } catch (e) {
            toast.error(errorMessage(e));
          }
        };
        return (
          <div className="grid gap-4 lg:grid-cols-3">
            <div className="flex flex-col gap-4 lg:col-span-2">
              <div className="flex flex-wrap items-center gap-3">
                <h1 className="text-[22px] font-bold">
                  Обращение <span className="num">{c.number}</span>
                </h1>
                <CaseStatus status={c.status} />
                <SlaBadge dueAt={c.slaDueAt} done={c.status === 'resolved'} />
                {readOnly && (
                  <Chip kind="warning">
                    <Lock className="h-3 w-3" aria-hidden /> Клиент передан другому ассистансу: только чтение
                  </Chip>
                )}
              </div>
              <Card title="Суть">
                <p className="whitespace-pre-wrap">{c.description}</p>
                {c.resolution && <p className="mt-3 rounded-btn bg-success-soft px-3 py-2 text-success-text">Решение: {c.resolution}</p>}
              </Card>
              {!readOnly && c.status !== 'resolved' && (
                <Card title="Работа с обращением">
                  <div className="flex flex-col gap-3">
                    <Field label="Статус">
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
                    <Field label="Решение" error={error} hint="Обязательно при закрытии обращения">
                      {(a) => <Textarea {...a} rows={3} maxLength={1000} value={resolution} onChange={(e) => setResolution(e.target.value)} />}
                    </Field>
                    <div className="flex flex-wrap gap-2">
                      <Button loading={update.isPending} onClick={() => void save()}>
                        Сохранить
                      </Button>
                      {canBook && c.type === 'appointment' && !c.links.appointmentId && (
                        <Button variant="secondary" onClick={() => setBooking(true)}>
                          Записать к врачу
                        </Button>
                      )}
                    </div>
                  </div>
                </Card>
              )}
            </div>
            <Card title="Детали">
              <dl className="divide-y divide-border-soft">
                <Kv label="Тип">{CASE_TYPE_LABEL[c.type]}</Kv>
                <Kv label="Канал">{CASE_CHANNEL_LABEL[c.channel]}</Kv>
                <Kv label="Застрахованный">
                  <Link className="text-accent-text hover:underline" to={`/assist/insured/${c.insuredId}`}>
                    {c.insuredName}
                  </Link>
                </Kv>
                <Kv label="Создано">
                  <span className="num">{formatDateTime(c.createdAt)}</span>
                </Kv>
                <Kv label="SLA до">
                  <span className="num">{formatDateTime(c.slaDueAt)}</span>
                </Kv>
                {c.links.appointmentId && <Kv label="Запись">создана, ждёт клинику</Kv>}
                {c.links.guaranteeId && (
                  <Kv label="ГП">
                    <Link className="text-accent-text hover:underline" to={`/assist/guarantees/${c.links.guaranteeId}`}>
                      открыть
                    </Link>
                  </Kv>
                )}
              </dl>
            </Card>
            {booking && <BookDialog insuredId={c.insuredId} caseId={c.id} onClose={() => setBooking(false)} />}
          </div>
        );
      }}
    </QueryState>
  );
}
