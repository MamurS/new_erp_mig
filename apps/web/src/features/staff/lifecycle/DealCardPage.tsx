/* Карточка сделки (LIFECYCLE_SPEC §3): stage steps, the panel of the current stage, documents and events. */
import { DealChecklist, MissingNote } from '@/features/next/DealChecklist';
import { SideColumn } from '@/shared/ui/side-column';
import { StickySectionsCtx } from '@/shared/ui/sticky-sections';
import { defineLabels, t, tm } from '@/i18n';
import { useState, type ReactNode } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import { AlertTriangle, FileText } from 'lucide-react';
import type { DealCard } from '@mig/contracts/dto';
import { useCreateContract, useCreateQuote, useDeal, useDealLost, useKpRespond, usePatchDeal, useSendDealKp, useStaffDirectory } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { useCan } from '@/shared/auth/guards';
import { CONTRACT_STATUS_CHIP, CONTRACT_STATUS_LABEL, DEAL_STAGE_LABEL, DEAL_STAGES } from '@mig/domain/contracts';
import { KP_STATUS_CHIP, KP_STATUS_LABEL } from '@mig/domain/kp';
import { PROGRAM_LABEL } from '@mig/domain/labels';
import { dealLostSchema, kpDeclineSchema } from '@mig/contracts/forms';
import { formatDate, formatDateTime, formatMoney } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Input, Select } from '@/shared/ui/input';
import { LegalFormChip } from '@/shared/ui/legal-form';
import { Card, Kv, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { ReasonDialog, Stepper } from './common';

const QUOTE_STATUS_LABEL = defineLabels('staffLc.quoteStatus', ['draft', 'pending_approval', 'approved', 'rejected'] as const);
const QUOTE_STATUS_CHIP = { draft: 'neutral', pending_approval: 'warning', approved: 'success', rejected: 'danger' } as const;

function useAction() {
  return async (fn: () => Promise<unknown>, ok: string) => {
    try {
      await fn();
      toast.success(ok);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
}

function StagePanel({ deal }: { deal: DealCard }) {
  const navigate = useNavigate();
  const run = useAction();
  const canManage = useCan('deals.manage');
  const canCensus = useCan('census.upload');
  const canQuote = useCan('quotes.calculate');
  const canKpManual = useCan('kp.respond', { sub: 'manual' });
  const canDraft = useCan('contracts.draft');
  const createQuote = useCreateQuote();
  const sendKp = useSendDealKp();
  const respond = useKpRespond();
  const createContract = useCreateContract();
  const [decline, setDecline] = useState(false);
  const closed = deal.stage === 'lost' || deal.stage === 'active';

  const block = (title: string, text: ReactNode, actions?: ReactNode) => (
    <Card title={t('staffLc.deal.now', { title })}>
      <div className="text-[13px] text-muted">{text}</div>
      {actions && <div className="mt-3 flex flex-wrap gap-2">{actions}</div>}
    </Card>
  );

  if (deal.stage === 'lost') return block(t('staffLc.deal.lostTitle'), t('staffLc.deal.lostReason', { reason: deal.lostReason ?? '—' }));
  if (deal.stage === 'active')
    return block(
      t('staffLc.deal.activeTitle'),
      t('staffLc.deal.activeText'),
      deal.contract && (
        <Button size="sm" variant="secondary" onClick={() => navigate(`/staff/contracts/${deal.contract!.id}`)}>
          {t('staffLc.deal.openContract')}
        </Button>
      ),
    );

  const quoteButton =
    canQuote && !closed ? (
      deal.quote ? (
        <Button size="sm" onClick={() => navigate(`/staff/quotes/${deal.quote!.id}`)}>
          {t('staffLc.deal.openQuote')}
        </Button>
      ) : (
        <Button
          size="sm"
          disabled={!deal.census}
          loading={createQuote.isPending}
          onClick={() =>
            void run(async () => {
              const q = await createQuote.mutateAsync({ dealId: deal.id, program: 'standard', adjustments: [] });
              navigate(`/staff/quotes/${q.id}`);
            }, t('staffLc.deal.quoteCreated'))
          }
        >
          {t('staffLc.deal.calcQuote')}
        </Button>
      )
    ) : null;

  switch (deal.stage) {
    case 'lead':
    case 'census':
      return block(
        deal.census ? t('staffLc.deal.censusLoaded') : t('staffLc.deal.censusNeeded'),
        deal.census
          ? t('staffLc.deal.censusLoadedText', { n: deal.census.rows.length, date: formatDate(deal.census.uploadedAt) })
          : t('staffLc.deal.censusNeededText'),
        <>
          {(canCensus || canManage) && (
            <Button size="sm" variant={deal.census ? 'secondary' : 'primary'} onClick={() => navigate(`/staff/deals/${deal.id}/census`)}>
              {deal.census ? t('staffLc.census.title') : t('staffLc.deal.uploadCensus')}
            </Button>
          )}
          {quoteButton}
          <MissingNote items={deal.checklist} />
        </>,
      );
    case 'quote': {
      const q = deal.quote;
      const approved = q?.status === 'approved';
      return block(
        q ? t('staffLc.deal.quoteWithStatus', { status: QUOTE_STATUS_LABEL[q.status].toLowerCase() }) : t('staffLc.deal.quoteLower'),
        approved ? t('staffLc.deal.quoteApprovedText') : t('staffLc.deal.quoteNotApprovedText'),
        <>
          {quoteButton}
          {!canQuote && q && (
            <Button size="sm" variant="secondary" onClick={() => navigate(`/staff/quotes/${q.id}`)}>
              {t('staffLc.deal.quote')}
            </Button>
          )}
          {canManage && (
            <Button size="sm" disabled={!approved} loading={sendKp.isPending} onClick={() => void run(() => sendKp.mutateAsync(deal.id), t('staffLc.deal.kpSent'))}>
              {t('staffLc.deal.sendKp')}
            </Button>
          )}
          <MissingNote items={deal.checklist} />
        </>,
      );
    }
    case 'kp_sent':
      return (
        <>
          {block(
            t('staffLc.deal.kpAtClient'),
            t('staffLc.deal.kpAtClientText'),
            <>
              {deal.kp && (
                <Button size="sm" variant="secondary" onClick={() => navigate(`/staff/kp/${deal.kp!.id}`)}>
                  {t('staffLc.deal.openKp')}
                </Button>
              )}
              {canKpManual && deal.kp && (
                <>
                  <Button size="sm" loading={respond.isPending} onClick={() => void run(() => respond.mutateAsync({ kpId: deal.kp!.id, decision: 'accept' }), t('staffLc.deal.kpAcceptedToast'))}>
                    {t('staffLc.deal.clientAccepted')}
                  </Button>
                  <Button size="sm" variant="secondary" onClick={() => setDecline(true)}>
                    {t('staffLc.deal.clientDeclined')}
                  </Button>
                </>
              )}
            </>,
          )}
          {deal.kp && (
            <ReasonDialog
              open={decline}
              onClose={() => setDecline(false)}
              title={t('staffLc.deal.declineTitle')}
              description={t('staffLc.deal.declineDesc')}
              label={t('staffLc.deal.declineReason')}
              field="reason"
              schema={kpDeclineSchema}
              confirmLabel={t('staffLc.deal.declineConfirm')}
              danger
              onSubmit={(reason) => respond.mutateAsync({ kpId: deal.kp!.id, decision: 'decline', reason })}
            />
          )}
        </>
      );
    case 'kp_accepted':
      return block(
        t('staffLc.deal.kpAccepted'),
        t('staffLc.deal.kpAcceptedText'),
        canDraft && (
          <Button
            size="sm"
            loading={createContract.isPending}
            onClick={() =>
              void run(async () => {
                const c = await createContract.mutateAsync(deal.id);
                navigate(`/staff/contracts/${c.id}`);
              }, t('staffLc.deal.contractCreated'))
            }
          >
            {t('staffLc.deal.prepareContract')}
          </Button>
        ),
      );
    default:
      return block(
        DEAL_STAGE_LABEL[deal.stage].toLowerCase(),
        deal.stage === 'awaiting_payment' ? t('staffLc.deal.awaitingPaymentText') : t('staffLc.deal.inContractText'),
        deal.contract && (
          <>
            <Button size="sm" onClick={() => navigate(`/staff/contracts/${deal.contract!.id}`)}>
              {t('staffLc.deal.openContract')}
            </Button>
            <MissingNote items={deal.checklist} />
          </>
        ),
      );
  }
}

function DealInfo({ deal }: { deal: DealCard }) {
  const canManage = useCan('deals.manage');
  const patch = usePatchDeal();
  const directory = useStaffDirectory();
  const underwriters = (directory.data ?? []).filter((s) => s.role === 'underwriter');
  const [start, setStart] = useState(deal.expectedStart ? formatDate(deal.expectedStart) : '');
  const closed = deal.stage === 'lost' || deal.stage === 'active';
  const save = async (body: { expectedStart?: string; underwriterId?: string }) => {
    try {
      await patch.mutateAsync({ id: deal.id, ...body });
      toast.success(t('staffLc.deal.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card title={t('staffLc.deal.fallback')}>
      <dl className="text-[13px]">
        <Kv label={t('common.client')}>
          <Link className="text-accent-text underline-offset-2 hover:underline" to={`/staff/clients/${deal.clientId}`}>
            {deal.clientName}
          </Link>{' '}
          <LegalFormChip code={deal.clientLegalForm} />
        </Kv>
        <Kv label={t('common.type')}>{deal.type === 'renewal' ? t('staffLc.deals.typeRenewal') : t('staffLc.deals.typeNew')}</Kv>
        <Kv label={t('common.manager')}>{deal.ownerName}</Kv>
        <Kv label={t('staffLc.deals.headcount')}>{deal.client.estimatedHeadcount ?? '—'}</Kv>
        <Kv label={t('staffLc.deals.currentInsurer')}>{deal.client.currentInsurer ?? '—'}</Kv>
        <Kv label={t('common.premium')}>{deal.premium ? <span className="num">{formatMoney(deal.premium)}</span> : '—'}</Kv>
      </dl>
      {canManage && !closed ? (
        <div className="mt-3 grid gap-3 border-t border-border-soft pt-3">
          <Field label={t('staffLc.deal.underwriter')}>
            {(a) => (
              <Select {...a} value={deal.underwriterId ?? ''} onChange={(e) => e.target.value && void save({ underwriterId: e.target.value })}>
                <option value="">{t('staffLc.deal.notAssigned')}</option>
                {underwriters.map((u) => (
                  <option key={u.id} value={u.id}>
                    {u.fullName}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          <Field label={t('staffLc.deal.expectedStart')}>
            {(a) => (
              <div className="flex gap-2">
                <Input {...a} value={start} maxLength={10} placeholder={t('staffLc.deal.datePlaceholder')} onChange={(e) => setStart(e.target.value)} />
                <Button size="sm" variant="secondary" disabled={!start} onClick={() => void save({ expectedStart: start })}>
                  {t('common.save')}
                </Button>
              </div>
            )}
          </Field>
        </div>
      ) : (
        <dl className="text-[13px]">
          <Kv label={t('staffLc.deal.underwriter')}>{deal.underwriterName ?? '—'}</Kv>
          <Kv label={t('staffLc.deal.expectedStart')}>{deal.expectedStart ? formatDate(deal.expectedStart) : '—'}</Kv>
        </dl>
      )}
    </Card>
  );
}

function Documents({ deal }: { deal: DealCard }) {
  const rows: { label: string; to?: string; chip?: ReactNode; meta?: string }[] = [];
  if (deal.census) rows.push({ label: t('staffLc.deal.docCensus', { n: deal.census.rows.length }), to: `/staff/deals/${deal.id}/census`, meta: formatDate(deal.census.uploadedAt) });
  if (deal.quote)
    rows.push({
      label: t('staffLc.deal.docQuote', { program: PROGRAM_LABEL[deal.quote.program], total: formatMoney(deal.quote.total) }),
      to: `/staff/quotes/${deal.quote.id}`,
      chip: <Chip kind={QUOTE_STATUS_CHIP[deal.quote.status]}>{QUOTE_STATUS_LABEL[deal.quote.status]}</Chip>,
    });
  if (deal.kp) rows.push({ label: t('staffLc.deal.docKp', { number: deal.kp.number }), to: `/staff/kp/${deal.kp.id}`, chip: <Chip kind={KP_STATUS_CHIP[deal.kp.status]}>{KP_STATUS_LABEL[deal.kp.status]}</Chip> });
  if (deal.contract)
    rows.push({
      label: t('staffLc.deal.docContract', { number: deal.contract.number, version: deal.contract.version }),
      to: `/staff/contracts/${deal.contract.id}`,
      chip: <Chip kind={CONTRACT_STATUS_CHIP[deal.contract.status]}>{CONTRACT_STATUS_LABEL[deal.contract.status]}</Chip>,
    });
  return (
    <Card title={t('staffLc.deal.documents')} bodyClassName="p-0">
      {rows.length ? (
        <ul className="divide-y divide-border-soft text-[13px]">
          {rows.map((r) => (
            <li key={r.label} className="flex items-center justify-between gap-2 px-4 py-2.5">
              <span className="flex min-w-0 items-center gap-2">
                <FileText className="h-4 w-4 shrink-0 text-muted" aria-hidden />
                {r.to ? (
                  <Link to={r.to} className="truncate text-accent-text hover:underline">
                    {r.label}
                  </Link>
                ) : (
                  <span className="truncate">{r.label}</span>
                )}
              </span>
              {r.chip ?? (r.meta && <span className="num text-muted">{r.meta}</span>)}
            </li>
          ))}
        </ul>
      ) : (
        <p className="px-4 py-3 text-[13px] text-muted">{t('staffLc.deal.noDocuments')}</p>
      )}
    </Card>
  );
}

export default function DealCardPage() {
  const { dealId = '' } = useParams();
  const q = useDeal(dealId);
  const lost = useDealLost();
  const canManage = useCan('deals.manage');
  const [lostOpen, setLostOpen] = useState(false);
  useDocumentTitle(q.data ? t('staffLc.deal.titleNumber', { number: q.data.number }) : t('staffLc.deal.fallback'));
  useTopbar([{ label: t('staffLc.deals.title'), to: '/staff/deals' }, { label: q.data?.number ?? t('staffLc.deal.fallback') }]);

  return (
    <QueryState query={q}>
      {(deal) => (
        <>
          <PageHeader
            title={
              <span className="flex flex-wrap items-center gap-2">
                {deal.clientName}
                <LegalFormChip code={deal.clientLegalForm} />
                {deal.type === 'renewal' && <Chip kind="renewal">{t('staffLc.deals.renewalChip')}</Chip>}
              </span>
            }
            subtitle={<span className="num">{t('staffLc.deal.subtitle', { number: deal.number, date: formatDate(deal.createdAt) })}</span>}
            actions={
              canManage &&
              deal.stage !== 'lost' &&
              deal.stage !== 'active' && (
                <Button variant="secondary" onClick={() => setLostOpen(true)}>
                  {t('staffLc.deal.markLost')}
                </Button>
              )
            }
          />
          <div className="mb-4 rounded-card border border-border bg-surface p-3">
            <Stepper steps={deal.stage === 'lost' ? [...DEAL_STAGES, 'lost' as const] : DEAL_STAGES} current={deal.stage} labels={DEAL_STAGE_LABEL} failed={deal.stage === 'lost'} />
          </div>
          {deal.reminders.map((r) => (
            <p key={r} role="status" className="mb-3 flex items-center gap-2 rounded-card border border-warning/40 bg-warning-soft px-3 py-2 text-[13px] text-warning-text">
              <AlertTriangle className="h-4 w-4 shrink-0" aria-hidden />
              {tm(r)}
            </p>
          ))}
          <StickySectionsCtx.Provider value>
            <div className="flex min-w-0 flex-col gap-4">
              <StagePanel deal={deal} />
              <DealChecklist deal={deal} />
              <Documents deal={deal} />
              <Card title={t('staffLc.deal.events')} bodyClassName="p-0">
                <ol className="divide-y divide-border-soft text-[13px]" data-testid="deal-events">
                  {[...deal.events].reverse().map((e) => (
                    <li key={e.id} className="px-4 py-2.5">
                      <p>{tm(e.text)}</p>
                      <p className="mt-0.5 text-[12px] text-muted">
                        <span className="num">{formatDateTime(e.at)}</span> · {e.actorName}
                      </p>
                    </li>
                  ))}
                </ol>
              </Card>
            </div>
          </StickySectionsCtx.Provider>
          <SideColumn label={t('staffLc.deal.fallback')} width={340} testId="deal-info-column">
            <DealInfo deal={deal} />
          </SideColumn>
          <ReasonDialog
            open={lostOpen}
            onClose={() => setLostOpen(false)}
            title={t('staffLc.deal.markLost')}
            description={t('staffLc.deal.lostDesc')}
            label={t('common.reason')}
            field="reason"
            schema={dealLostSchema}
            confirmLabel={t('staffLc.deal.closeDeal')}
            danger
            onSubmit={(reason) => lost.mutateAsync({ id: deal.id, reason })}
          />
        </>
      )}
    </QueryState>
  );
}
