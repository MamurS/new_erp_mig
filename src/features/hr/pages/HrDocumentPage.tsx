/* Кабинет HR: a contract or an endorsement — preview of all pages and signing on the client's side. */
import { useEffect, useMemo, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft } from 'lucide-react';
import type { ContractView, EndorsementView } from '@/shared/types/dto';
import { useContract, useEndorsement, useUploadInsuredList } from '@/shared/api/queries/lifecycle';
import { errorMessage } from '@/shared/api/client';
import { CONTRACT_STATUS_LABEL, ENDORSEMENT_STATUS_LABEL } from '@/shared/domain/contracts';
import { POLICY_CSV_HEADER } from '@/shared/domain/policies';
import { formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { contractDocument, endorsementDocument } from '@/features/documents/builders';
import { DocPreview, DocPrintButton, useStubDocument } from '@/features/documents/DocPreview';
import { SigningPanel } from '@/features/documents/SigningPanel';
import { CsvFileButton } from '@/features/staff/lifecycle/common';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HrCard, HrHeader, HrSectionTitle } from '../ui';

function Back() {
  return (
    <Link to="/hr/contracts" className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent-text hover:underline">
      <ArrowLeft className="h-4 w-4" aria-hidden /> Договор и изменения
    </Link>
  );
}

function ContractBody({ c }: { c: ContractView }) {
  const input = useMemo(() => contractDocument(c), [c]);
  const doc = useStubDocument(input);
  const upload = useUploadInsuredList();
  const canUpload = c.status === 'sent' || c.status === 'signing';
  return (
    <>
      <HrHeader title={`Договор ${c.number}`} subtitle={`${CONTRACT_STATUS_LABEL[c.status]} · общая премия ${formatMoney(c.params.total)}`} actions={<DocPrintButton input={() => contractDocument(c)} />} />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {doc && <DocPreview doc={doc} label="Договор" />}
        <div className="flex flex-col gap-5">
          {['sent', 'signing', 'signed', 'active'].includes(c.status) && <SigningPanel kind="contracts" doc={c} mode="hr" printInput={() => contractDocument(c)} />}
          {canUpload && (
            <HrCard>
              <HrSectionTitle className="mb-1">Приложение 2 — список застрахованных</HrSectionTitle>
              <p className="mb-3 text-[14px] text-muted">
                {c.insuredCount ? `Загружено: ${c.insuredCount}.` : 'Список ещё не загружен.'} Формат как при импорте сотрудников: <code>{POLICY_CSV_HEADER.join(', ')}</code>.
              </p>
              <CsvFileButton
                label={c.insuredCount ? 'Заменить список' : 'Загрузить список'}
                ariaLabel="Файл списка застрахованных"
                busy={upload.isPending}
                maxBytes={5 * 1024 * 1024}
                onText={(csv) =>
                  void upload
                    .mutateAsync({ id: c.id, csv })
                    .then(() => toast.success('Список загружен'))
                    .catch((e: unknown) => toast.error(errorMessage(e)))
                }
              />
            </HrCard>
          )}
        </div>
      </div>
    </>
  );
}

function EndorsementBody({ e }: { e: EndorsementView }) {
  const input = useMemo(() => endorsementDocument(e), [e]);
  const doc = useStubDocument(input);
  return (
    <>
      <HrHeader
        title={e.number}
        subtitle={`${ENDORSEMENT_STATUS_LABEL[e.status]} · ${e.total < 0 ? `возврат ${formatMoney(-e.total)}` : `доплата ${formatMoney(e.total)}`}`}
        actions={<DocPrintButton input={() => endorsementDocument(e)} />}
      />
      <div className="grid gap-5 xl:grid-cols-[minmax(0,1fr)_420px]">
        {doc && <DocPreview doc={doc} label="Доп. соглашение" />}
        <div className="flex flex-col gap-5">
          <HrCard>
            <HrSectionTitle className="mb-2">Расчёт</HrSectionTitle>
            <ul className="divide-y divide-border text-[14px]">
              {e.lines.map((l) => (
                <li key={l.changeRequestId} className="flex justify-between gap-3 py-2">
                  <span>
                    {l.description}
                    <span className="block text-[12px] text-muted">{l.formula}</span>
                  </span>
                  <span className="num whitespace-nowrap">{formatMoney(l.amount)}</span>
                </li>
              ))}
            </ul>
          </HrCard>
          <SigningPanel kind="endorsements" doc={e} mode="hr" printInput={() => endorsementDocument(e)} />
        </div>
      </div>
    </>
  );
}

export function HrContractPage() {
  const { contractId = '' } = useParams();
  const [poll, setPoll] = useState(false);
  const q = useContract(contractId, { poll });
  useEffect(() => setPoll(!!q.data?.signing.edoPending), [q.data?.signing.edoPending]);
  useDocumentTitle('Договор');
  return (
    <>
      <Back />
      {q.isLoading ? <SkeletonRows rows={8} /> : q.data ? <ContractBody c={q.data} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    </>
  );
}

export function HrEndorsementPage() {
  const { endorsementId = '' } = useParams();
  const q = useEndorsement(endorsementId);
  useDocumentTitle('Доп. соглашение');
  return (
    <>
      <Back />
      {q.isLoading ? <SkeletonRows rows={8} /> : q.data ? <EndorsementBody e={q.data} /> : <ErrorState error={q.error} onRetry={() => void q.refetch()} />}
    </>
  );
}

export default HrContractPage;
