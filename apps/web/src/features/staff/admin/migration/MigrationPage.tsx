/*
 * «Перенос действующего портфеля»: templates of the six files, the demo files (demo build), the batches
 * and the manual entry of one contract. A batch is prepared by an administrator and applied by another.
 */
import { t } from '@/i18n';
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { Download, FilePlus2, PencilLine } from 'lucide-react';
import type { MigrationBatchSummary, MigrationStep } from '@mig/contracts/migration';
import { useMigrationBatches } from '@/shared/api/queries/migration';
import { MIGRATION_STEPS, migrationFileName, migrationTemplateCsv } from '@mig/domain/migration';
import { getDemo } from '@/shared/demo';
import { downloadText } from '@/shared/lib/csv';
import { formatDate, formatDateTime, formatNumber } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Card, PageHeader } from '@/shared/ui/page';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HelpMore } from '@/features/next/NextActions';
import { useTopbar } from '../../topbar';
import { ManualContractDialog, NewBatchDialog } from './dialogs';
import { BATCH_STATUS_CHIP, BATCH_STATUS_LABEL, KIND_LABEL, STEP_LABEL } from './labels';

export default function MigrationPage() {
  useDocumentTitle(t('migration.title'));
  useTopbar([{ label: t('staff.nav.migration') }]);
  const navigate = useNavigate();
  const q = useMigrationBatches();
  const [dialog, setDialog] = useState<'new' | 'manual' | null>(null);
  const Samples = getDemo()?.MigrationSamples;
  const firstStep = MIGRATION_STEPS[0];
  const downloadTemplate = (s: MigrationStep) => {
    downloadText(migrationTemplateCsv(s), migrationFileName(s));
    toast.success(t('migration.templateDownloaded'));
  };
  const columns: Column<MigrationBatchSummary>[] = [
    { key: 'seq', header: t('migration.col.seq'), cell: (b) => <span className="num font-medium">{b.seq}</span> },
    { key: 'date', header: t('migration.col.date'), cell: (b) => <span className="num">{formatDate(b.migrationDate)}</span> },
    { key: 'kind', header: t('migration.col.kind'), cell: (b) => KIND_LABEL[b.kind] },
    { key: 'status', header: t('common.status'), cell: (b) => <Chip kind={BATCH_STATUS_CHIP[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Chip> },
    { key: 'rows', header: t('migration.col.rows'), align: 'right', cell: (b) => <span className="num">{formatNumber(b.rows)}</span> },
    {
      key: 'author',
      header: t('migration.col.author'),
      cell: (b) => (
        <span>
          {b.createdByName} <span className="num text-muted">{formatDateTime(b.createdAt)}</span>
        </span>
      ),
    },
    { key: 'decided', header: t('migration.col.decided'), cell: (b) => b.decidedByName ?? '—' },
  ];
  return (
    <>
      <PageHeader
        title={t('migration.title')}
        subtitle={t('migration.subtitle')}
        actions={
          <>
            <Button variant="secondary" onClick={() => setDialog('manual')}>
              <PencilLine className="h-4 w-4" aria-hidden /> {t('migration.manual')}
            </Button>
            <Button onClick={() => setDialog('new')}>
              <FilePlus2 className="h-4 w-4" aria-hidden /> {t('migration.newBatch')}
            </Button>
          </>
        }
      />
      {Samples && <Samples stepLabel={(s) => STEP_LABEL[s]} />}
      <Card title={t('migration.templates')} className="mb-4">
        <p className="mb-3 text-[13px] text-muted">{t('migration.templatesHint')}</p>
        <div className="flex flex-wrap gap-2">
          {MIGRATION_STEPS.map((s) => (
            <Button
              key={s}
              variant="secondary"
              size="sm"
              onClick={() => downloadTemplate(s)}
            >
              <Download className="h-3.5 w-3.5" aria-hidden /> {t('migration.templateFor', { step: STEP_LABEL[s] })}
            </Button>
          ))}
        </div>
      </Card>
      <Card title={t('migration.batches')} bodyClassName="p-0">
        <DataTable
          caption={t('migration.batches')}
          columns={columns}
          rows={q.data?.items}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(b) => b.id}
          onRowClick={(b) => navigate(`/staff/admin/migration/${b.id}`)}
          empty={
            <EmptyState
              testId="migration-next"
              title={t('emptyStaff.migration.title')}
              why={t('emptyStaff.migration.why')}
              next={t('emptyStaff.migration.next')}
              actions={
                <Button variant="secondary" onClick={() => setDialog('new')}>
                  <FilePlus2 className="h-4 w-4" aria-hidden /> {t('emptyStaff.migration.create')}
                </Button>
              }
              template={{ onDownload: () => downloadTemplate(firstStep), label: t('emptyStaff.migration.template', { step: STEP_LABEL[firstStep] }) }}
              help={<HelpMore article="portfolio-migration" section="migration-prep" />}
            />
          }
        />
      </Card>
      {dialog === 'new' && <NewBatchDialog onClose={() => setDialog(null)} />}
      {dialog === 'manual' && <ManualContractDialog assistances={q.data?.assistances ?? []} onClose={() => setDialog(null)} />}
    </>
  );
}
