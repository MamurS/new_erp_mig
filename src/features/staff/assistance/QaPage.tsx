/* Quality-control queue of MIG doctor experts (§5.6): a 5% sample of assistance decisions. */
import { useState } from 'react';
import type { QaSampleView } from '@/shared/types/dto';
import { useQaQueue, useReviewQa } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { qaReviewSchema } from '@/shared/schemas/forms';
import { t, tm } from '@/i18n';
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
  if (!s.verdict) return <Chip kind="sky">{t('staffOps.qa.awaiting')}</Chip>;
  return (
    <span className="flex flex-col gap-0.5">
      <Chip kind={s.verdict === 'agree' ? 'success' : 'danger'}>{s.verdict === 'agree' ? t('staffOps.qa.agree') : t('staffOps.qa.disagree')}</Chip>
      {s.comment && <span className="text-[12px] text-muted">{s.comment}</span>}
    </span>
  );
}

export default function QaPage() {
  useDocumentTitle(t('staffOps.qa.title'));
  useTopbar([{ label: t('staffOps.qa.title') }]);
  const [f, setF] = useUrlFilters(['status'] as const);
  const status = f.status === 'reviewed' || f.status === 'all' ? f.status : 'pending';
  const q = useQaQueue({ status });
  const review = useReviewQa();
  const [open, setOpen] = useState<QaSampleView | null>(null);
  const [verdict, setVerdict] = useState<'agree' | 'disagree'>('agree');
  const [comment, setComment] = useState('');
  const [error, setError] = useState<string>();
  const columns: Column<QaSampleView>[] = [
    { key: 'date', header: t('staffOps.qa.col.since'), cell: (s) => <span className="num">{formatDate(s.createdAt)}</span> },
    { key: 'who', header: t('staffOps.rebills.col.assistance'), cell: (s) => s.assistanceName },
    { key: 'type', header: t('common.decision'), cell: (s) => (s.subject.type === 'guarantee' ? t('staffOps.qa.subject.guarantee') : t('staffOps.qa.subject.registryLine')) },
    { key: 'label', header: t('staffOps.qa.col.subject'), cell: (s) => s.subject.label },
    { key: 'verdict', header: t('staffOps.qa.col.verdict'), cell: (s) => <QaVerdict s={s} /> },
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
            {t('staffOps.qa.review')}
          </Button>
        ),
    },
  ];
  return (
    <>
      <PageHeader title={t('staffOps.qa.pageTitle')} subtitle={t('staffOps.qa.subtitle')} />
      <Tabs value={status} onValueChange={(v) => setF({ status: v === 'pending' ? null : v })}>
        <TabsList>
          <TabsTrigger value="pending">{t('staffOps.qa.tab.pending')}</TabsTrigger>
          <TabsTrigger value="reviewed">{t('staffOps.qa.tab.reviewed')}</TabsTrigger>
          <TabsTrigger value="all">{t('common.all')}</TabsTrigger>
        </TabsList>
      </Tabs>
      <div className="mt-3 rounded-card border border-border bg-surface">
        <DataTable caption={t('staffOps.qa.sample')} columns={columns} rows={q.data} loading={q.isLoading} error={q.error} onRetry={() => void q.refetch()} rowKey={(s) => s.id} empty={t('staffOps.qa.empty')} />
      </div>
      {open && (
        <Modal
          open
          onOpenChange={(o) => !o && setOpen(null)}
          title={t('staffOps.qa.dialogTitle')}
          description={`${open.assistanceName} · ${open.subject.label}`}
          footer={
            <>
              <Button variant="secondary" onClick={() => setOpen(null)}>
                {t('common.cancel')}
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
                    toast.success(t('staffOps.qa.saved'));
                    setOpen(null);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  }
                }}
              >
                {t('common.save')}
              </Button>
            </>
          }
        >
          <div className="mb-3 flex gap-4" role="radiogroup" aria-label={t('staffOps.qa.verdict')}>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="verdict" checked={verdict === 'agree'} onChange={() => setVerdict('agree')} /> {t('staffOps.qa.agree')}
            </label>
            <label className="flex items-center gap-1.5">
              <input type="radio" name="verdict" checked={verdict === 'disagree'} onChange={() => setVerdict('disagree')} /> {t('staffOps.qa.disagree')}
            </label>
          </div>
          <Field label={t('common.comment')} error={tm(error) || undefined} hint={verdict === 'disagree' ? t('staffOps.qa.requiredOnDisagree') : undefined}>
            {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
        </Modal>
      )}
    </>
  );
}
