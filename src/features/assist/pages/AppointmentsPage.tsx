/* Appointments of the assistance's insured (§5.1): the clinic answers; overdue requests escalate here. */
import { useState } from 'react';
import type { AssistAppointment } from '@/shared/types/dto';
import { useAssistAppointments, useAssistRespond } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';

const STATUS = { requested: 'Ждёт клинику', confirmed: 'Подтверждена', declined: 'Отклонена', completed: 'Состоялась', cancelled: 'Отменена' } as const;

export default function AppointmentsPage() {
  useDocumentTitle('Записи');
  useTopbar([{ label: 'Записи' }]);
  const [view, setView] = useState<'requests' | 'all'>('requests');
  const q = useAssistAppointments(view);
  const respond = useAssistRespond();
  const [declining, setDeclining] = useState<AssistAppointment | null>(null);
  const [reason, setReason] = useState('');

  const confirm = async (a: AssistAppointment) => {
    try {
      await respond.mutateAsync({ id: a.id, kind: 'confirm' });
      toast.success('Запись подтверждена вместо клиники');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: Column<AssistAppointment>[] = [
    { key: 'when', header: 'Время приёма', cell: (a) => <span className="num whitespace-nowrap">{formatDateTime(a.startsAt)}</span> },
    { key: 'who', header: 'Застрахованный', cell: (a) => a.insuredName },
    { key: 'spec', header: 'Врач', cell: (a) => SPECIALTY_LABEL[a.specialty] },
    { key: 'clinic', header: 'Клиника', cell: (a) => a.clinicName },
    { key: 'created', header: 'Заявка', cell: (a) => <span className="num whitespace-nowrap">{formatDateTime(a.createdAt)}</span> },
    {
      key: 'status',
      header: 'Статус',
      cell: (a) => (a.overdue ? <Chip kind="danger">Клиника не ответила в срок</Chip> : <Chip kind={a.status === 'confirmed' ? 'success' : a.status === 'requested' ? 'sky' : 'neutral'}>{STATUS[a.status]}</Chip>),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) =>
        a.overdue ? (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={() => void confirm(a)} aria-label={`Подтвердить запись ${a.insuredName}`}>
              Подтвердить
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(a)}>
              Отклонить
            </Button>
          </span>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader title="Записи к врачу" subtitle="Клиника подтверждает сама. Если она не ответила в срок, заявка эскалируется ассистансу" />
      <Tabs value={view} onValueChange={(v) => setView(v as 'requests' | 'all')}>
        <TabsList>
          <TabsTrigger value="requests">Заявки</TabsTrigger>
          <TabsTrigger value="all">Все за 30 дней</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable caption="Записи застрахованных" columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(a) => a.id} empty="Заявок нет" />
      </div>
      {declining && (
        <Modal
          open
          onOpenChange={(o) => !o && setDeclining(null)}
          title="Отклонить запись"
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                Отмена
              </Button>
              <Button
                variant="danger"
                loading={respond.isPending}
                onClick={async () => {
                  try {
                    await respond.mutateAsync({ id: declining.id, kind: 'decline', reason: reason.trim() });
                    toast.success('Запись отклонена');
                    setDeclining(null);
                    setReason('');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Отклонить
              </Button>
            </>
          }
        >
          <Field label="Причина">{(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </Modal>
      )}
    </>
  );
}
