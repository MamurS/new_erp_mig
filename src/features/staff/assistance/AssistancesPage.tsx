/* Assistance companies for MIG (ASSISTANCE_SPEC §7): insured, KPI, rebills to review, SLA breaches. */
import { useNavigate } from 'react-router-dom';
import type { AssistanceListItem } from '@/shared/types/dto';
import { useAssistances } from '@/shared/api/queries/assist';
import { INTEGRATION_MODE_LABEL } from '@/shared/domain/clinics';
import { formatNumber, formatPercent } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { PageHeader } from '@/shared/ui/page';
import { useTopbar } from '../topbar';

export default function AssistancesPage() {
  useDocumentTitle('Ассистансы');
  useTopbar([{ label: 'Ассистансы' }]);
  const navigate = useNavigate();
  const q = useAssistances();
  const columns: Column<AssistanceListItem>[] = [
    { key: 'name', header: 'Ассистанс', cell: (a) => <span className="font-medium">{a.name}</span> },
    { key: 'mode', header: 'Подключение', cell: (a) => INTEGRATION_MODE_LABEL[a.integrationMode] },
    { key: 'clients', header: 'Клиентов', align: 'right', cell: (a) => <span className="num">{a.clientsCount}</span> },
    { key: 'insured', header: 'Застрахованных', align: 'right', cell: (a) => <span className="num">{formatNumber(a.insuredCount)}</span> },
    { key: 'gp', header: 'ГП в срок', align: 'right', cell: (a) => <span className="num">{formatPercent(a.kpi.guaranteesOnTimeShare)}</span> },
    { key: 'qa', header: 'Согласие КК', align: 'right', cell: (a) => <span className={a.kpi.qaAgreementShare < 0.9 ? 'num text-warning-text' : 'num'}>{formatPercent(a.kpi.qaAgreementShare)}</span> },
    { key: 'loss', header: 'Убыточность', align: 'right', cell: (a) => <span className="num">{a.kpi.lossRatio === null ? '—' : formatPercent(a.kpi.lossRatio)}</span> },
    { key: 'rebills', header: 'Счета к проверке', align: 'right', cell: (a) => (a.rebillsToReview ? <Chip kind="warning">{a.rebillsToReview}</Chip> : <span className="text-muted">0</span>) },
    { key: 'sla', header: 'Нарушения SLA', align: 'right', cell: (a) => (a.slaBreaches ? <Chip kind="danger">{a.slaBreaches}</Chip> : <span className="text-muted">0</span>) },
  ];
  return (
    <>
      <PageHeader title="Ассистанс-компании" subtitle="Каждый ассистанс обслуживает своих клиентов. МИГ контролирует: эскалации, выборочный контроль качества, проверку и оплату счетов" />
      <div className="rounded-card border border-border bg-surface">
        <DataTable
          caption="Ассистансы"
          columns={columns}
          rows={q.data}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          rowKey={(a) => a.id}
          onRowClick={(a) => navigate(`/staff/assistance/${a.id}`)}
          onRowOpen={(a) => navigate(`/staff/assistance/${a.id}`)}
        />
      </div>
    </>
  );
}
