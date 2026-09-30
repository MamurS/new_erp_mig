import type { AuditAction, AuditEntry } from '@/shared/types';
import { useAdminUsers, useAudit } from '@/shared/api/queries/staff';
import { useAssistances } from '@/shared/api/queries/assist';
import { AUDIT_ACTION_LABEL, ROLE_LABEL } from '@/shared/domain/labels';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { FilterChip } from '@/shared/ui/filter-chip';
import { Input, Select } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { useTopbar } from '../topbar';

const SENSITIVE: AuditAction[] = ['reveal_pii', 'open_medical', 'export', 'role_change', 'user_deactivate', 'login_failed'];

export default function AuditPage() {
  useDocumentTitle('Журнал аудита');
  useTopbar([{ label: 'Журнал аудита' }]);
  const [f, setF] = useUrlFilters(['action', 'actorId', 'assistanceId', 'from', 'to', 'page'] as const);
  const page = Number(f.page) || 1;
  const list = useAudit({ action: f.action, actorId: f.actorId, assistanceId: f.assistanceId, from: f.from, to: f.to, page, pageSize: 25 });
  const users = useAdminUsers();
  const assistances = useAssistances();
  const cols: Column<AuditEntry>[] = [
    { key: 'at', header: 'Время', cell: (e) => <span className="whitespace-nowrap">{formatDateTime(e.at)}</span> },
    { key: 'actor', header: 'Сотрудник', cell: (e) => e.actorName },
    { key: 'role', header: 'Роль', cell: (e) => <span className="text-muted">{ROLE_LABEL[e.actorRole]}</span> },
    { key: 'action', header: 'Действие', cell: (e) => <Chip kind={SENSITIVE.includes(e.action) ? 'warning' : 'neutral'}>{AUDIT_ACTION_LABEL[e.action]}</Chip> },
    { key: 'target', header: 'Объект', cell: (e) => <span className="num text-[12px]">{e.targetLabel ?? '—'}</span> },
    { key: 'reason', header: 'Причина', cell: (e) => <span className="text-muted">{e.reason ?? ''}</span> },
  ];
  const hasFilters = f.action || f.actorId || f.assistanceId || f.from || f.to;
  return (
    <div>
      <div className="mb-3">
        <h1 className="text-[22px] font-bold">Журнал аудита</h1>
        <p className="text-muted">Все входы, просмотры персональных и медицинских данных, выгрузки и изменения прав. Объекты указаны без ПДн.</p>
      </div>
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label="Действие"
          options={(Object.keys(AUDIT_ACTION_LABEL) as AuditAction[]).map((a) => ({ value: a, label: AUDIT_ACTION_LABEL[a] }))}
          selected={f.action ? f.action.split(',') : []}
          onChange={(v) => setF({ action: v.join(',') })}
        />
        <Select aria-label="Сотрудник" className="h-7 w-56" value={f.actorId} onChange={(e) => setF({ actorId: e.target.value })}>
          <option value="">Все сотрудники</option>
          {(users.data ?? []).map((u) => (
            <option key={u.id} value={u.id}>
              {u.fullName}
            </option>
          ))}
        </Select>
        <Select aria-label="Ассистанс" className="h-7 w-56" value={f.assistanceId} onChange={(e) => setF({ assistanceId: e.target.value })}>
          <option value="">Все, включая МИГ</option>
          {(assistances.data ?? []).map((a) => (
            <option key={a.id} value={a.id}>
              {a.name}
            </option>
          ))}
        </Select>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          с <Input type="date" className="h-7 w-auto" value={f.from} max={f.to || undefined} onChange={(e) => setF({ from: e.target.value })} aria-label="С даты" />
        </label>
        <label className="flex items-center gap-1 text-[12px] text-muted">
          по <Input type="date" className="h-7 w-auto" value={f.to} min={f.from || undefined} onChange={(e) => setF({ to: e.target.value })} aria-label="По дату" />
        </label>
        {hasFilters && (
          <Button size="sm" variant="ghost" onClick={() => setF({ action: '', actorId: '', assistanceId: '', from: '', to: '' })}>
            Сбросить
          </Button>
        )}
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Журнал аудита"
          columns={cols}
          rows={list.data?.items}
          rowKey={(e) => e.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          page={page}
          pageSize={25}
          total={list.data?.total}
          onPageChange={(p) => setF({ page: p }, false)}
          empty={<EmptyState title="Записей не найдено" description="Измените фильтры" />}
        />
      </div>
    </div>
  );
}
