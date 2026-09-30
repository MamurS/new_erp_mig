/* Clinic appointments (CLINIC_SPEC §4.3): requests to answer and the day/week schedule. */
import { useState } from 'react';
import type { Appointment } from '@/shared/types';
import type { ClinicAppointment } from '@/shared/api/schemas-clinic';
import { useClinicAppointments, useClinicSlots, useRespondAppointment } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { addDaysISO, formatDate, formatDateTime, formatTime, todayISO } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { EmptyState, QueryState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { PageTitle, Panel } from '../components';

const KEYS = ['view', 'range'] as const;

function RescheduleDialog({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const [date, setDate] = useState(() => (appt.startsAt.slice(0, 10) > todayISO() ? appt.startsAt.slice(0, 10) : addDaysISO(todayISO(), 1)));
  const slots = useClinicSlots(date, true);
  const respond = useRespondAppointment();
  const [picked, setPicked] = useState<string | null>(null);
  const submit = async () => {
    if (!picked) return;
    try {
      await respond.mutateAsync({ id: appt.id, kind: 'reschedule', startsAt: picked });
      toast.success('Пациенту предложено другое время');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Предложить другое время"
      description={`${appt.insuredName} · ${SPECIALTY_LABEL[appt.specialty]} · сейчас ${formatDateTime(appt.startsAt)}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button disabled={!picked} loading={respond.isPending} onClick={() => void submit()}>
            Предложить
          </Button>
        </>
      }
    >
      <Field label="День">
        {(a) => <Input {...a} type="date" min={todayISO()} value={date} onChange={(e) => { setDate(e.target.value); setPicked(null); }} />}
      </Field>
      <div className="mt-3 flex flex-wrap gap-1.5" role="radiogroup" aria-label="Свободное время">
        {slots.isLoading ? (
          <SkeletonRows rows={2} />
        ) : (slots.data ?? []).filter((s) => Date.parse(s.startsAt) > Date.now()).length === 0 ? (
          <p className="text-muted">На этот день свободного времени нет</p>
        ) : (
          (slots.data ?? [])
            .filter((s) => Date.parse(s.startsAt) > Date.now())
            .map((s) => (
              <button
                key={s.startsAt}
                type="button"
                role="radio"
                aria-checked={picked === s.startsAt}
                onClick={() => setPicked(s.startsAt)}
                className={cn('rounded-btn border border-border px-3 py-1.5 num', picked === s.startsAt ? 'border-accent bg-accent text-white' : 'hover:bg-rail')}
              >
                {formatTime(s.startsAt)}
              </button>
            ))
        )}
      </div>
    </Modal>
  );
}

function DeclineDialog({ appt, onClose }: { appt: Appointment; onClose: () => void }) {
  const [reason, setReason] = useState('');
  const [touched, setTouched] = useState(false);
  const respond = useRespondAppointment();
  const invalid = reason.trim().length < 3;
  const submit = async () => {
    setTouched(true);
    if (invalid) return;
    try {
      await respond.mutateAsync({ id: appt.id, kind: 'decline', reason: reason.trim() });
      toast.success('Заявка отклонена');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Отклонить заявку"
      description="Причину увидит пациент и оператор МИГ"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button variant="danger" loading={respond.isPending} onClick={() => void submit()}>
            Отклонить
          </Button>
        </>
      }
    >
      <Field label="Причина" error={touched && invalid ? 'Укажите причину: минимум 3 символа' : undefined}>
        {(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}
      </Field>
    </Modal>
  );
}

export default function AppointmentsPage() {
  useDocumentTitle('Записи');
  const [f, setF] = useUrlFilters(KEYS);
  const view = f.view === 'schedule' ? 'schedule' : 'requests';
  const days = f.range === 'week' ? 7 : 1;
  const [from, setFrom] = useState(todayISO());
  const q = useClinicAppointments(view, from, days);
  const respond = useRespondAppointment();
  const [reschedule, setReschedule] = useState<Appointment | null>(null);
  const [decline, setDecline] = useState<Appointment | null>(null);

  const confirm = async (a: Appointment) => {
    try {
      await respond.mutateAsync({ id: a.id, kind: 'confirm' });
      toast.success('Запись подтверждена');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<ClinicAppointment>[] = [
    { key: 'who', header: 'Пациент', cell: (a) => <span className="font-medium">{a.insuredName}</span> },
    { key: 'spec', header: 'Специальность', cell: (a) => SPECIALTY_LABEL[a.specialty] },
    { key: 'when', header: 'Время', cell: (a) => <span className="num whitespace-nowrap">{formatDateTime(a.startsAt)}</span> },
    {
      key: 'created',
      header: 'Заявка',
      cell: (a) => (
        <span className="flex flex-wrap items-center gap-1.5 whitespace-nowrap">
          <span className="num text-muted">{formatDateTime(a.createdAt)}</span>
          {a.overdue && <Chip kind="danger">Ответ просрочен</Chip>}
          {a.proposedStartsAt && <Chip kind="sky">Предложено {formatDateTime(a.proposedStartsAt)}</Chip>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) =>
        a.proposedStartsAt ? (
          <span className="text-[12px] text-muted">Ждём ответа пациента</span>
        ) : (
          <span className="inline-flex flex-wrap justify-end gap-1.5">
            <Button size="sm" loading={respond.isPending && respond.variables?.id === a.id} onClick={() => void confirm(a)} aria-label={`Подтвердить: ${a.insuredName}`}>
              Подтвердить
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setReschedule(a)}>
              Другое время
            </Button>
            <Button size="sm" variant="secondary" onClick={() => setDecline(a)}>
              Отклонить
            </Button>
          </span>
        ),
    },
  ];

  const bySpecialty = new Map<string, ClinicAppointment[]>();
  for (const a of view === 'schedule' ? (q.data ?? []) : []) {
    const list = bySpecialty.get(a.specialty) ?? [];
    list.push(a);
    bySpecialty.set(a.specialty, list);
  }

  return (
    <>
      <PageTitle title="Записи" subtitle="Ответ сразу видит пациент в приложении и оператор МИГ. Заявки без ответа дольше 2 часов уходят оператору" />
      <div role="tablist" aria-label="Вид" className="mb-4 flex gap-1.5">
        {(['requests', 'schedule'] as const).map((v) => (
          <button
            key={v}
            role="tab"
            type="button"
            aria-selected={view === v}
            onClick={() => setF({ view: v === 'requests' ? null : v })}
            className={cn('rounded-full px-4 py-2 font-semibold', view === v ? 'bg-accent text-white' : 'hover:bg-rail')}
          >
            {v === 'requests' ? 'Заявки' : 'Расписание'}
          </button>
        ))}
      </div>
      {view === 'requests' ? (
        <Panel>
          <DataTable
            caption="Заявки на запись"
            columns={columns}
            rows={q.data}
            rowKey={(a) => a.id}
            loading={q.isLoading}
            error={q.error}
            onRetry={() => void q.refetch()}
            empty={<EmptyState title="Все заявки обработаны" description="Новые заявки появятся здесь сразу после записи пациента" />}
          />
        </Panel>
      ) : (
        <>
          <div className="mb-3 flex flex-wrap items-end gap-3">
            <Field label="С даты">
              {(a) => <Input {...a} type="date" value={from} onChange={(e) => setFrom(e.target.value || todayISO())} className="w-44" />}
            </Field>
            <div className="flex gap-1.5">
              <Button variant={days === 1 ? 'primary' : 'secondary'} size="sm" onClick={() => setF({ range: null })}>
                День
              </Button>
              <Button variant={days === 7 ? 'primary' : 'secondary'} size="sm" onClick={() => setF({ range: 'week' })}>
                Неделя
              </Button>
            </div>
          </div>
          <QueryState query={q} skeleton={<SkeletonRows rows={6} />}>
            {() =>
              bySpecialty.size === 0 ? (
                <EmptyState title="Записей нет" description={`${formatDate(from)}${days > 1 ? ` — ${formatDate(addDaysISO(from, days - 1))}` : ''}`} />
              ) : (
                <div className="grid gap-3 lg:grid-cols-2">
                  {[...bySpecialty.entries()].map(([spec, list]) => (
                    <Panel key={spec} title={SPECIALTY_LABEL[spec as Appointment['specialty']]}>
                      <ul className="divide-y divide-border-soft">
                        {list.map((a) => (
                          <li key={a.id} className="flex items-center justify-between gap-2 px-4 py-2">
                            <span>
                              <span className="num font-semibold">{days > 1 ? formatDateTime(a.startsAt) : formatTime(a.startsAt)}</span> · {a.insuredName}
                            </span>
                            <Chip kind={a.status === 'confirmed' ? 'success' : a.status === 'completed' ? 'neutral' : 'warning'}>
                              {a.status === 'confirmed' ? 'Подтверждена' : a.status === 'completed' ? 'Состоялась' : 'Ждёт ответа'}
                            </Chip>
                          </li>
                        ))}
                      </ul>
                    </Panel>
                  ))}
                </div>
              )
            }
          </QueryState>
        </>
      )}
      {reschedule && <RescheduleDialog appt={reschedule} onClose={() => setReschedule(null)} />}
      {decline && <DeclineDialog appt={decline} onClose={() => setDecline(null)} />}
    </>
  );
}
