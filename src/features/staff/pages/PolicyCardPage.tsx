import { useState } from 'react';
import { Link, useNavigate, useParams } from 'react-router-dom';
import type { InsuredListItem } from '@/shared/types/dto';
import type { LimitCategory } from '@/shared/types';
import { useClientInsured, usePolicy } from '@/shared/api/queries/staff';
import { useCan } from '@/shared/auth/guards';
import { useUser } from '@/shared/auth/session';
import { LIMIT_CATEGORY_LABEL, POLICY_STATUS_LABEL, PROGRAM_LABEL } from '@/shared/domain/labels';
import { formatDate, formatMoney, formatNumber } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { StatusDot } from '@/shared/ui/chips';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Card, Kv } from '@/shared/ui/page';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { RenewalOfferDialog } from '../components/RenewalOfferDialog';
import { LimitRequestDialog } from '../components/LimitRequestDialog';
import { RenewalCell } from '../components/cells';
import { POLICY_TONE } from '../components/tones';
import { INSURED_CARD_ROLES } from '../nav';
import { useTopbar } from '../topbar';
import { DocumentsList } from '../components/DocumentsList';

export default function PolicyCardPage() {
  const { policyId = '' } = useParams();
  const q = usePolicy(policyId);
  const p = q.data;
  useDocumentTitle('Карточка полиса');
  useTopbar([{ label: 'Полисы', to: '/staff/policies' }, { label: p?.number ?? 'Полис' }]);
  const canWrite = useCan('policies.write');
  const canLimit = useCan('limits.request_change');
  const canInsured = useCan('insured.read');
  const [offer, setOffer] = useState(false);
  const [limit, setLimit] = useState(false);
  if (q.isLoading) return <SkeletonRows rows={10} />;
  if (q.isError || !p) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  return (
    <div className="flex flex-col gap-4">
      <div className="flex flex-wrap items-start justify-between gap-3">
        <div>
          <h1 className="text-[22px] font-bold num">{p.number}</h1>
          <p className="mt-1 flex flex-wrap items-center gap-2 text-muted">
            <Link to={`/staff/clients/${p.clientId}`} className="hover:underline">
              {p.clientName}
            </Link>
            · <StatusDot tone={POLICY_TONE[p.status]}>{POLICY_STATUS_LABEL[p.status]}</StatusDot>
          </p>
        </div>
        <div className="flex flex-wrap gap-2">
          {canLimit && p.status === 'active' && (
            <Button variant="secondary" onClick={() => setLimit(true)}>
              Запросить изменение лимита
            </Button>
          )}
          {canWrite && p.status !== 'cancelled' && <Button onClick={() => setOffer(true)}>Подготовить КП на продление</Button>}
        </div>
      </div>
      <div className="grid gap-4 lg:grid-cols-2">
        <Card title="Условия">
          <dl className="divide-y divide-border-soft">
            <Kv label="Программа">{PROGRAM_LABEL[p.program]}</Kv>
            <Kv label="Начало">{formatDate(p.startDate)}</Kv>
            <Kv label="Окончание">
              {formatDate(p.endDate)} {p.status === 'active' && <>(<RenewalCell date={p.endDate} />)</>}
            </Kv>
            <Kv label="Премия">
              <span className="num">{formatMoney(p.premium)}</span>
            </Kv>
            <Kv label="Застрахованных">{formatNumber(p.insuredCount)}</Kv>
          </dl>
        </Card>
        <Card title={`Лимиты программы «${p.programInfo.name}»`}>
          <dl className="divide-y divide-border-soft">
            {(Object.keys(p.programInfo.limits) as LimitCategory[]).map((c) => (
              <Kv key={c} label={LIMIT_CATEGORY_LABEL[c]}>
                <span className="num">{formatMoney(p.programInfo.limits[c])}</span>
              </Kv>
            ))}
          </dl>
          <p className="mt-2 text-[12px] text-muted">Лимиты указаны на одного застрахованного на период полиса.</p>
        </Card>
      </div>
      {canInsured && <PolicyInsured clientId={p.clientId} />}
      <Card title="Документы" bodyClassName="p-0">
        <DocumentsList docs={p.documents} />
      </Card>
      <RenewalOfferDialog open={offer} onOpenChange={setOffer} policyId={p.id} program={p.program} premium={p.premium} clientName={p.clientName} />
      <LimitRequestDialog open={limit} onOpenChange={setLimit} policyId={p.id} currentLimits={p.programInfo.limits} />
    </div>
  );
}

function PolicyInsured({ clientId }: { clientId: string }) {
  const [page, setPage] = useState(1);
  const list = useClientInsured(clientId, { page, pageSize: 25 });
  const user = useUser();
  const navigate = useNavigate();
  const canOpen = !!user && (INSURED_CARD_ROLES as string[]).includes(user.role);
  const cols: Column<InsuredListItem>[] = [
    { key: 'name', header: 'ФИО', cell: (i) => <span className="font-medium">{i.fullName}</span> },
    { key: 'position', header: 'Должность', cell: (i) => <span className="text-muted">{i.position}</span> },
    { key: 'status', header: 'Статус', cell: (i) => <StatusDot tone={i.status === 'active' ? 'success' : 'muted'}>{i.status === 'active' ? 'Активен' : 'Исключён'}</StatusDot> },
  ];
  return (
    <Card title="Застрахованные" bodyClassName="p-0">
      <DataTable
        caption="Застрахованные по полису"
        columns={cols}
        rows={list.data?.items}
        rowKey={(i) => i.id}
        loading={list.isLoading}
        error={list.error}
        onRetry={() => void list.refetch()}
        onRowClick={canOpen ? (i) => navigate(`/staff/insured/${i.id}`) : undefined}
        page={page}
        pageSize={25}
        total={list.data?.total}
        onPageChange={setPage}
      />
    </Card>
  );
}
