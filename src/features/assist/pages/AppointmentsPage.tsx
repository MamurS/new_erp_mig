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
import { SlaBadge } from '../components';
import { defineLabels, t } from '@/i18n';

const STATUS = defineLabels('assist.appt', ['requested', 'confirmed', 'declined', 'completed', 'cancelled'] as const);

export default function AppointmentsPage() {
  useDocumentTitle(t('assist.nav.appointments'));
  useTopbar([{ label: t('assist.nav.appointments') }]);
  const [view, setView] = useState<'requests' | 'all'>('requests');
  const q = useAssistAppointments(view);
  const respond = useAssistRespond();
  const [declining, setDeclining] = useState<AssistAppointment | null>(null);
  const [reason, setReason] = useState('');

  const confirm = async (a: AssistAppointment) => {
    try {
      await respond.mutateAsync({ id: a.id, kind: 'confirm' });
      toast.success(t('assist.appts.confirmedToast'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: Column<AssistAppointment>[] = [
    { key: 'when', header: t('assist.appts.when'), cell: (a) => <span className="num whitespace-nowrap">{formatDateTime(a.startsAt)}</span> },
    { key: 'who', header: t('common.insured'), cell: (a) => a.insuredName },
    { key: 'spec', header: t('assist.appts.doctor'), cell: (a) => SPECIALTY_LABEL[a.specialty] },
    { key: 'clinic', header: t('common.clinic'), cell: (a) => a.clinicName },
    { key: 'created', header: t('assist.appts.request'), cell: (a) => <span className="num whitespace-nowrap">{formatDateTime(a.createdAt)}</span> },
    {
      key: 'status',
      header: t('common.status'),
      cell: (a) => (a.overdue ? <Chip kind="danger">{t('assist.appts.overdue')}</Chip> : <Chip kind={a.status === 'confirmed' ? 'success' : a.status === 'requested' ? 'sky' : 'neutral'}>{STATUS[a.status]}</Chip>),
    },
    { key: 'sla', header: t('assist.appts.clinicAnswer'), cell: (a) => <SlaBadge dueAt={a.slaDueAt} done={a.status !== 'requested' || !!a.proposedStartsAt} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (a) =>
        a.overdue ? (
          <span className="flex justify-end gap-1">
            <Button size="sm" variant="secondary" onClick={() => void confirm(a)} aria-label={t('assist.appts.confirmAria', { name: a.insuredName })}>
              {t('common.confirm')}
            </Button>
            <Button size="sm" variant="ghost" onClick={() => setDeclining(a)}>
              {t('common.reject')}
            </Button>
          </span>
        ) : null,
    },
  ];
  return (
    <>
      <PageHeader title={t('assist.appts.title')} subtitle={t('assist.appts.subtitle')} />
      <Tabs value={view} onValueChange={(v) => setView(v as 'requests' | 'all')}>
        <TabsList>
          <TabsTrigger value="requests">{t('assist.appts.tabRequests')}</TabsTrigger>
          <TabsTrigger value="all">{t('assist.appts.tabAll')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable caption={t('assist.appts.caption')} columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(a) => a.id} empty={t('assist.appts.empty')} />
      </div>
      {declining && (
        <Modal
          open
          onOpenChange={(o) => !o && setDeclining(null)}
          title={t('assist.appts.declineTitle')}
          footer={
            <>
              <Button variant="secondary" onClick={() => setDeclining(null)}>
                {t('common.cancel')}
              </Button>
              <Button
                variant="danger"
                loading={respond.isPending}
                onClick={async () => {
                  try {
                    await respond.mutateAsync({ id: declining.id, kind: 'decline', reason: reason.trim() });
                    toast.success(t('assist.appts.declinedToast'));
                    setDeclining(null);
                    setReason('');
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                {t('common.reject')}
              </Button>
            </>
          }
        >
          <Field label={t('common.reason')}>{(a) => <Textarea {...a} rows={3} maxLength={300} value={reason} onChange={(e) => setReason(e.target.value)} />}</Field>
        </Modal>
      )}
    </>
  );
}
