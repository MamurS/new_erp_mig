/* Search among the assistance's own insured persons (§3): name, policy number or phone. */
import { useState } from 'react';
import { useNavigate } from 'react-router-dom';
import type { AssistInsuredItem } from '@/shared/types/dto';
import { useAssistInsured } from '@/shared/api/queries/assist';
import { useDebounced, useDocumentTitle } from '@/shared/lib/hooks';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { SearchInput } from '@/shared/ui/search-input';
import { StatusDot } from '@/shared/ui/chips';
import { useTopbar } from '@/features/staff/topbar';

export default function InsuredSearchPage() {
  useDocumentTitle('Застрахованные');
  useTopbar([{ label: 'Застрахованные' }]);
  const navigate = useNavigate();
  const [term, setTerm] = useState('');
  const q = useAssistInsured(useDebounced(term.trim(), 300));
  const columns: Column<AssistInsuredItem>[] = [
    { key: 'name', header: 'ФИО', cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: 'client', header: 'Компания', cell: (i) => i.clientName },
    { key: 'policy', header: 'Полис', cell: (i) => <span className="num">{i.policyNumber}</span> },
    { key: 'program', header: 'Программа', cell: (i) => i.programName },
    { key: 'phone', header: 'Телефон', cell: (i) => <span className="num">{i.phoneMasked}</span> },
    { key: 'status', header: 'Статус', cell: (i) => <StatusDot tone={i.status === 'active' ? 'success' : 'muted'}>{i.status === 'active' ? 'Застрахован' : 'Исключён'}</StatusDot> },
  ];
  return (
    <>
      <PageHeader title="Застрахованные" subtitle="Только клиенты, закреплённые за вашим ассистансом. ПИНФЛ скрыт, показать можно по причине" />
      <div className="mb-3 max-w-md">
        <SearchInput value={term} onChange={setTerm} placeholder="ФИО, номер полиса или телефон" aria-label="Поиск застрахованного" />
      </div>
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Застрахованные ассистанса"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(i) => i.id}
          onRowClick={(i) => navigate(`/assist/insured/${i.id}`)}
          onRowOpen={(i) => navigate(`/assist/insured/${i.id}`)}
          empty="Никого не нашли среди ваших застрахованных"
        />
      </div>
    </>
  );
}
