/*
 * One batch of the portfolio transfer: the six files in the load order (upload → dry run with the report
 * by row and column → confirm, rows with errors excluded explicitly), sending for approval, the second
 * administrator's decision, reconciliation of totals and the rollback with the reasons it is blocked.
 */
import { t, tm } from '@/i18n';
import { useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Download, Undo2 } from 'lucide-react';
import type { MigrationBatchView, MigrationStepView } from '@/shared/types/migration';
import { errorMessage } from '@/shared/api/client';
import { useConfirmMigrationStep, useDiscardMigrationBatch, useMigrationAction, useMigrationBatch, useMigrationReasonAction, useSkipMigrationStep, useUploadMigrationStep } from '@/shared/api/queries/migration';
import { AUDIT_ACTION_LABEL } from '@/shared/domain/labels';
import { MIGRATION_STEPS, migrationFileName, migrationTemplateCsv, stepAvailable } from '@/shared/domain/migration';
import { MIGRATION_CSV_MAX_BYTES } from '@/shared/schemas/migration';
import type { AuditAction } from '@/shared/types';
import { downloadText } from '@/shared/lib/csv';
import { cn } from '@/shared/lib/cn';
import { formatDate, formatDateTime, formatMoney, formatNumber } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Checkbox } from '@/shared/ui/checkbox';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Card, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { TableScroll } from '@/shared/ui/table-scroll';
import { toast } from '@/shared/ui/toast';
import { CsvFileButton } from '../../lifecycle/common';
import { useTopbar } from '../../topbar';
import { ReasonDialog } from './dialogs';
import { BATCH_STATUS_CHIP, BATCH_STATUS_LABEL, BLOCKER_LABEL, KIND_LABEL, LEVEL_LABEL, METRIC_LABEL, STEP_HINT, STEP_LABEL, STEP_STATUS_CHIP, STEP_STATUS_LABEL } from './labels';

const th = 'px-3 py-2 text-left text-[12px] font-medium text-muted';
const td = 'px-3 py-1.5 align-top';

async function attempt(fn: () => Promise<unknown>, ok: string): Promise<boolean> {
  try {
    await fn();
    toast.success(ok);
    return true;
  } catch (e) {
    toast.error(errorMessage(e));
    return false;
  }
}

function IssuesTable({ s }: { s: MigrationStepView }) {
  if (s.issues.length === 0) return <p className="text-[13px] text-success-text">{t('migration.noIssues')}</p>;
  return (
    <div className="max-h-72 overflow-y-auto rounded-btn border border-border-soft">
      <TableScroll>
        <table className="w-full text-[13px]" data-testid={`issues-${s.step}`}>
          <caption className="sr-only">{t('migration.issuesCaption', { step: STEP_LABEL[s.step] })}</caption>
          <thead className="bg-rail">
            <tr>
              <th className={th}>{t('migration.col.row')}</th>
              <th className={th}>{t('migration.col.field')}</th>
              <th className={th}>{t('migration.col.level')}</th>
              <th className={th}>{t('migration.col.message')}</th>
            </tr>
          </thead>
          <tbody>
            {s.issues.map((i, k) => (
              <tr key={k} className="border-t border-border-soft">
                <td className={cn(td, 'num')}>{i.row}</td>
                <td className={cn(td, 'font-mono text-[12px]')}>{i.field}</td>
                <td className={td}>
                  <Chip kind={i.level === 'error' ? 'danger' : 'warning'}>{LEVEL_LABEL[i.level]}</Chip>
                </td>
                <td className={td}>{tm(i.message)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
      {s.issues.length >= 500 && <p className="px-3 py-1.5 text-[12px] text-muted">{t('migration.issuesCut', { n: 500 })}</p>}
    </div>
  );
}

function StepCard({ b, s, n }: { b: MigrationBatchView; s: MigrationStepView; n: number }) {
  const upload = useUploadMigrationStep();
  const confirm = useConfirmMigrationStep();
  const skip = useSkipMigrationStep();
  const [exclude, setExclude] = useState(false);
  const editable = b.status === 'draft' && b.isAuthor;
  const statuses = Object.fromEntries(b.steps.map((x) => [x.step, x.status]));
  const available = stepAvailable(statuses, s.step);
  const checked = s.status === 'validated' || s.status === 'confirmed';
  return (
    <Card
      className="mb-3"
      title={
        <span className="flex flex-wrap items-center gap-2" data-testid={`step-${s.step}`}>
          {t('migration.stepTitle', { n, step: STEP_LABEL[s.step] })}
          <Chip kind={STEP_STATUS_CHIP[s.status]}>{STEP_STATUS_LABEL[s.status]}</Chip>
        </span>
      }
      actions={
        <div className="flex flex-wrap items-center gap-2">
          <Button
            size="sm"
            variant="ghost"
            onClick={() => {
              downloadText(migrationTemplateCsv(s.step), migrationFileName(s.step));
              toast.success(t('migration.templateDownloaded'));
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> {t('migration.templateFor', { step: STEP_LABEL[s.step] })}
          </Button>
          {editable && available && (
            <CsvFileButton
              label={checked ? t('migration.reupload') : t('migration.upload')}
              ariaLabel={t('migration.uploadAria', { step: STEP_LABEL[s.step] })}
              busy={upload.isPending}
              maxBytes={MIGRATION_CSV_MAX_BYTES}
              onText={(csv) => {
                setExclude(false);
                void attempt(() => upload.mutateAsync({ id: b.id, step: s.step, csv }), t('migration.validatedToast'));
              }}
            />
          )}
          {editable && available && s.status === 'empty' && (
            <Button size="sm" variant="secondary" loading={skip.isPending} onClick={() => void attempt(() => skip.mutateAsync({ id: b.id, step: s.step }), STEP_STATUS_LABEL.skipped)}>
              {t('migration.skip')}
            </Button>
          )}
        </div>
      }
    >
      <p className="text-[13px] text-muted">{STEP_HINT[s.step]}</p>
      {editable && !available && s.status === 'empty' && <p className="mt-2 text-[13px] text-muted">{t('migration.waitEarlier')}</p>}
      {checked && (
        <div className="mt-3 flex flex-col gap-3">
          <p className="text-[13px]" data-testid={`summary-${s.step}`}>
            {t('migration.summary', { total: s.total, valid: s.valid, errors: s.errorRows, warnings: s.warningRows })}
            {s.status === 'validated' && <span className="ml-2 text-muted">· {t('migration.dryRun')}</span>}
          </p>
          <IssuesTable s={s} />
          {editable && s.status === 'validated' && (
            <div className="flex flex-wrap items-center gap-3">
              {s.errorRows > 0 && (
                <label className="flex items-center gap-2 text-[13px]">
                  <Checkbox checked={exclude} onCheckedChange={setExclude} />
                  {t('migration.excludeErrors', { n: s.errorRows })}
                </label>
              )}
              <Button
                size="sm"
                disabled={s.errorRows > 0 && !exclude}
                loading={confirm.isPending}
                onClick={() => void attempt(() => confirm.mutateAsync({ id: b.id, step: s.step, excludeErrors: exclude }), t('migration.stepConfirmed'))}
              >
                {t('migration.confirmStep')}
              </Button>
              {s.errorRows > 0 && !exclude && <span className="text-[12px] text-muted">{t('migration.needExclude')}</span>}
            </div>
          )}
        </div>
      )}
    </Card>
  );
}

function Reconciliation({ b }: { b: MigrationBatchView }) {
  if (b.reconciliation.length === 0) return null;
  const loaded = b.status === 'applied' || b.status === 'rolled_back';
  const fmt = (money: boolean, v: number) => (money ? formatMoney(v) : formatNumber(v));
  return (
    <Card title={t('migration.recon')} className="mb-3">
      <p className="mb-2 text-[13px] text-muted">{loaded ? t('migration.reconHintLoaded') : t('migration.reconHintPlanned')}</p>
      <TableScroll>
        <table className="w-full text-[13px]" data-testid="reconciliation">
          <caption className="sr-only">{t('migration.reconCaption')}</caption>
          <thead className="bg-rail">
            <tr>
              <th className={th}>{t('migration.col.metric')}</th>
              <th className={cn(th, 'text-right')}>{t('migration.col.file')}</th>
              <th className={cn(th, 'text-right')}>{t('migration.col.excluded')}</th>
              <th className={cn(th, 'text-right')}>{loaded ? t('migration.col.loaded') : t('migration.col.planned')}</th>
              <th className={cn(th, 'text-right')}>{t('migration.col.diff')}</th>
              <th className={th}>{t('common.status')}</th>
            </tr>
          </thead>
          <tbody>
            {b.reconciliation.map((r) => (
              <tr key={r.metric} data-testid={`recon-${r.metric}`} data-match={r.match ? 'true' : 'false'} className={cn('border-t border-border-soft', !r.match && 'bg-danger-soft')}>
                <td className={td}>{METRIC_LABEL[r.metric]}</td>
                <td className={cn(td, 'num text-right')}>{fmt(r.money, r.file)}</td>
                <td className={cn(td, 'num text-right')}>{r.excluded ? fmt(r.money, r.excluded) : '—'}</td>
                <td className={cn(td, 'num text-right')}>{fmt(r.money, r.loaded)}</td>
                <td className={cn(td, 'num text-right', !r.match && 'font-semibold text-danger-text')}>{r.match ? '—' : fmt(r.money, r.loaded - r.file)}</td>
                <td className={td}>{r.match ? <Chip kind="success">{t('migration.reconOk')}</Chip> : <Chip kind="danger">{t('migration.reconMismatch')}</Chip>}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

function Rollback({ b }: { b: MigrationBatchView }) {
  const act = useMigrationReasonAction();
  const [open, setOpen] = useState(false);
  if (b.status !== 'applied' || !b.rollback) return null;
  return (
    <Card title={t('migration.rollback')} className="mb-3">
      {b.rollback.allowed ? (
        <div className="flex flex-wrap items-center justify-between gap-3">
          <p className="text-[13px] text-muted">{t('migration.rollbackHint')}</p>
          <Button variant="danger" onClick={() => setOpen(true)}>
            <Undo2 className="h-4 w-4" aria-hidden /> {t('migration.rollbackDo')}
          </Button>
        </div>
      ) : (
        <div data-testid="rollback-blocked">
          <p role="status" className="mb-1 rounded-btn bg-warning-soft px-3 py-2 text-[13px] font-medium text-warning-text">
            {t('migration.rollbackBlocked')}
          </p>
          <p className="mb-3 text-[12px] text-muted">{t('migration.rollbackBlockedHint')}</p>
          <TableScroll>
            <table className="w-full text-[13px]" data-testid="rollback-blockers">
              <caption className="sr-only">{t('migration.blockersCaption')}</caption>
              <thead className="bg-rail">
                <tr>
                  <th className={th}>{t('migration.col.what')}</th>
                  <th className={th}>{t('migration.col.record')}</th>
                  <th className={th}>{t('migration.col.who')}</th>
                  <th className={th}>{t('migration.col.when')}</th>
                </tr>
              </thead>
              <tbody>
                {b.rollback.blockers.map((x, k) => (
                  <tr key={k} className="border-t border-border-soft">
                    <td className={td}>{x.kind === 'audit' && x.action ? (AUDIT_ACTION_LABEL[x.action as AuditAction] ?? BLOCKER_LABEL.audit) : BLOCKER_LABEL[x.kind]}</td>
                    <td className={td}>{x.label || '—'}</td>
                    <td className={td}>{x.actorName ?? '—'}</td>
                    <td className={cn(td, 'num whitespace-nowrap')}>{x.at ? formatDateTime(x.at) : '—'}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </TableScroll>
        </div>
      )}
      {open && (
        <ReasonDialog
          title={t('migration.rollbackTitle')}
          description={t('migration.rollbackDesc')}
          confirmLabel={t('migration.rollbackDo')}
          danger
          loading={act.isPending}
          onClose={() => setOpen(false)}
          onConfirm={(reason) => void attempt(() => act.mutateAsync({ id: b.id, action: 'rollback', reason }), t('migration.rolledBack')).then((ok) => ok && setOpen(false))}
        />
      )}
    </Card>
  );
}

function Decision({ b }: { b: MigrationBatchView }) {
  const action = useMigrationAction();
  const reasonAction = useMigrationReasonAction();
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  if (b.status !== 'pending_approval') return null;
  return (
    <div data-testid="batch-pending" role="status" className="mb-3 flex flex-wrap items-center justify-between gap-3 rounded-card border border-warning/40 bg-warning-soft px-4 py-3 text-[13px] text-warning-text">
      <div>
        <p className="font-semibold">{t('migration.pendingTitle')}</p>
        {b.isAuthor && <p>{t('migration.pendingOwn')}</p>}
      </div>
      <div className="flex flex-wrap gap-2">
        {(b.canApprove || b.isAuthor) && (
          <Button variant="secondary" onClick={() => setDialog('reject')}>
            {b.isAuthor ? t('migration.withdraw') : t('migration.reject')}
          </Button>
        )}
        {b.canApprove && <Button onClick={() => setDialog('approve')}>{t('migration.approve')}</Button>}
      </div>
      <ConfirmDialog
        open={dialog === 'approve'}
        onOpenChange={(o) => !o && setDialog(null)}
        title={t('migration.approve')}
        description={t('migration.approveConfirm')}
        confirmLabel={t('migration.approve')}
        loading={action.isPending}
        onConfirm={() => void attempt(() => action.mutateAsync({ id: b.id, action: 'approve' }), t('migration.applied')).then(() => setDialog(null))}
      />
      {dialog === 'reject' && (
        <ReasonDialog
          title={b.isAuthor ? t('migration.withdraw') : t('migration.rejectTitle')}
          confirmLabel={b.isAuthor ? t('migration.withdraw') : t('migration.reject')}
          danger
          loading={reasonAction.isPending}
          onClose={() => setDialog(null)}
          onConfirm={(reason) => void attempt(() => reasonAction.mutateAsync({ id: b.id, action: 'reject', reason }), t('migration.rejected')).then((ok) => ok && setDialog(null))}
        />
      )}
    </div>
  );
}

function DraftActions({ b }: { b: MigrationBatchView }) {
  const navigate = useNavigate();
  const action = useMigrationAction();
  const discard = useDiscardMigrationBatch();
  const [confirmDiscard, setConfirmDiscard] = useState(false);
  if (b.status !== 'draft' || !b.isAuthor) return null;
  const ready = b.steps.every((s) => s.status === 'confirmed' || s.status === 'skipped');
  return (
    <Card className="mb-3">
      <div className="flex flex-wrap items-center justify-between gap-3">
        <p className="text-[13px] text-muted">{t('migration.submitHint')}</p>
        <div className="flex flex-wrap gap-2">
          <Button variant="secondary" onClick={() => setConfirmDiscard(true)}>
            {t('migration.discard')}
          </Button>
          <Button disabled={!ready} loading={action.isPending} onClick={() => void attempt(() => action.mutateAsync({ id: b.id, action: 'submit' }), t('migration.submitted'))}>
            {t('migration.submit')}
          </Button>
        </div>
      </div>
      <ConfirmDialog
        open={confirmDiscard}
        onOpenChange={setConfirmDiscard}
        title={t('migration.discard')}
        description={t('migration.discardConfirm')}
        confirmLabel={t('migration.discard')}
        danger
        loading={discard.isPending}
        onConfirm={() =>
          void attempt(() => discard.mutateAsync(b.id), t('migration.discarded')).then((ok) => {
            if (ok) navigate('/staff/admin/migration');
          })
        }
      />
    </Card>
  );
}

function Outcome({ b }: { b: MigrationBatchView }) {
  const info =
    b.status === 'applied' && b.appliedAt
      ? t('migration.appliedInfo', { at: formatDateTime(b.appliedAt), name: b.decidedByName ?? '—' })
      : b.status === 'rolled_back' && b.rolledBackAt
        ? t('migration.rolledBackInfo', { at: formatDateTime(b.rolledBackAt), name: b.rolledBackByName ?? '—', reason: b.rollbackReason ?? '' })
        : b.status === 'rejected' && b.decidedAt
          ? t('migration.rejectedInfo', { at: formatDateTime(b.decidedAt), name: b.decidedByName ?? '—', reason: b.rejectReason ?? '' })
          : null;
  if (!info) return null;
  return (
    <p role="status" data-testid="batch-outcome" className={cn('mb-3 rounded-card px-4 py-3 text-[13px]', b.status === 'applied' ? 'bg-success-soft text-success-text' : 'bg-rail text-muted')}>
      {info}
    </p>
  );
}

function Contracts({ b }: { b: MigrationBatchView }) {
  if (b.contracts.length === 0) return null;
  return (
    <Card title={t('migration.contracts')} className="mb-3" bodyClassName="p-0">
      <TableScroll>
        <table className="w-full text-[13px]" data-testid="migrated-contracts">
          <caption className="sr-only">{t('migration.contracts')}</caption>
          <thead className="bg-rail">
            <tr>
              <th className={th}>{t('migration.col.oldNumber')}</th>
              <th className={th}>{t('migration.col.newNumber')}</th>
              <th className={th}>{t('migration.col.client')}</th>
            </tr>
          </thead>
          <tbody>
            {b.contracts.map((c) => (
              <tr key={c.id} className="border-t border-border-soft">
                <td className={cn(td, 'num')}>{c.externalNumber}</td>
                <td className={cn(td, 'num font-medium')}>{c.number}</td>
                <td className={td}>{c.clientName}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </TableScroll>
    </Card>
  );
}

export default function MigrationBatchPage() {
  const { batchId = '' } = useParams();
  const q = useMigrationBatch(batchId);
  const title = q.data ? t('migration.batchTitle', { n: q.data.seq }) : t('migration.title');
  useDocumentTitle(title);
  useTopbar([{ label: t('staff.nav.migration'), to: '/staff/admin/migration' }, { label: title }]);
  return (
    <QueryState query={q}>
      {(b) => (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {t('migration.batchTitle', { n: b.seq })}
                <Chip kind={BATCH_STATUS_CHIP[b.status]}>{BATCH_STATUS_LABEL[b.status]}</Chip>
                <Chip>{KIND_LABEL[b.kind]}</Chip>
              </span>
            }
            subtitle={t('migration.batchSubtitle', { date: formatDate(b.migrationDate), name: b.createdByName, at: formatDateTime(b.createdAt) })}
          />
          <Outcome b={b} />
          <Decision b={b} />
          {MIGRATION_STEPS.map((step, k) => (
            <StepCard key={step} b={b} s={b.steps.find((x) => x.step === step)!} n={k + 1} />
          ))}
          <DraftActions b={b} />
          <Reconciliation b={b} />
          <Contracts b={b} />
          <Rollback b={b} />
        </>
      )}
    </QueryState>
  );
}
