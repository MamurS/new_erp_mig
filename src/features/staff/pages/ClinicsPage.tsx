import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import type { Clinic, IntegrationMode, Specialty } from '@/shared/types';
import { useClinics } from '@/shared/api/queries/staff';
import { useCreateClinic } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { INTEGRATION_MODE_LABEL } from '@/shared/domain/clinics';
import { clinicCreateSchema } from '@/shared/schemas/forms';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
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

type ClinicForm = z.input<typeof clinicCreateSchema>;

function CreateClinicDialog({ onClose }: { onClose: () => void }) {
  const navigate = useNavigate();
  const create = useCreateClinic();
  const form = useForm<ClinicForm, unknown, z.output<typeof clinicCreateSchema>>({
    resolver: zodResolver(clinicCreateSchema),
    defaultValues: { name: '', address: '', district: '', specialties: [], integrationMode: 'portal' },
  });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      const c = await create.mutateAsync(v);
      toast.success('Клиника добавлена — пригласите её администратора');
      navigate(`/staff/clinics/${c.id}?tab=users`);
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <Modal
      open
      wide
      onOpenChange={(o) => !o && onClose()}
      title="Новая клиника"
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            Добавить
          </Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label="Название" error={e.name?.message} className="sm:col-span-2">
          {(a) => <Input {...a} maxLength={120} {...form.register('name')} />}
        </Field>
        <Field label="Адрес" error={e.address?.message}>
          {(a) => <Input {...a} maxLength={200} {...form.register('address')} />}
        </Field>
        <Field label="Район" error={e.district?.message}>
          {(a) => <Input {...a} maxLength={60} {...form.register('district')} />}
        </Field>
        <Field label="Режим интеграции" error={e.integrationMode?.message}>
          {(a) => (
            <Select {...a} {...form.register('integrationMode')}>
              {(Object.keys(INTEGRATION_MODE_LABEL) as IntegrationMode[]).map((m) => (
                <option key={m} value={m}>
                  {INTEGRATION_MODE_LABEL[m]}
                </option>
              ))}
            </Select>
          )}
        </Field>
        <fieldset className="sm:col-span-2">
          <legend className="mb-1 text-[12px] font-medium text-muted">Специальности</legend>
          <div className="grid gap-1 sm:grid-cols-3">
            {(Object.keys(SPECIALTY_LABEL) as Specialty[]).map((sp) => (
              <label key={sp} className="flex items-center gap-2">
                <input type="checkbox" value={sp} {...form.register('specialties')} />
                {SPECIALTY_LABEL[sp]}
              </label>
            ))}
          </div>
          {e.specialties?.message && (
            <p role="alert" className="mt-1 text-[12px] text-danger-text">
              {e.specialties.message}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export default function ClinicsPage() {
  useDocumentTitle('Клиники');
  useTopbar([{ label: 'Клиники' }]);
  const [f, setF] = useUrlFilters(['specialty'] as const);
  const [search, setSearch] = useState('');
  const q = useDebounced(search.trim());
  const list = useClinics({ q, specialty: f.specialty });
  const navigate = useNavigate();
  const canCreate = useCan('clinics.manage');
  const [creating, setCreating] = useState(false);
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
    { key: 'mode', header: 'Интеграция', cell: (c) => INTEGRATION_MODE_LABEL[c.integrationMode] },
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
          {canCreate && <Button onClick={() => setCreating(true)}>Добавить клинику</Button>}
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Клиники"
          columns={cols}
          rows={list.data}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/staff/clinics/${c.id}`)}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          footer={list.data && <span>{list.data.length} клиник в сети</span>}
          empty={<EmptyState title="Клиники не найдены" action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ specialty: '' }); }}>Сбросить фильтры</Button>} />}
        />
      </div>
      {creating && <CreateClinicDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
