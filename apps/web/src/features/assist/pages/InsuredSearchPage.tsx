/*
 * Search among the assistance's own insured persons (§3): name, policy number or phone. «Найти по последним 4 цифрам
 * телефона» — only with a part of the name or the birth date (stage 1.5); every such search is audited by the server.
 */
import { useState } from 'react';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import { useNavigate } from 'react-router-dom';
import type { z } from 'zod';
import type { AssistInsuredItem } from '@mig/contracts/dto';
import { assistPhoneTailSchema } from '@mig/contracts/forms';
import { errorMessage } from '@/shared/api/client';
import { useAssistInsured, usePhoneTailSearch } from '@/shared/api/queries/assist';
import { useDebounced, useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Field, Input } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { SearchInput } from '@/shared/ui/search-input';
import { StatusDot } from '@/shared/ui/chips';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';
import { t, tm } from '@/i18n';

type TailValues = z.input<typeof assistPhoneTailSchema>;

function TailSearch({ onFound }: { onFound: (rows: AssistInsuredItem[]) => void }) {
  const search = usePhoneTailSearch();
  const form = useForm<TailValues>({ resolver: zodResolver(assistPhoneTailSchema), defaultValues: { tail: '', name: '', birthDate: '' } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (v) => {
    try {
      onFound(await search.mutateAsync(v));
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <section className="mb-3 rounded-card border border-border bg-surface p-4" aria-labelledby="tail-title">
      <h2 id="tail-title" className="font-semibold">
        {t('assist.insured.tail.title')}
      </h2>
      <p className="mb-3 text-[13px] text-muted">{t('assist.insured.tail.hint')}</p>
      <form className="flex flex-wrap items-end gap-3" onSubmit={(ev) => void submit(ev)} noValidate>
        <Field label={t('assist.insured.tail.digits')} error={tm(e.tail?.message)} className="w-36">
          {(a) => <Input {...a} inputMode="numeric" autoComplete="off" maxLength={4} {...form.register('tail')} />}
        </Field>
        <Field label={t('assist.insured.tail.name')} error={tm(e.name?.message)} className="w-64">
          {(a) => <Input {...a} autoComplete="off" maxLength={100} {...form.register('name')} />}
        </Field>
        <Field label={t('assist.insured.tail.birthDate')} error={tm(e.birthDate?.message)} className="w-44">
          {(a) => <Input {...a} type="date" autoComplete="off" {...form.register('birthDate')} />}
        </Field>
        <Button type="submit" loading={search.isPending}>
          {t('assist.insured.tail.submit')}
        </Button>
      </form>
    </section>
  );
}

export default function InsuredSearchPage() {
  useDocumentTitle(t('assist.insured.title'));
  useTopbar([{ label: t('assist.insured.title') }]);
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const [tailMode, setTailMode] = useState(false);
  // The rows of the last tail search live in this page only (not in the query cache: they came with personal data).
  const [tailRows, setTailRows] = useState<AssistInsuredItem[] | null>(null);
  const q = useAssistInsured(useDebounced(term.trim(), 300));
  const columns: Column<AssistInsuredItem>[] = [
    { key: 'name', header: t('common.fullName'), cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: 'client', header: t('assist.insured.company'), cell: (i) => i.clientName },
    { key: 'policy', header: t('common.policy'), cell: (i) => <span className="num">{i.policyNumber}</span> },
    { key: 'program', header: t('common.program'), cell: (i) => i.programName },
    { key: 'phone', header: t('common.phone'), cell: (i) => <span className="num">{i.phoneMasked}</span> },
    { key: 'status', header: t('common.status'), cell: (i) => <StatusDot tone={i.status === 'active' ? 'success' : 'muted'}>{i.status === 'active' ? t('assist.insured.active') : t('assist.insured.excluded')}</StatusDot> },
  ];
  const tail = tailMode;
  return (
    <>
      <PageHeader title={t('assist.insured.title')} subtitle={t('assist.insured.subtitle')} />
      {tail ? (
        <TailSearch onFound={setTailRows} />
      ) : (
        <div className="mb-3 max-w-md">
          <SearchInput value={term} onChange={setTerm} placeholder={t('assist.insured.searchPlaceholder')} aria-label={t('assist.insured.searchAria')} />
        </div>
      )}
      <div className="mb-3">
        <Button
          variant="ghost"
          size="sm"
          onClick={() => {
            setTailMode(!tail);
            setTailRows(null);
          }}
        >
          {tail ? t('assist.insured.tail.close') : t('assist.insured.tail.open')}
        </Button>
        {tail && tailRows && (
          <span className="ml-3 text-[13px] text-muted" role="status">
            {t('assist.insured.tail.found', { count: tailRows.length })}
          </span>
        )}
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('assist.insured.caption')}
          columns={columns}
          rows={tail ? (tailRows ?? []) : q.data}
          loading={tail ? false : q.isLoading}
          error={tail ? null : q.error}
          onRetry={() => void q.refetch()}
          rowKey={(i) => i.id}
          onRowClick={(i) => navigate(`/assist/insured/${i.id}`)}
          onRowOpen={(i) => navigate(`/assist/insured/${i.id}`)}
          empty={t('assist.insured.empty')}
        />
      </div>
    </>
  );
}
