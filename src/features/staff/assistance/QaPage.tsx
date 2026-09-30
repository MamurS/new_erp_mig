/* Quality-control queue of MIG doctor experts (§5.6): a 5% sample of assistance decisions. */
import { useState } from 'react';
import type { QaSampleView } from '@/shared/types/dto';
import { useQaQueue, useReviewQa } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { qaReviewSchema } from '@/shared/schemas/forms';
import { formatDate } from '@/shared/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { Tabs, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';

export function QaVerdict({ s }: { s: QaSampleView }) {
  if (!s.verdict) return <Chip kind="sky">Ждёт оценки</Chip>;
  return (
    <span className="flex flex-col gap-0.5">
      <Chip kind={s.verdict === 'agree' ? 'success' : 'danger'}>{s.verdict === 'agree' ? 'Согласен' : 'Не согласен'}</Chip>
      {s.comment && <span className="text-[12px] text-muted">{s.comment}</span>}
    </span>
  );
}

export default function QaPage() {
  useDocumentTitle('Контроль качества');
  useTopbar([{ label: 'Контроль качества' }]);
  const [f, setF] = useUrlFilters(['status'] as const);
  const status = f.status === 'reviewed' || f.status === 'all' ? f.status : 'pending';
  const q = useQaQueue({ status });
  const review = useReviewQa();
  const [open, setOpen] = useState<QaSampleView | null>(null);
  const [verdict, setVerdict] = useState<'agree' | 'disagree'>('agree');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const columns: Column<QaSampleView>[] = [
    { key: 'date', header: 'В выборке с', cell: (s) => <span className="num">{formatDate(s.createdAt)}</span> },
    { key: 'who', header: 'Ассистанс', cell: (s) => s.assistanceName },
    { key: 'type', header: 'Решение', cell: (s) => (s.subject.type === 'guarantee' ? 'Гарантийное письмо' : 'Строка реестра') },
    { key: 'label', header: 'Что проверяем', cell: (s) => s.subject.label },
    { key: 'verdict', header: 'Оценка МИГ', cell: (s) => <QaVerdict s={s} /> },
    {
      key: 'actions',
      header: '',
      align: 'right',
      cell: (s) =>
        s.verdict ? null : (
          <Button
            size="sm"
            variant="secondary"
            onClick={() => {
              setOpen(s);
              setVerdict('agree');
              setComment('');
              setError(undefined);
            }}
          >
            Оценить
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader title="Контроль качества ассистансов" subtitle="Каждый месяц система случайно отбирает 5% решений ассистансов. Оценка попадает в KPI, но не меняет решение по оплаченному делу" />
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'pending' ? null : v })}>
        <TabsList>
          <TabsTrigger value="pending">Ждут оценки</TabsTrigger>
          <TabsTrigger value="reviewed">Оценены</TabsTrigger>
          <TabsTrigger value="all">Все</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable caption="Контрольная выборка" columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(s) => s.id} empty="Выборка пуста" />
      </div>
      {open && (
        <Modal
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title="Оценка решения ассистанса"
          description={`${open.assistanceName} · ${open.subject.label}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                Отмена
              </Button>
              <Button
                loading={review.isPending}
                onClick={async () => {
                  const parsed = qaReviewSchema.safeParse({ verdict, comment: comment || undefined });
                  if (!parsed.success) {
                    setError(parsed.error.issues[0]?.message);
                    return;
                  }
                  try {
                    await review.mutateAsync({ id: open.id, ...parsed.data });
                    toast.success('Оценка сохранена');
                    setOpen(null);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                Сохранить
              </Button>
            </>
          }
        >
          <div className="mb-3 flex gap-4" role="radiogroup" aria-label="Оценка">
            <label className="flex items-center gap-1.5">
              <input type="radio" name="verdict" checked={verdict === 'agree'} onChange={() => setVerdict('agree')} /> Согласен
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="verdict" checked={verdict === 'disagree'} onChange={() => setVerdict('disagree')} /> Не согласен
            </label>
          </div>
          <Field label="Комментарий" error={error} hint={verdict === 'disagree' ? 'Обязательно при несогласии' : undefined}>
            {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </>
  );
}
