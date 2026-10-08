/* Guarantee letters of the clinic (CLINIC_SPEC §4.4). New requests start from a visit. */
import { useState } from 'react';
import { Link } from 'react-router-dom';
import { Download } from 'lucide-react';
import type { GuaranteeView } from '@/shared/types/dto';
import { useAnswerGuarantee, useClinicGuarantees } from '@/shared/api/queries/clinic';
import { errorMessage, request } from '@/shared/api/client';
import { downloadText } from '@/shared/lib/csv';
import { formatDate, formatDateTime, formatMoney, formatMoneyDoc, todayISO } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { DataTable, type Column } from '@/shared/ui/data-table';
import { Modal } from '@/shared/ui/dialog';
import { Field, Textarea } from '@/shared/ui/input';
import { EmptyState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { buildPdf, downloadPdf, pdfLegalName } from '@/features/hr/pdf';
import { FilesPicker, GuaranteeChip, PageTitle, Panel } from '../components';
import { EmptyHelp } from '../emptyNext';
import { t } from '@/i18n';

/** Who decides the letter (ASSISTANCE_SPEC §7): the patient's assistance, or MIG for escalations and clients without one. */
function decisionOwner(g: { assistanceId?: string | null; assistanceName?: string; escalated?: boolean }): string {
  if (!g.assistanceId) return t('common.mig');
  if (g.escalated) return g.assistanceName ? t('clinic.gp.ownerEscalated', { name: g.assistanceName }) : t('clinic.gp.ownerEscalatedAssist');
  return g.assistanceName ?? t('clinic.gp.ownerAssist');
}

/** Client-side PDF of an approved letter (until the server makes the real one); no patient data in the file or its name. */
function guaranteePdf(g: GuaranteeView): string {
  return buildPdf(
    [
      'MIG DMS - Guarantee letter',
      '',
      `No ${g.number}`,
      `Clinic: ${pdfLegalName(g.clinicName, g.clinicLegalForm)}`,
      `Service: ${g.serviceCode} ${g.serviceName}`,
      `ICD-10: ${g.icd10}`,
      `Approved amount: ${formatMoneyDoc(g.approvedAmount ?? 0)}`,
      `Valid until: ${g.validUntil ? formatDate(g.validUntil) : '-'}`,
      `Approved by: ${g.approvals.map((a) => a.byName).join(', ')}`,
      '',
      'The patient is identified by the visit opened at the clinic.',
      'Demo document generated in the browser.',
    ],
    `Guarantee ${g.number}`,
  );
}

async function downloadAttachment(id: string, fileName: string) {
  try {
    const blob = (await request(`/files/${id}`, { as: 'blob' })) as Blob;
    downloadText(blob, fileName, blob.type);
  } catch (e) {
    toast.error(errorMessage(e));
  }
}

function GuaranteeDialog({ g, onClose }: { g: GuaranteeView; onClose: () => void }) {
  const answer = useAnswerGuarantee();
  const [comment, setComment] = useState('');
  const [files, setFiles] = useState<File[]>([]);
  const [touched, setTouched] = useState(false);
  const send = async () => {
    setTouched(true);
    if (comment.trim().length < 3) return;
    try {
      await answer.mutateAsync({ id: g.id, comment: comment.trim(), files });
      toast.success(t('clinic.gp.docsSent'));
      onClose();
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Modal open onOpenChange={(o) => !o && onClose()} wide title={t('clinic.gp.title', { number: g.number })} description={<GuaranteeChip status={g.status} />}>
      <dl className="grid grid-cols-[auto_1fr] gap-x-4 gap-y-1.5 text-[14px]">
        <dt className="text-muted">{t('common.patient')}</dt>
        <dd>{g.insuredName}</dd>
        <dt className="text-muted">{t('common.service')}</dt>
        <dd>
          {g.serviceCode} · {g.serviceName}
        </dd>
        <dt className="text-muted">{t('clinic.gp.icd10')}</dt>
        <dd className="num">{g.icd10}</dd>
        <dt className="text-muted">{t('clinic.gp.cost')}</dt>
        <dd className="num">{formatMoney(g.estimatedCost)}</dd>
        <dt className="text-muted">{t('clinic.gp.owner')}</dt>
        <dd data-testid="decision-owner">{decisionOwner(g)}</dd>
        {g.approvedAmount !== undefined && g.status !== 'requested' && (
          <>
            <dt className="text-muted">{t('clinic.gp.approved')}</dt>
            <dd className="num font-semibold">{formatMoney(g.approvedAmount)}</dd>
          </>
        )}
        {g.validUntil && g.status !== 'requested' && (
          <>
            <dt className="text-muted">{t('common.validUntil')}</dt>
            <dd className="num">{formatDate(g.validUntil)}</dd>
          </>
        )}
        {g.comment && (
          <>
            <dt className="text-muted">{t('clinic.gpRequest.comment')}</dt>
            <dd className="whitespace-pre-wrap">{g.comment}</dd>
          </>
        )}
        {g.reason && (
          <>
            <dt className="text-muted">{g.status === 'rejected' ? t('clinic.gp.rejectReason') : g.assistanceId && !g.escalated ? t('clinic.gp.requestAssist') : t('clinic.gp.requestMig')}</dt>
            <dd className="whitespace-pre-wrap">{g.reason}</dd>
          </>
        )}
        <dt className="text-muted">{t('clinic.gp.requested')}</dt>
        <dd className="num">{formatDateTime(g.createdAt)}</dd>
      </dl>
      {g.attachments.length > 0 && (
        <ul className="mt-3 flex flex-wrap gap-1.5">
          {g.attachments.map((a) => (
            <li key={a.id}>
              <Button size="sm" variant="secondary" onClick={() => void downloadAttachment(a.id, a.fileName)}>
                <Download className="h-3.5 w-3.5" aria-hidden /> {a.fileName}
              </Button>
            </li>
          ))}
        </ul>
      )}
      {(g.status === 'approved' || g.status === 'used') && (
        <Button className="mt-4" onClick={() => downloadPdf(guaranteePdf(g), `guarantee-${todayISO()}.pdf`)}>
          <Download className="h-4 w-4" aria-hidden /> {t('clinic.gp.downloadPdf')}
        </Button>
      )}
      {g.status === 'info_requested' && (
        <div className="mt-4 flex flex-col gap-3 border-t border-border-soft pt-4">
          <FilesPicker files={files} onChange={setFiles} label={t('clinic.gp.docsForExpert')} />
          <Field label={t('common.comment')} error={touched && comment.trim().length < 3 ? t('clinic.gp.commentError') : undefined}>
            {(a) => <Textarea {...a} rows={3} maxLength={1000} value={comment} onChange={(e) => setComment(e.target.value)} />}
          </Field>
          <Button className="w-fit" loading={answer.isPending} onClick={() => void send()}>
            {t('clinic.gp.sendDocs')}
          </Button>
        </div>
      )}
    </Modal>
  );
}

export default function GuaranteesPage() {
  useDocumentTitle(t('clinic.nav.guarantees'));
  const q = useClinicGuarantees();
  const [open, setOpen] = useState<GuaranteeView | null>(null);
  const columns: Column<GuaranteeView>[] = [
    { key: 'number', header: t('common.number'), cell: (g) => <span className="num font-semibold">{g.number}</span> },
    { key: 'who', header: t('common.patient'), cell: (g) => g.insuredName },
    { key: 'service', header: t('common.service'), cell: (g) => <span className="text-muted">{g.serviceName}</span> },
    { key: 'amount', header: t('common.amount'), align: 'right', cell: (g) => <span className="num whitespace-nowrap">{formatMoney(g.approvedAmount ?? g.estimatedCost)}</span> },
    { key: 'status', header: t('common.status'), cell: (g) => <GuaranteeChip status={g.status} /> },
    { key: 'owner', header: t('clinic.gp.owner'), cell: (g) => <span className="text-muted">{decisionOwner(g)}</span> },
    { key: 'date', header: t('clinic.gp.requested'), cell: (g) => <span className="num whitespace-nowrap text-muted">{formatDate(g.createdAt)}</span> },
  ];
  const current = open ? (q.data ?? []).find((g) => g.id === open.id) ?? open : null;
  return (
    <>
      <PageTitle
        title={t('clinic.nav.guarantees')}
        subtitle={t('clinic.gp.subtitle')}
        actions={
          <Button asChild>
            <Link to="/clinic/check">{t('clinic.home.checkPatient')}</Link>
          </Button>
        }
      />
      <Panel>
        <DataTable
          caption={t('clinic.gp.caption')}
          columns={columns}
          rows={q.data}
          rowKey={(g) => g.id}
          loading={q.isLoading}
          error={q.error}
          onRetry={() => void q.refetch()}
          onRowClick={setOpen}
          empty={
            <EmptyState
              testId="clinic-gp-empty"
              title={t('clinic.gp.empty')}
              why={t('emptyPartner.clinic.gp.why')}
              next={t('emptyPartner.clinic.gp.next')}
              actions={
                <Button variant="secondary" asChild>
                  <Link to="/clinic/check">{t('emptyPartner.clinic.gp.check')}</Link>
                </Button>
              }
              help={<EmptyHelp article="medical" section="guarantee-letter" />}
            />
          }
        />
      </Panel>
      {current && <GuaranteeDialog g={current} onClose={() => setOpen(null)} />}
    </>
  );
}
