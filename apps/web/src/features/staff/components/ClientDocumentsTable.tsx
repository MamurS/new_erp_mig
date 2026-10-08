/* «Документы» tab of the client card: commercial offers and other documents in one list. */
import { t } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { FileText, Send, Undo2 } from 'lucide-react';
import type { ClientDocument, KpDocument } from '@mig/contracts';
import { useClientDocuments } from '@/shared/api/queries/staff';
import { useClientKp, useKpAction } from '@/shared/api/queries/kp';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { KP_STATUS_CHIP, KP_STATUS_LABEL, KP_TEMPLATE_NAME } from '@mig/domain/kp';
import { formatDate, formatMoney } from '@mig/domain/lib/format';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Card } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { KpDownloadButton } from '@/features/kp/KpDownloadButton';
import { kpPath } from '@/features/kp/paths';
import { AskButton, HelpMore, roleName } from '@/features/next/NextActions';

type Row = { type: 'kp'; id: string; date: string; kp: KpDocument } | { type: 'doc'; id: string; date: string; doc: ClientDocument };

export function ClientDocumentsTable({ clientId, highlightId }: { clientId: string; highlightId?: string }) {
  const docs = useClientDocuments(clientId);
  const offers = useClientKp(clientId);
  const navigate = useNavigate();
  const canSend = useCan('kp.send');
  const canDeals = useCan('deals.manage');
  const action = useKpAction();
  const [revokeFor, setRevokeFor] = useState<KpDocument | null>(null);

  const run = async (kp: KpDocument, verb: 'send' | 'revoke') => {
    try {
      const saved = await action.mutateAsync({ id: kp.id, action: verb });
      toast.success(verb === 'send' ? t('staff.docs.sent', { number: saved.number }) : t('staff.docs.revoked', { number: saved.number }));
      setRevokeFor(null);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const rows: Row[] | undefined =
    docs.data && offers.data
      ? [
          ...offers.data.map((kp): Row => ({ type: 'kp', id: kp.id, date: kp.createdAt, kp })),
          ...docs.data.filter((d) => d.kind !== 'kp').map((doc): Row => ({ type: 'doc', id: doc.id, date: doc.createdAt, doc })),
        ].sort((a, b) => (a.date < b.date ? 1 : -1))
      : undefined;

  const columns: Column<Row>[] = [
    {
      key: 'title',
      header: t('staff.docs.colDocument'),
      cell: (r) =>
        r.type === 'kp' ? (
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-accent" aria-hidden />
            <span>
              <span className="font-medium">{t('staff.docs.kp')}</span> <span className="num">{r.kp.number}</span>
            </span>
          </span>
        ) : (
          <span className="flex items-center gap-2">
            <FileText className="h-4 w-4 text-muted" aria-hidden />
            {r.doc.title}
          </span>
        ),
    },
    { key: 'date', header: t('common.date'), cell: (r) => <span className="num whitespace-nowrap">{formatDate(r.date)}</span> },
    { key: 'program', header: t('common.program'), cell: (r) => (r.type === 'kp' ? KP_TEMPLATE_NAME[r.kp.params.templateId] : '—') },
    { key: 'total', header: t('staff.docs.colTotalPremium'), align: 'right', cell: (r) => (r.type === 'kp' ? <span className="num whitespace-nowrap">{formatMoney(r.kp.totalPremium)}</span> : '—') },
    { key: 'status', header: t('common.status'), cell: (r) => (r.type === 'kp' ? <Chip kind={KP_STATUS_CHIP[r.kp.status]}>{KP_STATUS_LABEL[r.kp.status]}</Chip> : null) },
    { key: 'author', header: t('staff.docs.colAuthor'), cell: (r) => (r.type === 'kp' ? r.kp.createdByName : '—') },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (r) =>
        r.type === 'kp' ? (
          <span className="inline-flex flex-wrap justify-end gap-1.5" onClick={(e) => e.stopPropagation()}>
            <Button size="sm" variant="secondary" onClick={() => navigate(kpPath(r.kp.id))} aria-label={t('staff.docs.openAria', { number: r.kp.number })}>
              {t('common.open')}
            </Button>
            <KpDownloadButton kpId={r.kp.id} number={r.kp.number} />
            {canSend && r.kp.status === 'draft' && (
              <Button size="sm" loading={action.isPending && action.variables?.id === r.kp.id} onClick={() => void run(r.kp, 'send')} aria-label={t('staff.docs.sendAria', { number: r.kp.number })}>
                <Send className="h-3.5 w-3.5" aria-hidden /> {t('common.send')}
              </Button>
            )}
            {canSend && r.kp.status === 'sent' && (
              <Button size="sm" variant="secondary" onClick={() => setRevokeFor(r.kp)} aria-label={t('staff.docs.revokeAria', { number: r.kp.number })}>
                <Undo2 className="h-3.5 w-3.5" aria-hidden /> {t('common.revoke')}
              </Button>
            )}
          </span>
        ) : null,
    },
  ];

  return (
    <Card bodyClassName="p-0">
      <DataTable
        caption={t('staff.docs.caption')}
        columns={columns}
        rows={rows}
        rowKey={(r) => r.id}
        activeKey={highlightId}
        loading={docs.isLoading || offers.isLoading}
        error={docs.error ?? offers.error}
        onRetry={() => {
          void docs.refetch();
          void offers.refetch();
        }}
        empty={
          <EmptyState
            testId="client-docs-next"
            title={t('emptyStaff.docs.title')}
            why={t('emptyStaff.docs.why')}
            next={t('emptyStaff.docs.next', { role: roleName('sales_manager') })}
            actions={
              canDeals ? (
                <Button variant="secondary" asChild>
                  <Link to="/staff/deals">{t('emptyStaff.openDeals')}</Link>
                </Button>
              ) : (
                <AskButton role="sales_manager" action="kp_send" subjectType="client" subjectId={clientId} />
              )
            }
            help={<HelpMore article="new-client" section="kp" />}
          />
        }
      />
      <ConfirmDialog
        open={!!revokeFor}
        onOpenChange={(o) => !o && setRevokeFor(null)}
        title={t('staff.docs.revokeTitle')}
        description={t('staff.docs.revokeText')}
        confirmLabel={t('common.revoke')}
        danger
        loading={action.isPending}
        onConfirm={() => revokeFor && void run(revokeFor, 'revoke')}
      />
    </Card>
  );
}
