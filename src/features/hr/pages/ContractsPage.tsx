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
import { EmptyState, SkeletonRows } from '@/shared/ui/states';
import { useUser } from '@/shared/auth/session';
import { AskButton, HelpMore, roleName } from '@/features/next/NextActions';
import { HrCard, HrHeader, HrSectionTitle } from '../ui';
import { t, defineLabels } from '@/i18n';

const REQUEST_STATUS = defineLabels('hr.contracts.request', ['pending', 'included', 'cancelled'] as const);

function Certificates({ policyId }: { policyId: string }) {
  const q = useCertificates(policyId);
  const list = q.data ?? [];
  return (
    <HrCard>
      <div className="mb-3 flex flex-wrap items-center justify-between gap-2">
        <HrSectionTitle>{t('hr.contracts.certificates')}</HrSectionTitle>
        {list.length > 0 && <DocPrintButton input={() => list.map(certificateDocument)} title={t('hr.contracts.certificates')} label={t('hr.contracts.downloadAll', { n: list.length })} />}
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
              <DocPrintButton input={() => certificateDocument(c)} label={t('common.download')} aria-label={t('hr.contracts.downloadCert', { number: c.certificateNumber })} />
            </li>
          ))}
        </ul>
      ) : (
        <EmptyState className="px-2 py-4" testId="hr-certs-next" title={t('hr.contracts.certsLater')} why={t('emptyStaff.hrCerts.why')} help={<HelpMore article="signing" section="policy-issue" />} />
      )}
    </HrCard>
  );
}

export default function ContractsPage() {
  useDocumentTitle(t('hr.nav.contracts'));
  const contracts = useContracts();
  const endorsements = useEndorsements();
  const requests = useChangeRequests();
  const companyId = useUser()?.companyId;
  const toSign = [
    ...(contracts.data ?? []).filter((c) => (c.status === 'sent' || c.status === 'signing') && !c.signing.client).map((c) => ({ id: c.id, to: `/hr/contracts/${c.id}`, label: t('hr.contracts.contractN', { number: c.number }) })),
    ...(endorsements.data ?? []).filter((e) => (e.status === 'sent' || e.status === 'signing') && !e.signing.client).map((e) => ({ id: e.id, to: `/hr/endorsements/${e.id}`, label: e.kind === 'termination' ? t('hr.contracts.terminationN', { number: e.number }) : t('hr.contracts.endorsementN', { number: e.number }) })),
  ];
  const active = (contracts.data ?? []).find((c) => c.status === 'active' && c.policyId);

  return (
    <>
      <HrHeader title={t('hr.nav.contracts')} subtitle={t('hr.contracts.subtitle')} />
      <div className="flex flex-col gap-5">
        {toSign.length > 0 && (
          <HrCard tone="accent">
            <HrSectionTitle className="mb-2">{t('hr.contracts.toSign')}</HrSectionTitle>
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
          <HrSectionTitle className="mb-3">{t('hr.contracts.contracts')}</HrSectionTitle>
          {contracts.isLoading ? (
            <SkeletonRows rows={2} />
          ) : (contracts.data ?? []).length ? (
            <ul className="divide-y divide-border">
              {(contracts.data ?? []).map((c) => (
                <li key={c.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
                  <Link to={`/hr/contracts/${c.id}`} className="font-semibold text-accent-text hover:underline">
                    {t('hr.contracts.contractN', { number: c.number })}
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
            <EmptyState
              className="px-2 py-4"
              testId="hr-contracts-next"
              title={t('hr.contracts.noContracts')}
              why={t('emptyStaff.hrContracts.why')}
              next={t('emptyStaff.hrContracts.next', { role: roleName('sales_manager') })}
              actions={companyId ? <AskButton role="sales_manager" action="contract_draft" subjectType="client" subjectId={companyId} /> : null}
              help={<HelpMore article="portal-guides" section="guide-hr" />}
            />
          )}
        </HrCard>
        <HrCard>
          <HrSectionTitle className="mb-1">{t('hr.contracts.changes')}</HrSectionTitle>
          <p className="mb-3 text-[14px] text-muted">{t('hr.contracts.changesText')}</p>
          <div className="grid gap-5 lg:grid-cols-2">
            <div>
              <p className="mb-2 font-semibold">{t('hr.contracts.requests')}</p>
              <ul className="divide-y divide-border text-[14px]" data-testid="hr-change-requests">
                {(requests.data ?? []).slice(0, 30).map((r) => (
                  <li key={r.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <span>
                      {r.description ?? CHANGE_TYPE_LABEL[r.type]} <span className="num text-muted">{t('hr.contracts.fromDate', { date: formatDate(r.effectiveDate) })}</span>
                    </span>
                    <Chip kind={r.status === 'pending' ? 'sun' : r.status === 'included' ? 'success' : 'neutral'}>{r.endorsementNumber ?? REQUEST_STATUS[r.status]}</Chip>
                  </li>
                ))}
                {!requests.isLoading && !(requests.data ?? []).length && (
                  <li className="py-2">
                    <EmptyState className="px-2 py-4" testId="hr-requests-next" title={t('hr.contracts.noRequests')} why={t('emptyStaff.hrRequests.why')} help={<HelpMore article="servicing" section="enrolment" />} />
                  </li>
                )}
              </ul>
            </div>
            <div>
              <p className="mb-2 font-semibold">{t('hr.contracts.endorsements')}</p>
              <ul className="divide-y divide-border text-[14px]" data-testid="hr-endorsements">
                {(endorsements.data ?? []).map((e) => (
                  <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 py-2">
                    <Link to={`/hr/endorsements/${e.id}`} className="font-medium text-accent-text hover:underline">
                      {e.number}
                    </Link>
                    <span className="flex items-center gap-2">
                      <span className="num">{e.total < 0 ? t('hr.contracts.refund', { amount: formatMoney(-e.total) }) : t('hr.contracts.surcharge', { amount: formatMoney(e.total) })}</span>
                      <Chip kind={e.status === 'signed' ? 'success' : 'sun'}>{ENDORSEMENT_STATUS_LABEL[e.status]}</Chip>
                    </span>
                  </li>
                ))}
                {!endorsements.isLoading && !(endorsements.data ?? []).length && (
                  <li className="py-2">
                    <EmptyState className="px-2 py-4" testId="hr-endorsements-next" title={t('hr.contracts.noEndorsements')} why={t('emptyStaff.hrEndorsements.why')} help={<HelpMore article="servicing" />} />
                  </li>
                )}
              </ul>
            </div>
          </div>
        </HrCard>
        {active?.policyId && <Certificates policyId={active.policyId} />}
        {!active && (
          <p className="flex items-center gap-2 text-[14px] text-muted">
            <Download className="h-4 w-4" aria-hidden /> {t('hr.contracts.certsAfter')}
          </p>
        )}
      </div>
    </>
  );
}
