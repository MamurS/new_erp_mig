/* Call-centre cases (§5.1): list with SLA, filters by status and type; a former client's cases are read-only. */
import { Link, useNavigate } from 'react-router-dom';
import type { AssistCaseView } from '@mig/contracts/dto';
import { useAssistCases } from '@/shared/api/queries/assist';
import { CASE_CHANNEL_LABEL, CASE_STATUS_LABEL, CASE_TYPE_LABEL } from '@mig/domain/assistance';
import { formatDateTime } from '@mig/domain/lib/format';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, formatSort, parseSort, type Column } from '@/shared/ui/data-table';
import { FilterChip } from '@/shared/ui/filter-chip';
import { PageHeader } from '@/shared/ui/page';
import { Button } from '@/shared/ui/button';
import { EmptyState } from '@/shared/ui/states';
import { useCan } from '@/shared/auth/guards';
import { roleName } from '@/features/next/NextActions';
import { EmptyHelp } from '@/features/clinic/emptyNext';
import { useTopbar } from '@/features/staff/topbar';
import { CaseStatus, SlaBadge } from '../components';
import { t } from '@/i18n';

const KEYS = ['status', 'type', 'sort'] as const;

export default function CasesPage() {
  useDocumentTitle(t('assist.cases.title'));
  useTopbar([{ label: t('assist.cases.title') }]);
  const navigate = useNavigate();
  const [f, setF] = useUrlFilters(KEYS);
  const sort = parseSort(f.sort);
  const filtered = !!(f.status || f.type);
  const canFind = useCan('assist.insured.search');
  const q = useAssistCases({ ...(f.status ? { status: f.status } : {}), ...(f.type ? { type: f.type } : {}), ...(f.sort ? { sort: f.sort } : {}) });
  const columns: Column<AssistCaseView>[] = [
    { key: 'number', header: t('common.number'), sortKey: 'number', cell: (c) => <span className="num font-medium">{c.number}</span> },
    { key: 'type', header: t('common.type'), cell: (c) => (c.type === 'complaint' || c.type === 'emergency' ? <Chip kind="danger">{CASE_TYPE_LABEL[c.type]}</Chip> : CASE_TYPE_LABEL[c.type]) },
    { key: 'who', header: t('common.insured'), cell: (c) => c.insuredName },
    { key: 'text', header: t('assist.cases.essence'), cell: (c) => <span className="line-clamp-1 text-muted">{c.description}</span> },
    { key: 'channel', header: t('assist.cases.channel'), cell: (c) => CASE_CHANNEL_LABEL[c.channel] },
    { key: 'created', header: t('common.created'), sortKey: 'createdAt', cell: (c) => <span className="num whitespace-nowrap">{formatDateTime(c.createdAt)}</span> },
    { key: 'status', header: t('common.status'), cell: (c) => (c.access === 'read' ? <Chip kind="neutral">{t('assist.cases.readOnly')}</Chip> : <CaseStatus status={c.status} />) },
    { key: 'sla', header: 'SLA', cell: (c) => <SlaBadge dueAt={c.slaDueAt} done={c.status === 'resolved' || c.access === 'read'} /> },
  ];
  return (
    <>
      <PageHeader title={t('assist.cases.title')} subtitle={t('assist.cases.subtitle')} />
      <div className="mb-3 flex flex-wrap gap-2">
        <FilterChip
          label={t('common.status')}
          options={Object.entries(CASE_STATUS_LABEL).map(([value, label]) => ({ value, label }))}
          selected={f.status ? f.status.split(',') : []}
          onChange={(v) => setF({ status: v.length ? v.join(',') : null })}
        />
        <FilterChip
          label={t('common.type')}
          options={Object.entries(CASE_TYPE_LABEL).map(([value, label]) => ({ value, label }))}
          selected={f.type ? [f.type] : []}
          onChange={(v) => setF({ type: v[v.length - 1] ?? null })}
        />
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('assist.cases.caption')}
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(c) => c.id}
          sort={sort}
          onSortChange={(s) => setF({ sort: formatSort(s) ?? null })}
          onRowClick={(c) => navigate(`/assist/cases/${c.id}`)}
          onRowOpen={(c) => navigate(`/assist/cases/${c.id}`)}
          empty={
            filtered ? (
              t('assist.cases.empty')
            ) : (
              <EmptyState
                testId="assist-cases-empty"
                title={t('assist.cases.empty')}
                why={t('emptyPartner.assist.cases.why')}
                next={t('emptyPartner.assist.cases.next', { role: roleName('asst_operator') })}
                actions={
                  canFind ? (
                    <Button asChild>
                      <Link to="/assist/insured">{t('emptyPartner.assist.cases.find')}</Link>
                    </Button>
                  ) : undefined
                }
                help={<EmptyHelp article="assistance" section="assistance-daily" />}
              />
            )
          }
        />
      </div>
    </>
  );
}
