import type { ApiCallLog } from '@/shared/types';
import { useApiLogs } from '@/shared/api/queries/clinic';
import { formatDateTime } from '@/shared/lib/format';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState } from '@/shared/ui/states';
import { Panel } from '../components';
import { usePartner } from './partner';
import { t } from '@/i18n';

/** Path templates only: no parameters, bodies or personal data (CLINIC_SPEC §9.8). */
export function LogsTab() {
  const q = useApiLogs(usePartner().base);
  const columns: Column<ApiCallLog>[] = [
    { key: 'at', header: t('common.time'), cell: (l) => <span className="num whitespace-nowrap text-muted">{formatDateTime(l.at)}</span> },
    { key: 'key', header: t('clinic.logs.key'), cell: (l) => <code className="text-[12px]">{l.clientId}</code> },
    { key: 'method', header: t('clinic.logs.method'), cell: (l) => <code className="text-[12px] font-semibold">{l.method}</code> },
    { key: 'path', header: t('clinic.logs.path'), cell: (l) => <code className="text-[12px]">{l.pathTemplate}</code> },
    { key: 'status', header: t('clinic.logs.response'), cell: (l) => <Chip kind={l.status < 300 ? 'success' : l.status < 500 ? 'warning' : 'danger'}>{l.status}</Chip> },
    { key: 'latency', header: t('clinic.logs.latency'), align: 'right', cell: (l) => <span className="num">{t('clinic.logs.ms', { n: l.latencyMs })}</span> },
  ];
  return (
    <Panel title={t('clinic.integration.tab.logs')}>
      <DataTable
        caption={t('clinic.logs.caption')}
        columns={columns}
        rows={q.data}
        rowKey={(l) => l.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title={t('clinic.logs.empty')} />}
      />
    </Panel>
  );
}
