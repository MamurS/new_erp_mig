/* Search among the assistance's own insured persons (§3): name, policy number or phone. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssistInsuredItem } from '@mig/contracts/dto';
import { useAssistInsured } from '@/shared/api/queries/assist';
import { useDebounced, useDocumentTitle } from '@/shared/lib/hooks';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { SearchInput } from '@/shared/ui/search-input';
import { StatusDot } from '@/shared/ui/chips';
import { useTopbar } from '@/features/staff/topbar';
import { t } from '@/i18n';

export default function InsuredSearchPage() {
  useDocumentTitle(t('assist.insured.title'));
  useTopbar([{ label: t('assist.insured.title') }]);
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const q = useAssistInsured(useDebounced(term.trim(), 300));
  const columns: Column<AssistInsuredItem>[] = [
    { key: 'name', header: t('common.fullName'), cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: 'client', header: t('assist.insured.company'), cell: (i) => i.clientName },
    { key: 'policy', header: t('common.policy'), cell: (i) => <span className="num">{i.policyNumber}</span> },
    { key: 'program', header: t('common.program'), cell: (i) => i.programName },
    { key: 'phone', header: t('common.phone'), cell: (i) => <span className="num">{i.phoneMasked}</span> },
    { key: 'status', header: t('common.status'), cell: (i) => <StatusDot tone={i.status === 'active' ? 'success' : 'muted'}>{i.status === 'active' ? t('assist.insured.active') : t('assist.insured.excluded')}</StatusDot> },
  ];
  return (
    <>
      <PageHeader title={t('assist.insured.title')} subtitle={t('assist.insured.subtitle')} />
      <div className="mb-3 max-w-md">
        <SearchInput value={term} onChange={setTerm} placeholder={t('assist.insured.searchPlaceholder')} aria-label={t('assist.insured.searchAria')} />
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption={t('assist.insured.caption')}
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
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
