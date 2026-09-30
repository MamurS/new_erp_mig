/* One registry of the clinic: lines with checks, draft editing, submission, disputes, reconciliation act. */
import { useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { useForm } from 'react-hook-form';
import { zodResolver } from '@hookform/resolvers/zod';
import type { z } from 'zod';
import { Download, Send, Trash2 } from 'lucide-react';
import type { RegistryLine } from '@/shared/types';
import { registryLineInput } from '@/shared/integration/schemas';
import { useAddRegistryLine, useClinicPriceList, useClinicRegistry, useClinicVisits, useDeleteRegistryLine, useDisputeLine, useSubmitRegistry } from '@/shared/api/queries/clinic';
import { errorMessage } from '@/shared/api/client';
import { REGISTRY_LINE_STATUS_LABEL, REGISTRY_STATUS_CHIP, REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { downloadText, toCsv } from '@/shared/lib/csv';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { PageTitle, Panel } from '../components';

const LINE_CHIP = { pending: 'sky', accepted: 'success', rejected: 'danger', disputed: 'warning' } as const;

type LineForm = z.input<typeof registryLineInput>;

function AddLine({ registryId, period }: { registryId: string; period: string }) {
  const visits = useClinicVisits(period);
  const prices = useClinicPriceList();
  const add = useAddRegistryLine();
  const form = useForm<LineForm>({ resolver: zodResolver(registryLineInput), defaultValues: { visitId: '', serviceDate: '', serviceCode: '', icd10: '', quantity: 1, price: 0 } });
  const e = form.formState.errors;
  const submit = form.handleSubmit(async (line) => {
    try {
      await add.mutateAsync({ id: registryId, line: { ...line, guaranteeNumber: line.guaranteeNumber || undefined } });
      toast.success('Строка добавлена');
      form.reset({ visitId: '', serviceDate: '', serviceCode: '', icd10: '', quantity: 1, price: 0 });
    } catch (err) {
      toast.error(errorMessage(err));
    }
  });
  return (
    <form className="grid gap-2 p-4 md:grid-cols-4" onSubmit={(ev) => void submit(ev)} noValidate aria-label="Добавить строку">
      <Field label="Визит" error={e.visitId?.message} className="md:col-span-2">
        {(a) => (
          <Select
            {...a}
            {...form.register('visitId', {
              onChange: (ev: { target: { value: string } }) => {
                const v = visits.data?.find((x) => x.id === ev.target.value);
                if (v) form.setValue('serviceDate', v.openedAt.slice(0, 10));
              },
            })}
          >
            <option value="">Выберите визит</option>
            {(visits.data ?? []).map((v) => (
              <option key={v.id} value={v.id}>
                {formatDate(v.openedAt)} · {v.insuredName}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Услуга" error={e.serviceCode?.message} className="md:col-span-2">
        {(a) => (
          <Select
            {...a}
            {...form.register('serviceCode', {
              onChange: (ev: { target: { value: string } }) => {
                const p = prices.data?.find((x) => x.code === ev.target.value);
                if (p) form.setValue('price', p.price);
              },
            })}
          >
            <option value="">Выберите услугу</option>
            {(prices.data ?? []).map((p) => (
              <option key={p.code} value={p.code}>
                {p.code} · {p.name}
                {p.requiresGuarantee ? ' · нужно ГП' : ''}
              </option>
            ))}
          </Select>
        )}
      </Field>
      <Field label="Дата услуги" error={e.serviceDate?.message}>
        {(a) => <Input {...a} type="date" {...form.register('serviceDate')} />}
      </Field>
      <Field label="МКБ-10" error={e.icd10?.message}>
        {(a) => <Input {...a} maxLength={8} {...form.register('icd10')} />}
      </Field>
      <Field label="Количество" error={e.quantity?.message}>
        {(a) => <Input {...a} inputMode="numeric" {...form.register('quantity', { valueAsNumber: true })} />}
      </Field>
      <Field label="Цена, UZS" error={e.price?.message}>
        {(a) => <Input {...a} inputMode="numeric" {...form.register('price', { setValueAs: (v: string | number) => Number(String(v).replace(/\s/g, '')) })} />}
      </Field>
      <Field label="Номер ГП (если нужен)" error={e.guaranteeNumber?.message} className="md:col-span-2">
        {(a) => <Input {...a} placeholder="ГП-2026-000123" maxLength={16} {...form.register('guaranteeNumber', { setValueAs: (v: string) => v.trim() || undefined })} />}
      </Field>
      <div className="flex items-end md:col-span-2">
        <Button type="submit" variant="secondary" loading={add.isPending}>
          Добавить строку
        </Button>
      </div>
    </form>
  );
}

function DisputeDialog({ registryId, line, onClose }: { registryId: string; line: RegistryLine; onClose: () => void }) {
  const dispute = useDisputeLine();
  const [comment, setComment] = useState('');
  const [touched, setTouched] = useState(false);
  const send = async () => {
    setTouched(true);
    if (comment.trim().length < 3) return;
    try {
      await dispute.mutateAsync({ id: registryId, lineId: line.id, comment: comment.trim() });
      toast.success('Строка оспорена');
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title="Оспорить отклонение"
      description={`${line.serviceName} · ${formatMoney(line.amount)} · причина: ${line.rejectionReason ?? '—'}`}
      footer={
        <>
          <Button variant="secondary" onClick={onClose}>
            Отмена
          </Button>
          <Button loading={dispute.isPending} onClick={() => void send()}>
            Оспорить
          </Button>
        </>
      }
    >
      <Field label="Комментарий для МИГ" error={touched && comment.trim().length < 3 ? 'Минимум 3 символа' : undefined}>
        {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
      </Field>
    </Modal>
  );
}

export default function RegistryPage() {
  useDocumentTitle('Реестр');
  const { registryId = '' } = useParams();
  const q = useClinicRegistry(registryId);
  const submit = useSubmitRegistry();
  const del = useDeleteRegistryLine();
  const [disputing, setDisputing] = useState<RegistryLine | null>(null);

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.isError || !q.data) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;
  const r = q.data;
  const draft = r.status === 'draft';
  const problemCount = Object.keys(r.problems).length;

  const doSubmit = async () => {
    try {
      await submit.mutateAsync(r.id);
      toast.success('Реестр отправлен на проверку');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const act = () => {
    const rows = r.lines.map((l) => [l.serviceDate, l.serviceCode, l.serviceName, l.icd10, l.quantity, l.price, l.amount, l.guaranteeNumber ?? '', REGISTRY_LINE_STATUS_LABEL[l.status], l.rejectionReason ?? '']);
    rows.push(['Итого', '', '', '', '', '', r.totals.claimed, '', `Принято ${r.totals.accepted}; отклонено ${r.totals.rejected}; оплачено ${r.totals.paid}`, r.paidAt ? formatDate(r.paidAt) : '']);
    downloadText(toCsv(['Дата', 'Код', 'Услуга', 'МКБ-10', 'Кол-во', 'Цена', 'Сумма', 'ГП', 'Статус', 'Причина'], rows), `reconciliation-act-${r.period}.csv`);
  };

  const columns: Column<RegistryLine>[] = [
    { key: 'date', header: 'Дата', cell: (l) => <span className="num whitespace-nowrap">{formatDate(l.serviceDate)}</span> },
    { key: 'who', header: 'Пациент', cell: (l) => l.insuredName },
    { key: 'svc', header: 'Услуга', cell: (l) => <span>{l.serviceCode} · {l.serviceName}</span> },
    { key: 'icd', header: 'МКБ-10', cell: (l) => <span className="num">{l.icd10}</span> },
    { key: 'qty', header: 'Кол-во', align: 'right', cell: (l) => <span className="num">{l.quantity}</span> },
    { key: 'amount', header: 'Сумма', align: 'right', cell: (l) => <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span> },
    { key: 'gp', header: 'ГП', cell: (l) => <span className="num text-muted">{l.guaranteeNumber ?? '—'}</span> },
    {
      key: 'status',
      header: 'Статус',
      cell: (l) => (
        <span className="flex flex-col gap-0.5">
          {draft ? (
            r.problems[l.id] ? (
              <span className="text-[12px] text-danger-text" data-testid="line-problem">
                {r.problems[l.id]!.join('; ')}
              </span>
            ) : (
              <Chip kind="success">Проверки пройдены</Chip>
            )
          ) : (
            <Chip kind={LINE_CHIP[l.status]}>{REGISTRY_LINE_STATUS_LABEL[l.status]}</Chip>
          )}
          {l.rejectionReason && <span className="text-[12px] text-muted">{l.rejectionReason}</span>}
          {l.disputeComment && <span className="text-[12px] text-muted">Оспорено: {l.disputeComment}</span>}
        </span>
      ),
    },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (l) =>
        draft ? (
          <Button size="sm" variant="ghost" aria-label={`Удалить строку ${l.serviceName}`} onClick={() => void del.mutateAsync({ id: r.id, lineId: l.id }).catch((e: unknown) => toast.error(errorMessage(e)))}>
            <Trash2 className="h-3.5 w-3.5" aria-hidden />
          </Button>
        ) : l.status === 'rejected' && r.status !== 'paid' ? (
          <Button size="sm" variant="secondary" onClick={() => setDisputing(l)}>
            Оспорить
          </Button>
        ) : null,
    },
  ];

  return (
    <>
      <PageTitle
        title={`Реестр за ${r.period}`}
        subtitle={
          <span className="flex flex-wrap items-center gap-2">
            <Link to="/clinic/registries" className="text-accent-text hover:underline">
              ← Реестры
            </Link>
            <span data-testid="registry-status">
              <Chip kind={REGISTRY_STATUS_CHIP[r.status]}>{REGISTRY_STATUS_LABEL[r.status]}</Chip>
            </span>
            {r.submittedAt && <span className="text-[12px]">отправлен {formatDateTime(r.submittedAt)}</span>}
          </span>
        }
        actions={
          <>
            {!draft && (
              <Button variant="secondary" onClick={act}>
                <Download className="h-4 w-4" aria-hidden /> Акт сверки (CSV)
              </Button>
            )}
            {draft && (
              <Button disabled={problemCount > 0 || r.lines.length === 0} loading={submit.isPending} onClick={() => void doSubmit()}>
                <Send className="h-4 w-4" aria-hidden /> Отправить в МИГ
              </Button>
            )}
          </>
        }
      />
      <div className="mb-4 grid grid-cols-2 gap-3 md:grid-cols-5" data-testid="registry-totals">
        {[
          ['Заявлено', formatMoney(r.totals.claimed)],
          ['Принято', formatMoney(r.totals.accepted)],
          ['Отклонено', formatMoney(r.totals.rejected)],
          ['Оплачено', formatMoney(r.totals.paid)],
          ['Дата оплаты', r.paidAt ? formatDate(r.paidAt) : '—'],
        ].map(([label, value]) => (
          <div key={label} className="rounded-card border border-border bg-surface p-3">
            <div className="text-[12px] text-muted">{label}</div>
            <div className="num font-semibold">{value}</div>
          </div>
        ))}
      </div>
      {draft && problemCount > 0 && (
        <p role="alert" className="mb-3 rounded-card bg-danger-soft px-4 py-2 text-danger-text">
          Строк с ошибками: {problemCount}. Исправьте или удалите их, чтобы отправить реестр
        </p>
      )}
      <Panel>
        <DataTable caption="Строки реестра" columns={columns} rows={r.lines} rowKey={(l) => l.id} />
      </Panel>
      {draft && (
        <Panel title="Добавить строку" className="mt-4">
          <AddLine registryId={r.id} period={r.period} />
        </Panel>
      )}
      {disputing && <DisputeDialog registryId={r.id} line={disputing} onClose={() => setDisputing(null)} />}
    </>
  );
}
