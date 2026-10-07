import { t } from '@/i18n';
import { useState } from 'react';
import { Link, useNavigate } from 'react-router-dom';
import { Flag } from 'lucide-react';
import type { Claim, ClaimCategory, ClaimStatus } from '@/shared/types';
import { useClaim, useClaims } from '@/shared/api/queries/staff';
import { useCan } from '@/shared/auth/guards';
import { FLAG_LABEL } from '@/shared/domain/settlement';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { formatDate, formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDebounced, useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { FilterChip } from '@/shared/ui/filter-chip';
import { Tooltip } from '@/shared/ui/tooltip';
import { SearchInput } from '@/shared/ui/search-input';
import { EmptyState, ErrorState, SkeletonRows } from '@/shared/ui/states';
import { DetailPanel, useDetailPanelParam } from '@/shared/ui/detail-panel';
import { Kv } from '@/shared/ui/page';
import { useUser } from '@/shared/auth/session';
import { INSURED_CARD_ROLES } from '../nav';
import { ExportButton } from '../components/ExportButton';
import { CLAIM_TONE } from '../components/tones';
import { useTopbar } from '../topbar';
import { SlaCell } from '../components/cells';
import { NewClaimDialog } from '../components/NewClaimDialog';
import { useCreateIntent } from '@/shared/lib/createIntent';

const SOURCE_LABEL = {
  get app() {
    return t('staff.claimCard.source.app');
  },
  get clinic_invoice() {
    return t('staff.claimCard.source.clinicInvoice');
  },
  get operator() {
    return t('staff.claimCard.source.operator');
  },
  get assistance() {
    return t('staff.claims.source.assistance');
  },
};

const CLAIM_TABS = [
  { key: '', label: 'common.all' },
  { key: 'new', label: 'staff.claims.tab.new' },
  { key: 'review', label: 'staff.claims.tab.review' },
  { key: 'opinion', label: 'staff.claims.tab.opinion' },
  { key: 'above', label: 'staff.claims.tab.above' },
  { key: 'appeals', label: 'staff.claims.tab.appeals' },
] as const;

export default function ClaimsPage() {
  useDocumentTitle(t('staff.claims.title'));
  useTopbar([{ label: t('staff.claims.title') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(['status', 'category', 'overdue', 'sort', 'page', 'tab', 'flagged'] as const);
  const settles = useCan('claims.decide');
  const reserves = useCan('claims.reserves') || settles;
  const [search, setSearch] = useState('');
  // Split view: the selected claim's card next to the list (?panel=id; see useDetailPanelParam).
  const panel = useDetailPanelParam();
  // «+ Создать → Убыток» of the claims officer: the claim form with the insured person found in the form.
  const [creating, setCreating] = useState(false);
  useCreateIntent('claim', useCan('claims.create'), setCreating, true);
  const q = useDebounced(search.trim());
  const page = Number(f.page) || 1;
  const sort = parseSort(f.sort || 'createdAt:desc');
  const list = useClaims({ status: f.status, category: f.category, overdue: f.overdue, tab: f.tab, flagged: f.flagged, sort: formatSort(sort), page, pageSize: 25, q });
  const statusSel = f.status === 'active' ? ['new', 'review', 'medical_review'] : f.status ? f.status.split(',') : [];

  const cols: Column<Claim>[] = [
    { key: 'number', header: t('common.number'), sortKey: 'number', cell: (c) => <span className="num font-medium">{c.number}</span> },
    { key: 'insured', header: t('common.insured'), sortKey: 'insuredName', cell: (c) => c.insuredName },
    { key: 'client', header: t('common.client'), sortKey: 'clientName', cell: (c) => <span className="text-muted">{c.clientName}</span> },
    { key: 'category', header: t('common.category'), sortKey: 'category', cell: (c) => CLAIM_CATEGORY_LABEL[c.category] },
    ...(settles ? [{ key: 'source', header: t('common.source'), cell: (c: Claim) => <span className="text-muted">{SOURCE_LABEL[c.source]}</span> }] : []),
    { key: 'amount', header: t('common.amount'), sortKey: 'amountClaimed', align: 'right', cell: (c) => <span className="num">{formatMoney(c.amountApproved ?? c.amountClaimed)}</span> },
    ...(reserves ? [{ key: 'reserve', header: t('staff.claims.colReserve'), sortKey: 'reserve', align: 'right' as const, cell: (c: Claim) => <span className="num">{c.reserve ? formatMoney(c.reserve) : '—'}</span> }] : []),
    { key: 'status', header: t('common.status'), sortKey: 'status', cell: (c) => <StatusDot tone={CLAIM_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</StatusDot> },
    {
      key: 'flags',
      header: t('staff.claims.colFlags'),
      cell: (c) => {
        const open = (c.flags ?? []).filter((x) => !x.dismissed);
        return open.length ? (
          <Tooltip content={open.map((x) => FLAG_LABEL[x.code]).join(', ')}>
            <span className="inline-flex items-center gap-1 text-warning-text" data-testid="claim-flag">
              <Flag className="h-3.5 w-3.5" aria-hidden />
              <span className="sr-only">{t('staff.claims.flagsSr')}</span> {open.length}
            </span>
          </Tooltip>
        ) : null;
      },
    },
    { key: 'sla', header: 'SLA', sortKey: 'slaDueAt', cell: (c) => <SlaCell claim={c} /> },
  ];

  return (
    <div>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <h1 className="text-[22px] font-bold">{t('staff.claims.title')}</h1>
        <SearchInput value={search} onChange={setSearch} placeholder={t('staff.claims.searchPlaceholder')} slashFocus className="w-80" />
      </div>
      {settles && (
        <div className="mb-3 flex flex-wrap gap-1 border-b border-border" role="tablist" aria-label={t('staff.claims.queues')}>
          {CLAIM_TABS.map((ct) => (
            <button
              key={ct.key}
              type="button"
              role="tab"
              aria-selected={(f.tab ?? '') === ct.key}
              className={cn('-mb-px border-b-2 px-3 py-1.5 text-[13px]', (f.tab ?? '') === ct.key ? 'border-accent font-semibold text-accent-text' : 'border-transparent text-muted hover:text-text')}
              onClick={() => setF({ tab: ct.key || null, page: null })}
            >
              {t(ct.label)}
            </button>
          ))}
          <Link to="/staff/rebills" className="px-3 py-1.5 text-[13px] text-muted hover:text-text">
            {t('staff.claims.rebillLines')}
          </Link>
        </div>
      )}
      <div className="mb-3 flex flex-wrap items-center gap-2">
        <FilterChip
          label={t('common.status')}
          options={(Object.keys(CLAIM_STATUS_LABEL) as ClaimStatus[]).map((s) => ({ value: s, label: CLAIM_STATUS_LABEL[s] }))}
          selected={statusSel}
          onChange={(v) => setF({ status: v.join(',') })}
        />
        <FilterChip
          label={t('common.category')}
          options={(Object.keys(CLAIM_CATEGORY_LABEL) as ClaimCategory[]).map((s) => ({ value: s, label: CLAIM_CATEGORY_LABEL[s] }))}
          selected={f.category ? f.category.split(',') : []}
          onChange={(v) => setF({ category: v.join(',') })}
        />
        <label className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-btn border px-2 text-[12px]', f.overdue ? 'border-danger/40 bg-danger-soft text-danger-text' : 'border-dashed border-border text-muted')}>
          <input type="checkbox" checked={f.overdue === '1'} onChange={(e) => setF({ overdue: e.target.checked ? '1' : null })} />
          {t('staff.claims.slaOverdue')}
        </label>
        <label className={cn('inline-flex h-7 cursor-pointer items-center gap-1.5 rounded-btn border px-2 text-[12px]', f.flagged ? 'border-warning/40 bg-warning-soft text-warning-text' : 'border-dashed border-border text-muted')}>
          <input type="checkbox" checked={f.flagged === '1'} onChange={(e) => setF({ flagged: e.target.checked ? '1' : null })} />
          {t('staff.claims.withFlags')}
        </label>
        <div className="ml-auto">
          <ExportButton type="claims_financial" label={t('staff.claims.exportFinance')} />
        </div>
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('staff.claims.title')}
          columns={cols}
          rows={list.data?.items}
          rowKey={(c) => c.id}
          loading={list.isLoading}
          error={list.error}
          onRetry={() => void list.refetch()}
          sort={sort}
          onSortChange={(s) => setF({ sort: formatSort(s) })}
          onRowClick={(c) => panel.open(c.id)}
          onRowMove={(c) => panel.id && panel.open(c.id)}
          onRowOpen={(c) => navigate(`/staff/claims/${c.id}`)}
          activeKey={panel.id}
          page={page}
          pageSize={25}
          total={list.data?.total}
          onPageChange={(p) => setF({ page: p }, false)}
          empty={
            <EmptyState
              title={t('staff.claims.notFound')}
              description={t('staff.clients.notFoundHint')}
              action={<Button variant="secondary" onClick={() => { setSearch(''); setF({ status: '', category: '', overdue: null }); }}>{t('staff.clients.resetFilters')}</Button>}
            />
          }
        />
      </div>
      {panel.id && <ClaimPanel id={panel.id} showReserve={reserves} onClose={panel.close} onOpen={() => navigate(`/staff/claims/${panel.id}`)} />}
      <NewClaimDialog open={creating} onOpenChange={setCreating} />
    </div>
  );
}

/** The claim card of the split view: key facts of the full page and its latest status changes. */
function ClaimPanel({ id, showReserve, onClose, onOpen }: { id: string; showReserve: boolean; onClose: () => void; onOpen: () => void }) {
  const q = useClaim(id);
  const user = useUser();
  const navigate = useNavigate();
  const c = q.data;
  const canOpenInsured = !!user && (INSURED_CARD_ROLES as string[]).includes(user.role);
  const title = c?.number ?? t('staff.insuredCard.claim');
  return (
    <DetailPanel
      onClose={onClose}
      label={t('staff.insuredCard.claim')}
      title={<span className="num">{title}</span>}
      titleText={title}
      meta={
        c && (
          <>
            <StatusDot tone={CLAIM_TONE[c.status]}>{CLAIM_STATUS_LABEL[c.status]}</StatusDot>
            <span className="text-muted">{CLAIM_CATEGORY_LABEL[c.category]}</span>
            <span className="text-muted">
              SLA <SlaCell claim={c} />
            </span>
          </>
        )
      }
      footer={
        <>
          <Button onClick={onOpen}>{t('staff.clients.openCard')}</Button>
          {c && canOpenInsured && (
            <Button variant="secondary" onClick={() => navigate(`/staff/insured/${c.insuredId}`)}>
              {t('staff.insuredCard.title')}
            </Button>
          )}
        </>
      }
    >
      {q.isLoading ? (
        <SkeletonRows rows={8} />
      ) : q.isError || !c ? (
        <ErrorState error={q.error} onRetry={() => void q.refetch()} />
      ) : (
        <div className="flex flex-col gap-4">
          <dl className="divide-y divide-border-soft">
            <Kv label={t('common.insured')}>{c.insuredName}</Kv>
            <Kv label={t('common.client')}>{c.clientName}</Kv>
            <Kv label={t('staff.claimCard.where')}>{c.providerName}</Kv>
            <Kv label={t('staff.insuredCard.serviceDate')}>{formatDate(c.serviceDate)}</Kv>
            <Kv label={t('staff.claimCard.claimed')}>
              <span className="num">{formatMoney(c.amountClaimed)}</span>
            </Kv>
            {c.amountApproved !== undefined && (
              <Kv label={t('staff.claimCard.approved')}>
                <span className="num font-semibold">{formatMoney(c.amountApproved)}</span>
              </Kv>
            )}
            {showReserve && (
              <Kv label={t('staff.claims.colReserve')}>
                <span className="num">{c.reserve ? formatMoney(c.reserve) : '—'}</span>
              </Kv>
            )}
            <Kv label={t('staff.claimCard.created')}>{formatDateTime(c.createdAt)}</Kv>
          </dl>
          <section>
            <h3 className="mb-1 text-[14px] font-bold">{t('staff.clientCard.tab.history')}</h3>
            <ol className="flex flex-col gap-2 border-l border-border pl-3">
              {[...c.history]
                .reverse()
                .slice(0, 5)
                .map((h, i) => (
                  <li key={i}>
                    <div>
                      {h.from ? `${CLAIM_STATUS_LABEL[h.from]} → ` : ''}
                      {CLAIM_STATUS_LABEL[h.to]}
                    </div>
                    <div className="text-[12px] text-muted">
                      {formatDateTime(h.at)} · {h.actorName}
                    </div>
                  </li>
                ))}
            </ol>
          </section>
        </div>
      )}
    </DetailPanel>
  );
}
