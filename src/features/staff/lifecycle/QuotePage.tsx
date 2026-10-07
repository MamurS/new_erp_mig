/* Калькулятор андеррайтера (LIFECYCLE_SPEC §5): tariff by age bands, manual adjustments, approval by authority. */
import { SideColumn } from '@/shared/ui/side-column';
import { StickySectionsCtx } from '@/shared/ui/sticky-sections';
import { defineLabels, t, tm } from '@/i18n';
import { useEffect, useMemo, useState } from 'react';
import { useNavigate, useParams } from 'react-router-dom';
import { Plus, Trash2 } from 'lucide-react';
import type { PricingBasis, ProgramCode } from '@/shared/types';
import type { QuoteView } from '@/shared/types/dto';
import { useQuote, useQuoteAction, useSaveQuote } from '@/shared/api/queries/lifecycle';
import { useDmsParamValues } from '@/shared/api/queries/params';
import { errorMessage } from '@/shared/api/client';
import { AGE_BAND_LABEL, calculateQuote, quoteAuthorityProblem } from '@/shared/domain/tariff';
import { PROGRAM_LABEL } from '@/shared/domain/labels';
import { PRICING_BASES, PRICING_BASIS_LABEL } from '@/shared/domain/pricing';
import { useSession } from '@/shared/auth/session';
import { quoteApproveSchema, quotePatchSchema, quoteRejectSchema } from '@/shared/schemas/forms';
import { formatDateTime, formatMoney, formatNumber, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Input, Select } from '@/shared/ui/input';
import { Card, Kv, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { ReasonDialog } from './common';
import { TableScroll } from '@/shared/ui/table-scroll';
import { AgeBandTable } from './AgeBandTable';

const PROGRAMS: ProgramCode[] = ['basic', 'standard', 'standard_plus', 'premium'];
const STATUS_LABEL = defineLabels('staffLc.quoteStatus', ['draft', 'pending_approval', 'approved', 'rejected'] as const);
const STATUS_CHIP = { draft: 'neutral', pending_approval: 'warning', approved: 'success', rejected: 'danger' } as const;

interface AdjRow {
  label: string;
  pct: string;
  comment: string;
}

const toRows = (q: QuoteView): AdjRow[] => q.adjustments.map((a) => ({ label: a.label, pct: String(Math.round(a.pct * 1000) / 10).replace('.', ','), comment: a.comment }));
const pctOf = (v: string) => Number(v.replace(',', '.').replace(/\s/g, '')) / 100;

function Calculator({ quote }: { quote: QuoteView }) {
  const navigate = useNavigate();
  const params = useDmsParamValues();
  const session = useSession();
  const save = useSaveQuote();
  const action = useQuoteAction();
  const [program, setProgram] = useState<ProgramCode>(quote.program);
  const [pricingBasis, setPricingBasis] = useState<PricingBasis>(quote.pricingBasis);
  const [rows, setRows] = useState<AdjRow[]>(() => toRows(quote));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [dialog, setDialog] = useState<'approve' | 'reject' | null>(null);
  useEffect(() => {
    setProgram(quote.program);
    setPricingBasis(quote.pricingBasis);
    setRows(toRows(quote));
  }, [quote]);

  const editable = quote.canEdit;
  const adjustments = rows.map((r) => ({ label: r.label.trim(), pct: pctOf(r.pct), comment: r.comment.trim() }));
  const valid = adjustments.every((a) => Number.isFinite(a.pct));
  const calc = useMemo(
    () => (quote.census && valid ? calculateQuote({ program, rows: quote.census.rows, startDate: quote.startDate, adjustments }, params) : null),
    // eslint-disable-next-line react-hooks/exhaustive-deps
    [quote.census, quote.startDate, program, JSON.stringify(adjustments), params],
  );
  const shown = editable && calc ? calc : quote;
  const authority = session?.user.authority;
  const problem = editable && calc ? quoteAuthorityProblem(calc, authority) : quote.authorityProblem;

  const parse = () => {
    const parsed = quotePatchSchema.safeParse({ program, adjustments, pricingBasis });
    if (!parsed.success) {
      setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
      return null;
    }
    setErrors({});
    return parsed.data;
  };
  const doSave = async (thenSubmit: boolean) => {
    const data = parse();
    if (!data) return;
    try {
      await save.mutateAsync({ id: quote.id, ...data });
      if (thenSubmit) {
        const r = await action.mutateAsync({ id: quote.id, action: 'submit' });
        toast.success(r.status === 'approved' ? t('staffLc.quote.approvedWithin') : t('staffLc.quote.sentForApproval'));
      } else toast.success(t('staffLc.quote.saved'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  const err = (k: string) => (errors[k] ? tm(errors[k]) : undefined);
  return (
    <>
      <PageHeader
        title={
          <span className="flex flex-wrap items-center gap-2">
            {t('staffLc.deal.quote')}
            <Chip kind={STATUS_CHIP[quote.status]}>{STATUS_LABEL[quote.status]}</Chip>
          </span>
        }
        subtitle={t('staffLc.census.subtitle', { client: quote.clientName, number: quote.dealNumber })}
        actions={
          <>
            <Button variant="secondary" onClick={() => navigate(`/staff/deals/${quote.dealId}`)}>
              {t('staffLc.census.toDeal')}
            </Button>
            {editable && (
              <>
                <Button variant="secondary" loading={save.isPending && !action.isPending} onClick={() => void doSave(false)}>
                  {t('common.save')}
                </Button>
                <Button loading={action.isPending} onClick={() => void doSave(true)}>
                  {problem ? t('staffLc.quote.submitForApproval') : t('staffLc.quote.approve')}
                </Button>
              </>
            )}
            {quote.canApprove && (
              <>
                <Button variant="secondary" onClick={() => setDialog('reject')}>
                  {t('common.reject')}
                </Button>
                <Button onClick={() => setDialog('approve')}>{t('staffLc.quote.agree')}</Button>
              </>
            )}
          </>
        }
      />
      {quote.status === 'rejected' && quote.rejectReason && <p className="mb-3 rounded-card bg-danger-soft px-3 py-2 text-[13px] text-danger-text">{t('staffLc.quote.rejectedReason', { reason: quote.rejectReason })}</p>}
      {problem && (quote.status === 'draft' || quote.status === 'rejected' || quote.status === 'pending_approval') && (
        <p role="status" className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text" data-testid="quote-authority">
          {t('staffLc.quote.authorityProblem', { problem: tm(problem) })}
        </p>
      )}
      {!quote.census && <p className="mb-3 rounded-card bg-warning-soft px-3 py-2 text-[13px] text-warning-text">{t('staffLc.quote.censusFirst')}</p>}
      <StickySectionsCtx.Provider value>
        <div className="flex min-w-0 flex-col gap-4">
          <Card title={t('common.rate')}>
            <div className="mb-3 max-w-xs">
              <Field label={t('common.program')}>
                {(a) => (
                  <Select {...a} disabled={!editable} value={program} onChange={(e) => setProgram(e.target.value as ProgramCode)}>
                    {PROGRAMS.map((p) => (
                      <option key={p} value={p}>
                        {PROGRAM_LABEL[p]}
                      </option>
                    ))}
                  </Select>
                )}
              </Field>
            </div>
            <TableScroll>
              <table className="w-full text-[13px]" data-testid="quote-rates">
                <caption className="sr-only">{t('staffLc.quote.ageBands')}</caption>
                <thead>
                  <tr className="text-left text-[12px] text-muted">
                    <th className="py-2 pr-3 font-medium">{t('staffLc.reserves.colGroup')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('staffLc.quote.people')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('staffLc.quote.baseRate')}</th>
                    <th className="py-2 pr-3 text-right font-medium">{t('staffLc.quote.coefficient')}</th>
                    <th className="py-2 text-right font-medium">{t('common.premium')}</th>
                  </tr>
                </thead>
                <tbody>
                  {shown.rates.map((r) => (
                    <tr key={r.band} className="border-b border-border-soft">
                      <td className="py-1.5 pr-3">{AGE_BAND_LABEL[r.band]}</td>
                      <td className="num py-1.5 pr-3 text-right">{formatNumber(r.count)}</td>
                      <td className="num py-1.5 pr-3 text-right">{formatMoney(r.baseRate)}</td>
                      <td className="num py-1.5 pr-3 text-right">{String(r.coefficient).replace('.', ',')}</td>
                      <td className="num py-1.5 text-right">{formatMoney(r.premium)}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </TableScroll>
            <p className="mt-2 text-[12px] text-muted">
              {t('staffLc.quote.ratesNote', { discount: shown.groupDiscountPct ? formatPercent(shown.groupDiscountPct) : t('staffLc.quote.noDiscount'), from: params.groupDiscountFrom })}
            </p>
          </Card>
          <Card
            title={t('staffLc.quote.adjustments')}
            actions={
              editable && (
                <Button size="sm" variant="secondary" disabled={rows.length >= 10} onClick={() => setRows((r) => [...r, { label: '', pct: '', comment: '' }])}>
                  <Plus className="h-3.5 w-3.5" aria-hidden /> {t('common.add')}
                </Button>
              )
            }
          >
            {rows.length === 0 && <p className="text-[13px] text-muted">{t('staffLc.quote.noAdjustments')}</p>}
            <div className="flex flex-col gap-3">
              {rows.map((r, i) => (
                <div key={i} className="grid gap-2 rounded-btn border border-border-soft p-2 sm:grid-cols-[1fr_110px_2fr_auto]" data-testid="quote-adjustment">
                  <Field label={t('common.name')} error={err(`adjustments.${i}.label`)}>
                    {(a) => <Input {...a} disabled={!editable} maxLength={80} value={r.label} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, label: e.target.value } : y)))} />}
                  </Field>
                  <Field label="%" error={err(`adjustments.${i}.pct`)}>
                    {(a) => <Input {...a} disabled={!editable} inputMode="decimal" maxLength={7} value={r.pct} placeholder="-10" onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, pct: e.target.value } : y)))} />}
                  </Field>
                  <Field label={t('common.comment')} error={err(`adjustments.${i}.comment`)}>
                    {(a) => <Input {...a} disabled={!editable} maxLength={300} value={r.comment} onChange={(e) => setRows((x) => x.map((y, j) => (j === i ? { ...y, comment: e.target.value } : y)))} />}
                  </Field>
                  {editable && (
                    <Button size="sm" variant="ghost" className="self-end" aria-label={t('staffLc.quote.deleteRow')} onClick={() => setRows((x) => x.filter((_, j) => j !== i))}>
                      <Trash2 className="h-4 w-4" aria-hidden />
                    </Button>
                  )}
                </div>
              ))}
            </div>
          </Card>
        </div>
      </StickySectionsCtx.Provider>
      <SideColumn label={t('staffLc.quote.result')} testId="quote-result-column">
        <Card title={t('staffLc.quote.result')}>
          <dl className="text-[13px]" data-testid="quote-total">
            <Kv label={t('staffLc.quote.perEmployee')}>
              <span className="num">{formatMoney(shown.premiumEmployee)}</span>
            </Kv>
            <Kv label={t('staffLc.quote.perFamily')}>
              <span className="num">{formatMoney(shown.premiumFamily)}</span>
            </Kv>
            <Kv label={t('staffLc.quote.discountFromTariff')}>
              <span className="num">{formatPercent(shown.discountFromTariffPct, 1)}</span>
            </Kv>
            <div className="mt-1 flex justify-between border-t border-border-soft pt-2 text-[15px] font-bold">
              <dt>{t('staffLc.quote.premiumPerYear')}</dt>
              <dd className="num">{formatMoney(shown.total)}</dd>
            </div>
          </dl>
          {authority && (
            <p className="mt-3 text-[12px] text-muted">
              {authority.quotePremiumMax !== undefined
                ? t('staffLc.quote.authorityBoth', { discount: formatPercent(authority.quoteDiscountMaxPct ?? 0), premium: formatMoney(authority.quotePremiumMax) })
                : t('staffLc.quote.authorityDiscount', { discount: formatPercent(authority.quoteDiscountMaxPct ?? 0) })}
            </p>
          )}
        </Card>
        <Card title={t('staffLc.pricing.basis')}>
          <Field label={t('staffLc.pricing.basis')} hint={t('staffLc.pricing.quoteHint')}>
            {(a) => (
              <Select {...a} disabled={!editable} value={pricingBasis} onChange={(e) => setPricingBasis(e.target.value as PricingBasis)} data-testid="quote-pricing-basis">
                {PRICING_BASES.map((b) => (
                  <option key={b} value={b}>
                    {PRICING_BASIS_LABEL[b]}
                  </option>
                ))}
              </Select>
            )}
          </Field>
          {pricingBasis === 'age_banded' && shown.ageBandRates.length > 0 && (
            <div className="mt-3">
              <p className="mb-1 text-[12px] text-muted">{t('staffLc.pricing.tableTitle')}</p>
              <AgeBandTable rates={shown.ageBandRates} />
            </div>
          )}
        </Card>
        {quote.approvals.length > 0 && (
          <Card title={t('staffLc.quote.approvals')}>
            <ul className="text-[13px]">
              {quote.approvals.map((a) => (
                <li key={a.at} className="py-1">
                  {a.byName} · <span className="num text-muted">{formatDateTime(a.at)}</span>
                  {a.comment && <p className="text-muted">{a.comment}</p>}
                </li>
              ))}
            </ul>
          </Card>
        )}
      </SideColumn>
      <ReasonDialog
        open={dialog === 'approve'}
        onClose={() => setDialog(null)}
        title={t('staffLc.quote.approveTitle')}
        description={t('staffLc.quote.approveDesc')}
        label={t('staffLc.quote.commentOptional')}
        field="comment"
        optional
        schema={quoteApproveSchema}
        confirmLabel={t('staffLc.quote.agree')}
        onSubmit={(comment) => action.mutateAsync({ id: quote.id, action: 'approve', comment: comment || undefined })}
      />
      <ReasonDialog
        open={dialog === 'reject'}
        onClose={() => setDialog(null)}
        title={t('staffLc.quote.rejectTitle')}
        description={t('staffLc.quote.rejectDesc')}
        label={t('common.reason')}
        field="reason"
        schema={quoteRejectSchema}
        confirmLabel={t('common.reject')}
        danger
        onSubmit={(reason) => action.mutateAsync({ id: quote.id, action: 'reject', reason })}
      />
    </>
  );
}

export default function QuotePage() {
  const { quoteId = '' } = useParams();
  const q = useQuote(quoteId);
  useDocumentTitle(t('staffLc.deal.quote'));
  useTopbar([{ label: t('staffLc.deals.title'), to: '/staff/deals' }, ...(q.data ? [{ label: q.data.dealNumber, to: `/staff/deals/${q.data.dealId}` }] : []), { label: t('staffLc.deal.quote') }]);
  return <QueryState query={q}>{(quote) => <Calculator quote={quote} />}</QueryState>;
}
