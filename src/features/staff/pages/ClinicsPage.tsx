import { t, tm, tp } from '@/i18n';
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
  online: { tone: 'success', label: 'staff.clinics.api.online' },
  offline: { tone: 'danger', label: 'staff.clinics.api.offline' },
  manual: { tone: 'default', label: 'staff.clinics.api.manual' },
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
      toast.success(t('staff.clinics.added'));
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
      title={t('staff.clinics.newClinic')}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            {t('common.cancel')}
          </Button>
          <Button loading={create.isPending} onClick={() => void submit()}>
            {t('common.add')}
          </Button>
        </>
      }
    >
      <form className="grid gap-3 sm:grid-cols-2" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('common.name')} error={tm(e.name?.message)} className="sm:col-span-2">
          {(a) => <Input {...a} maxLength={120} {...form.register('name')} />}
        </Field>
        <Field label={t('staff.clinics.address')} error={tm(e.address?.message)}>
          {(a) => <Input {...a} maxLength={200} {...form.register('address')} />}
        </Field>
        <Field label={t('staff.clinics.district')} error={tm(e.district?.message)}>
          {(a) => <Input {...a} maxLength={60} {...form.register('district')} />}
        </Field>
        <Field label={t('staff.clinics.integrationMode')} error={tm(e.integrationMode?.message)}>
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
          <legend className="mb-1 text-[12px] font-medium text-muted">{t('staff.clinics.specialties')}</legend>
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
              {tm(e.specialties.message)}
            </p>
          )}
        </fieldset>
      </form>
    </Modal>
  );
}

export default function ClinicsPage() {
  useDocumentTitle(t('staff.clinics.title'));
  useTopbar([{ label: t('staff.clinics.title') }]);
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
      header: t('common.name'),
      cell: (c) => (
        <span>
          <span className="block font-medium">{c.name}</span>
          <span className="block text-[12px] text-muted">{c.address}</span>
        </span>
      ),
    },
    { key: 'district', header: t('staff.clinics.district'), cell: (c) => c.district },
    {
      key: 'spec',
      header: t('staff.clinics.specialties'),
      cell: (c) => (
        <span className="flex flex-wrap gap-1 py-1">
          {c.specialties.map((s) => (
            <Chip key={s}>{SPECIALTY_LABEL[s]}</Chip>
          ))}
        </span>
      ),
    },
    { key: 'online', header: t('staff.clinics.colOnline'), cell: (c) => (c.onlineBooking ? <StatusDot tone="success">{t('common.yes')}</StatusDot> : <StatusDot tone="muted">{t('common.no')}</StatusDot>) },
    { key: 'mode', header: t('staff.clinics.colIntegration'), cell: (c) => INTEGRATION_MODE_LABEL[c.integrationMode] },
    { key: 'api', header: t('staff.clinics.colApi'), cell: (c) => <StatusDot tone={API_STATUS[c.apiStatus].tone}>{t(API_STATUS[c.apiStatus].label)}</StatusDot> },
    {
      key: 'contract',
      header: t('staff.clinics.colContract'),
      cell: (c) => <span className={daysUntil(c.contractUntil) <= 60 ? 'font-medium text-warning-text' : undefined}>{formatDate(c.contractUntil)}</span>,
    },
  ];
  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">{t('staff.clinics.title')}</h1>
        <div className="flex items-center gap-2">
          <Select aria-label={t('staff.clinics.specialty')} className="w-48" value={f.specialty} onChange={(e) => setF({ specialty: e.target.value })}>
            <option value="">{t('staff.clinics.allSpecialties')}</option>
            {(Object.keys(SPECIALTY_LABEL) as Specialty[]).map((s) => (
              <option key={s} value={s}>
                {SPECIALTY_LABEL[s]}
              </option>
            ))}
          </Select>
          <SearchInput value={search} onChange={setSearch} placeholder={t('staff.clinics.searchPlaceholder')} slashFocus className="w-64" />
          {canCreate && <Button onClick={() => setCreating(true)}>{t('staff.clinics.addClinic')}</Button>}
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staff.clinics.title')}
          columns={cols}
          rows={list.data}
          rowKey={(c) => c.id}
          onRowClick={(c) => navigate(`/staff/clinics/${c.id}`)}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          footer={list.data && <span>{tp('staff.clinics.footer', list.data.length)}</span>}
          empty={<EmptyState title={t('staff.clinics.notFound')} action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ specialty: '' }); }}>{t('staff.clients.resetFilters')}</Button>} />}
        />
      </div>
      {creating && <CreateClinicDialog onClose={() => setCreating(false)} />}
    </div>
  );
}
