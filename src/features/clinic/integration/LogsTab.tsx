import type { ApiCallLog } from '@/shared/types';
import { useApiLogs } from '@/shared/api/queries/clinic';
import { formatDateTime } from '@/shared/lib/format';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { EmptyState } from '@/shared/ui/states';
import { Panel } from '../components';
import { usePartner } from './partner';

/** Path templates only: no parameters, bodies or personal data (CLINIC_SPEC §9.8). */
export function LogsTab() {
  const q = useApiLogs(usePartner().base);
  const columns: Column<ApiCallLog>[] = [
    { key: 'at', header: 'Время', cell: (l) => <span className="num whitespace-nowrap text-muted">{formatDateTime(l.at)}</span> },
    { key: 'key', header: 'Ключ', cell: (l) => <code className="text-[12px]">{l.clientId}</code> },
    { key: 'method', header: 'Метод', cell: (l) => <code className="text-[12px] font-semibold">{l.method}</code> },
    { key: 'path', header: 'Путь', cell: (l) => <code className="text-[12px]">{l.pathTemplate}</code> },
    { key: 'status', header: 'Ответ', cell: (l) => <Chip kind={l.status < 300 ? 'success' : l.status < 500 ? 'warning' : 'danger'}>{l.status}</Chip> },
    { key: 'latency', header: 'Задержка', align: 'right', cell: (l) => <span className="num">{l.latencyMs} мс</span> },
  ];
  return (
    <Panel title="Журнал запросов">
      <DataTable
        caption="Журнал запросов API"
        columns={columns}
        rows={q.data}
        rowKey={(l) => l.id}
        loading={q.isLoading}
        error={q.error}
        onRetry={() => void q.refetch()}
        empty={<EmptyState title="Запросов пока не было" />}
      />
    </Panel>
  );
}
