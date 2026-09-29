import { useState } from 'react';
import type { Clinic, Specialty } from '@/shared/types';
import { useClinics } from '@/shared/api/queries/staff';
import { SPECIALTY_LABEL } from '@/shared/domain/labels';
import { formatDate, daysUntil } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip, StatusDot } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Select } from '@/shared/ui/input';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState } from '@/shared/ui/states';
import { useTopbar } from '../topbar';

const API_STATUS = {
  online: { tone: 'success', label: 'Онлайн' },
  offline: { tone: 'danger', label: 'Нет связи' },
  manual: { tone: 'default', label: 'Вручную' },
} as const;

export default function ClinicsPage() {
  useDocumentTitle('Клиники');
  useTopbar([{ label: 'Клиники' }]);
  const [f, setF] = useUrlFilters(['specialty'] as const);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const list = useClinics({ q, specialty: f.specialty });
  const cols: Column<Clinic>[] = [
    {
      key: 'name',
      header: 'Название',
      cell: (c) => (
        <span>
          <span className="block font-medium">{c.name}</span>
          <span className="block text-[12px] text-muted">{c.address}</span>
        </span>
      ),
    },
    { key: 'district', header: 'Район', cell: (c) => c.district },
    {
      key: 'spec',
      header: 'Специальности',
      cell: (c) => (
        <span className="flex flex-wrap gap-1 py-1">
          {c.specialties.map((s) => (
            <Chip key={s}>{SPECIALTY_LABEL[s]}</Chip>
          ))}
        </span>
      ),
    },
    { key: 'online', header: 'Онлайн-запись', cell: (c) => (c.onlineBooking ? <StatusDot tone="success">Да</StatusDot> : <StatusDot tone="muted">Нет</StatusDot>) },
    { key: 'api', header: 'Статус API', cell: (c) => <StatusDot tone={API_STATUS[c.apiStatus].tone}>{API_STATUS[c.apiStatus].label}</StatusDot> },
    {
      key: 'contract',
      header: 'Договор до',
      cell: (c) => <span className={daysUntil(c.contractUntil) <= 60 ? 'font-medium text-warning-text' : undefined}>{formatDate(c.contractUntil)}</span>,
    },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">Клиники</h1>
        <div className="flex items-center gap-2">
          <Select aria-label="Специальность" className="w-48" value={f.specialty} onChange={(e) => setF({ specialty: e.target.value })}>
            <option value="">Все специальности</option>
            {(Object.keys(SPECIALTY_LABEL) as Specialty[]).map((s) => (
              <option key={s} value={s}>
                {SPECIALTY_LABEL[s]}
              </option>
            ))}
          </Select>
          <SearchInput value={search} onChange={setSearch} placeholder="Название или район" slashFocus className="w-64" />
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Клиники"
          columns={cols}
          rows={list.data}
          rowKey={(c) => c.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          footer={list.data && <span>{list.data.length} клиник в сети</span>}
          empty={<EmptyState title="Клиники не найдены" action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ specialty: '' }); }}>Сбросить фильтры</Button>} />}
        />
      </div>
    </div>
  );
}
