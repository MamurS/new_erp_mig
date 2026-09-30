/* Clinic registries for MIG (CLINIC_SPEC §5): operator reviews, accountant pays. */
import { useNavigate } from 'react-router-dom';
import type { RegistrySummary } from '@/shared/types/dto';
import { useStaffRegistries } from '@/shared/api/queries/clinic';
import { REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState } from '@/shared/ui/states';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { useTopbar } from '../topbar';

const TABS: [string, string][] = [
  ['submitted,in_review', 'На проверке'],
  ['accepted,partially_accepted', 'К оплате'],
  ['paid', 'Оплачены'],
  ['all', 'Все'],
];
const SOURCE_LABEL = { portal: 'Кабинет', csv: 'CSV', api: 'API' } as const;

export default function RegistriesPage() {
  useDocumentTitle('Реестры клиник');
  useTopbar([{ label: 'Реестры клиник' }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status', 'clinicId'] as const);
  const status = TABS.some(([k]) => k === f.status) ? f.status : 'submitted,in_review';
  const list = useStaffRegistries({ ...(status === 'all' ? {} : { status }), ...(f.clinicId ? { clinicId: f.clinicId } : {}) });
  const cols: Column<RegistrySummary>[] = [
    { key: 'clinic', header: 'Клиника', cell: (r) => <span className="font-medium">{r.clinicName}</span> },
    { key: 'period', header: 'Период', cell: (r) => <span className="num">{r.period}</span> },
    { key: 'source', header: 'Источник', cell: (r) => <Chip kind={r.source === 'api' ? 'sky' : 'neutral'}>{SOURCE_LABEL[r.source]}</Chip> },
    { key: 'sent', header: 'Отправлен', cell: (r) => <span className="num text-muted">{r.submittedAt ? formatDateTime(r.submittedAt) : '—'}</span> },
    {
      key: 'lines',
      header: 'Строки',
      align: 'right',
      cell: (r) => (
        <span className="num">
          {r.lineCount}
          {r.pendingCount > 0 && <span className="text-muted"> · ждут {r.pendingCount}</span>}
          {r.disputedCount > 0 && <span className="text-warning-text"> · оспорено {r.disputedCount}</span>}
        </span>
      ),
    },
    { key: 'claimed', header: 'Заявлено', align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.claimed)}</span> },
    { key: 'accepted', header: 'Принято', align: 'right', cell: (r) => <span className="num whitespace-nowrap">{formatMoney(r.totals.accepted)}</span> },
    { key: 'status', header: 'Статус', cell: (r) => <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip> },
  ];
  return (
    <div>
      <h1 className="mb-3 text-[22px] font-bold">Реестры клиник</h1>
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'submitted,in_review' ? null : v })}>
        <TabsList>
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
            </TabsTrigger>
          ))}
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable
          caption="Реестры клиник"
          columns={cols}
          rows={list.data}
          rowKey={(r) => r.id}
          onRowClick={(r) => navigate(`/staff/registries/${r.id}`)}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          empty={<EmptyState title="Реестров нет" />}
        />
      </div>
    </div>
  );
}
