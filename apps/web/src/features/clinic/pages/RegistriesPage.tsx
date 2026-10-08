/* Clinic registries (CLINIC_SPEC §4.5, clinic_admin): list by month, build from visits or import CSV. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { FileUp, Hammer } from 'lucide-react';
import type { RegistrySummary } from '@mig/contracts/dto';
import { useBuildRegistry, useClinicRegistries, useClinicVisits, useImportRegistry } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@mig/domain/clinics';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { formatDate, formatMoney, todayISO } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Select } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { roleName } from '@/features/next/NextActions';
import { PageTitle, Panel } from '../components';
import { EmptyHelp } from '../emptyNext';
import { t, tm, defineLabels } from '@/i18n';

const SOURCE_LABEL = defineLabels('clinic.registries.source', ['portal', 'csv', 'api'] as const);
export const REGISTRY_CSV_HEADER = ['visit_id', 'service_date', 'service_code', 'icd10', 'quantity', 'price', 'guarantee_number'] as const;

function periods(): string[] {
  const out: string[] = [];
  const d = new Date();
  for (let k = 0; k < 4; k++) {
    const x = new Date(d.getFullYear(), d.getMonth() - k, 1);
    out.push(`${x.getFullYear()}-${String(x.getMonth() + 1).padStart(2, '0')}`);
  }
  return out;
}

function ImportDialog({ period, onClose }: { period: string; onClose: () => void }) {
  const navigate = useNavigate();
  const visits = useClinicVisits(period);
  const imp = useImportRegistry();
  const [file, setFile] = useState<File | null>(null);
  const preview = imp.data && !imp.data.registryId ? imp.data : null;

  const template = () => {
    // Pre-filled with this month's visits: the clinic only fills in services, prices and codes.
    const rows = (visits.data ?? []).map((v) => [v.id, v.openedAt.slice(0, 10), '', '', 1, '', '']);
    downloadText(toCsv(REGISTRY_CSV_HEADER, rows), `registry-template-${period}.csv`);
  };
  const check = async (f: File) => {
    setFile(f);
    try {
      await imp.mutateAsync({ file: f, period, commit: false });
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const commit = async () => {
    if (!file) return;
    try {
      const r = await imp.mutateAsync({ file, period, commit: true });
      toast.success(t('clinic.registries.created', { n: r.valid }));
      onClose();
      if (r.registryId) navigate(`/clinic/registries/${r.registryId}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title={t('clinic.registries.importTitle', { period })}
      description={t('clinic.registries.importDescription')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button disabled={!preview || preview.valid === 0} loading={imp.isPending} onClick={() => void commit()}>
            {preview ? t('clinic.registries.createN', { n: preview.valid }) : t('clinic.registries.create')}
          </Button>
        </>
      }
    >
      <div className="flex flex-wrap items-center gap-2">
        <Button variant="secondary" onClick={template} disabled={visits.isLoading}>
          {t('clinic.registries.template')}
        </Button>
        <label className="inline-flex cursor-pointer items-center gap-2 rounded-btn border border-border px-3 py-2 hover:bg-rail">
          <FileUp className="h-4 w-4" aria-hidden /> {t('clinic.registries.pickFile')}
          <input
            type="file"
            accept=".csv,text/csv"
            className="sr-only"
            aria-label={t('clinic.registries.fileAria')}
            onChange={(e) => {
              const f = e.target.files?.[0];
              if (f) void check(f);
            }}
          />
        </label>
        {file && <span className="text-[12px] text-muted">{file.name.replace(/[^\w.-]/g, '_')}</span>}
      </div>
      {preview && (
        <div className="mt-4" data-testid="registry-import-preview">
          <p className="font-medium">
            {t('clinic.registries.previewSummary', { total: preview.total, valid: preview.valid, errors: preview.errors.length })}
          </p>
          {preview.errors.length > 0 && (
            <ul className="mt-2 max-h-56 overflow-auto rounded-btn bg-danger-soft p-2 text-[13px] text-danger-text">
              {preview.errors.slice(0, 100).map((e) => (
                <li key={e.row}>
                  {t('clinic.registries.rowError', { row: e.row, message: tm(e.message) })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Modal>
  );
}

export default function RegistriesPage() {
  useDocumentTitle(t('clinic.nav.registries'));
  const navigate = useNavigate();
  const q = useClinicRegistries();
  const build = useBuildRegistry();
  const [period, setPeriod] = useState(todayISO().slice(0, 7));
  const [importing, setImporting] = useState(false);

  const doBuild = async () => {
    try {
      const r = await build.mutateAsync(period);
      toast.success(t('clinic.registries.draftBuilt', { period, n: r.lines.length }));
      navigate(`/clinic/registries/${r.id}`);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const columns: Column<RegistrySummary>[] = [
    { key: 'period', header: t('common.period'), cell: (r) => <span className="num font-semibold">{r.period}</span> },
    { key: 'source', header: t('common.source'), cell: (r) => SOURCE_LABEL[r.source] },
    { key: 'status', header: t('common.status'), cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
    { key: 'lines', header: t('clinic.registries.lines'), align: 'right', cell: (r) => <span className="num">{r.lineCount}</span> },
    { key: 'claimed', header: t('clinic.docsPage.csvClaimed'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.claimed)}</span> },
    { key: 'accepted', header: t('clinic.docsPage.csvAccepted'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{r.status === 'draft' || r.status === 'submitted' ? '—' : formatMoney(r.totals.accepted)}</span> },
    { key: 'paid', header: t('clinic.docsPage.csvPaid'), align: 'right', cell: (r) => <span className="num whitespace-nowrap">{r.paidAt ? `${formatMoney(r.totals.paid)} · ${formatDate(r.paidAt)}` : '—'}</span> },
  ];

  return (
    <>
      <PageTitle title={t('clinic.nav.registries')} subtitle={t('clinic.registries.subtitle')} />
      <Panel className="mb-4">
        <div className="flex flex-wrap items-end gap-3 p-4">
          <Field label={t('common.period')}>
            {(a) => (
              <Select {...a} value={period} onChange={(e) => setPeriod(e.target.value)} className="w-40">
                {periods().map((p) => (
                  <option key={p} value={p}>
                    {p}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Button loading={build.isPending} onClick={() => void doBuild()}>
            <Hammer className="h-4 w-4" aria-hidden /> {t('clinic.registries.build')}
          </Button>
          <Button variant="secondary" onClick={() => setImporting(true)}>
            <FileUp className="h-4 w-4" aria-hidden /> {t('clinic.registries.importCsv')}
          </Button>
        </div>
      </Panel>
      <Panel>
        <DataTable
          caption={t('clinic.registries.caption')}
          columns={columns}
          rows={q.data}
          rowKey={(r) => r.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={(r) => navigate(`/clinic/registries/${r.id}`)}
          empty={
            <EmptyState
              testId="clinic-registries-empty"
              title={t('clinic.registries.empty')}
              why={t('emptyPartner.clinic.registries.why')}
              next={t('emptyPartner.clinic.registries.next', { role: roleName('clinic_admin') })}
              actions={
                <Button loading={build.isPending} onClick={() => void doBuild()}>
                  <Hammer className="h-4 w-4" aria-hidden /> {t('emptyPartner.clinic.registries.build')}
                </Button>
              }
              template={{ onDownload: () => downloadText(toCsv(REGISTRY_CSV_HEADER, []), `registry-template-${period}.csv`), label: t('emptyPartner.clinic.registries.template') }}
              help={<EmptyHelp article="clinics" section="monthly-registry" />}
            />
          }
        />
      </Panel>
      {importing && <ImportDialog period={period} onClose={() => setImporting(false)} />}
    </>
  );
}
