/* Rebills of the assistance to MIG (§5.5): the monthly bill of clinic payments plus the fee. */
import { useNavigate } from 'react-router-dom';
import type { RebillSummary } from '@mig/contracts/dto';
import { useAssistRebills, useBuildRebill } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { formatDate, formatMoney, todayISO } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { useCan } from '@/shared/auth/guards';
import { roleName } from '@/features/next/NextActions';
import { EmptyHelp } from '@/features/clinic/emptyNext';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { RebillStatus } from '../components';
import { t } from '@/i18n';

export default function RebillsPage() {
  useDocumentTitle(t('assist.nav.rebills'));
  useTopbar([{ label: t('assist.nav.rebills') }]);
  const navigate = useNavigate();
  const q = useAssistRebills();
  const build = useBuildRebill();
  const period = todayISO().slice(0, 7);
  const current = q.data?.find((b) => b.period === period);
  const canBuild = useCan('assist.rebills.submit');
  const doBuild = async () => {
    try {
      const b = await build.mutateAsync(period);
      navigate(`/assist/rebills/${b.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const columns: Column<RebillSummary>[] = [
    { key: 'num', header: t('common.number'), cell: (b) => <span className="num font-medium">{b.number}</span> },
    { key: 'period', header: t('common.period'), cell: (b) => <span className="num">{b.period}</span> },
    { key: 'lines', header: t('assist.registries.lines'), align: 'right', cell: (b) => <span className="num">{b.lineCount}</span> },
    { key: 'flags', header: t('assist.rebills.flagged'), align: 'right', cell: (b) => <span className={b.flaggedCount ? 'num font-semibold text-danger-text' : 'num text-muted'}>{b.flaggedCount}</span> },
    { key: 'total', header: t('common.total'), align: 'right', cell: (b) => <span className="num whitespace-nowrap">{formatMoney(b.totals.total)}</span> },
    { key: 'sent', header: t('assist.rebills.sentCol'), cell: (b) => (b.submittedAt ? <span className="num">{formatDate(b.submittedAt)}</span> : '—') },
    { key: 'status', header: t('common.status'), cell: (b) => <RebillStatus status={b.status} /> },
  ];
  return (
    <>
      <PageHeader
        title={t('assist.rebills.title')}
        subtitle={t('assist.rebills.subtitle')}
        actions={
          (!current || current.status === 'draft') && (
            <Button
              loading={build.isPending}
              onClick={() => void doBuild()}
            >
              {current ? t('assist.rebills.updateDraft', { period }) : t('assist.rebills.build', { period })}
            </Button>
          )
        }
      />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('assist.nav.rebills')}
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/assist/rebills/${b.id}`)}
          onRowOpen={(b) => navigate(`/assist/rebills/${b.id}`)}
          empty={
            <EmptyState
              testId="assist-rebills-empty"
              title={t('assist.rebills.empty')}
              why={t('emptyPartner.assist.rebills.why')}
              next={t('emptyPartner.assist.rebills.next', { role: roleName('asst_billing') })}
              actions={
                canBuild ? (
                  <Button variant="secondary" loading={build.isPending} onClick={() => void doBuild()}>
                    {t('emptyPartner.assist.rebills.build')}
                  </Button>
                ) : undefined
              }
              help={<EmptyHelp article="assistance" section="assistance-rebill" contact={!canBuild} />}
            />
          }
        />
      </div>
    </>
  );
}
