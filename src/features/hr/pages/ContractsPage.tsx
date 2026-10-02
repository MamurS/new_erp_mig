/*
 * Кабинет HR: «Договор и изменения» (LIFECYCLE_SPEC §8, §10, §11): documents to sign, the contract,
 * change requests and endorsements with their sums, certificates of the insured (one or all for print).
 */
import { Link } from 'react-router-dom';
import { Download, FileSignature } from 'lucide-react';
import { useCertificates, useChangeRequests, useContracts, useEndorsements } from '@/shared/api/queries/lifecycle';
import { CONTRACT_STATUS_CHIP, CONTRACT_STATUS_LABEL, ENDORSEMENT_STATUS_LABEL } from '@/shared/domain/contracts';
import { CHANGE_TYPE_LABEL } from '@/shared/domain/endorsements';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { certificateDocument } from '@/features/documents/builders';
import { DocPrintButton } from '@/features/documents/DocPreview';
import { Chip } from '@/shared/ui/chips';
import { SkeletonRows } from '@/shared/ui/states';
import { HrCard, HrHeader, HrSectionTitle } from '../ui';

const REQUEST_STATUS = { pending: 'Ждёт доп. соглашения', included: 'В доп. соглашении', cancelled: 'Отменена' } as const;

function Certificates({ policyId }: { policyId: string }) {
  const q = useCertificates(policyId);
  const list = q.data ?? [];
  return (
    <HrCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <HrSectionTitle>Сертификаты застрахованных</HrSectionTitle>
        {list.length > 0 && <DocPrintButton input={() => list.map(certificateDocument)} title="Сертификаты застрахованных" label={`Скачать все (${list.length})`} />}
      </div>
      {q.isLoading ? (
        <SkeletonRows rows={3} />
      ) : list.length ? (
        <ul className="max-h-96 divide-y divide-border overflow-y-auto" data-testid="hr-certificates">
          {list.map((c) => (
            <li key={c.insuredId} className="flex flex-wrap items-center justify-between gap-2 py-2">
              <span>
                <span className="font-medium">{c.fullName}</span>
                <span className="num ml-2 text-[13px] text-muted">{c.certificateNumber}</span>
              </span>
              <DocPrintButton input={() => certificateDocument(c)} label="Скачать" aria-label={`Скачать сертификат ${c.certificateNumber}`} />
            </li>
          ))}
        </ul>
      ) : (
        <p className="text-muted">Сертификаты появятся, когда договор вступит в силу.</p>
      )}
    </HrCard>
  );
}

export default function ContractsPage() {
  useDocumentTitle('Договор и изменения');
  const contracts = useContracts();
  const endorsements = useEndorsements();
  const requests = useChangeRequests();
  const toSign = [
    ...(contracts.data ?? []).filter((c) => (c.status === 'sent' || c.status === 'signing') && !c.signing.client).map((c) => ({ id: c.id, to: `/hr/contracts/${c.id}`, label: `Договор ${c.number}` })),
    ...(endorsements.data ?? []).filter((e) => (e.status === 'sent' || e.status === 'signing') && !e.signing.client).map((e) => ({ id: e.id, to: `/hr/endorsements/${e.id}`, label: `${e.kind === 'termination' ? 'Соглашение о расторжении' : 'Доп. соглашение'} ${e.number}` })),
  ];
  const active = (contracts.data ?? []).find((c) => c.status === 'active' && c.policyId);

  return (
    <>
      <HrHeader title="Договор и изменения" subtitle="Договор ДМС, документы на подпись, изменения состава и сертификаты" />
      <div className="flex flex-col gap-5">
        {toSign.length > 0 && (
          <HrCard tone="accent">
            <HrSectionTitle className="mb-2">Ждут вашей подписи</HrSectionTitle>
            <ul className="flex flex-col gap-2" data-testid="hr-to-sign">
              {toSign.map((d) => (
                <li key={d.id}>
                  <Link to={d.to} className="inline-flex items-center gap-2 font-semibold underline-offset-2 hover:underline">
                    <FileSignature className="h-4 w-4" aria-hidden /> {d.label}
                  </Link>
                </li>
              ))}
            </ul>
          </HrCard>
        )}
        <HrCard>
          <HrSectionTitle className="mb-3">Договоры</HrSectionTitle>
          {contracts.isLoading ? (
            <SkeletonRows rows={2} />
          ) : (contracts.data ?? []).length ? (
            <ul className="divide-y divide-border">
              {(contracts.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link to={`/hr/contracts/${c.id}`} className="font-semibold text-accent-text hover:underline">
                    Договор {c.number}
                  </Link>
                  <span className="flex items-center gap-3 text-[14px]">
                    <span className="num text-muted">
                      {formatDate(c.params.startDate)} — {formatDate(c.params.endDate)}
                    </span>
                    <span className="num">{formatMoney(c.params.total)}</span>
                    <Chip kind={CONTRACT_STATUS_CHIP[c.status]}>{CONTRACT_STATUS_LABEL[c.status]}</Chip>
                  </span>
                </li>
              ))}
            </ul>
          ) : (
            <p className="text-muted">Договоров пока нет.</p>
          )}
        </HrCard>
        <HrCard>
          <HrSectionTitle className="mb-1">Изменения и доп. соглашения</HrSectionTitle>
          <p className="mb-3 text-[14px] text-muted">Включения и исключения сотрудников копятся как заявки и оформляются доп. соглашением с расчётом доплаты или возврата.</p>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 font-semibold">Заявки</p>
              <ul className="divide-y divide-border text-[14px]" data-testid="hr-change-requests">
                {(requests.data ?? []).slice(0, 30).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {r.description ?? CHANGE_TYPE_LABEL[r.type]} <span className="num text-muted">с {formatDate(r.effectiveDate)}</span>
                    </span>
                    <Chip kind={r.status === 'pending' ? 'sun' : r.status === 'included' ? 'success' : 'neutral'}>{r.endorsementNumber ?? REQUEST_STATUS[r.status]}</Chip>
                  </li>
                ))}
                {!requests.isLoading && !(requests.data ?? []).length && <li className="py-2 text-muted">Заявок нет</li>}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold">Доп. соглашения</p>
              <ul className="divide-y divide-border text-[14px]" data-testid="hr-endorsements">
                {(endorsements.data ?? []).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link to={`/hr/endorsements/${e.id}`} className="font-medium text-accent-text hover:underline">
                      {e.number}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="num">{e.total < 0 ? `возврат ${formatMoney(-e.total)}` : `доплата ${formatMoney(e.total)}`}</span>
                      <Chip kind={e.status === 'signed' ? 'success' : 'sun'}>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip>
                    </span>
                  </li>
                ))}
                {!endorsements.isLoading && !(endorsements.data ?? []).length && <li className="py-2 text-muted">Доп. соглашений нет</li>}
              </ul>
            </div>
          </div>
        </HrCard>
        {active?.policyId && <Certificates policyId={active.policyId} />}
        {!active && (
          <p className="flex items-center gap-2 text-[14px] text-muted">
            <Download className="h-4 w-4" aria-hidden /> Сертификаты застрахованных можно будет скачать после вступления договора в силу.
          </p>
        )}
      </div>
    </>
  );
}
