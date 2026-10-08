/* HR cabinet: read-only view of a commercial offer sent to the company (/hr/kp/:kpId). */
import { useMemo, useRef, useState } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Check, Download } from 'lucide-react';
import { t } from '@/i18n';
import { useKpRespond } from '@/shared/api/queries/lifecycle';
import { KP_STATUS_LABEL } from '@mig/domain/kp';
import { kpDeclineSchema } from '@mig/contracts/forms';
import { ReasonDialog } from '@/features/staff/lifecycle/common';
import { useKp, useKpDownloaded } from '@/shared/api/queries/kp';
import { errorMessage } from '@/shared/api/client';
import { formatDate, formatMoney } from '@mig/domain/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HR_BTN, HrHeader } from '@/features/hr/ui';
import { printDocFrame } from '@/features/documents/DocFrame';
import { printHint } from './KpDownloadButton';
import { KpPreview } from './KpPreview';
import { kpDocumentHtml } from './render';

export default function KpViewPage() {
  const { kpId = '' } = useParams();
  useDocumentTitle(t('kp.editor.docTitle'));
  const q = useKp(kpId);
  const kp = q.data;
  const doc = useMemo(() => (kp ? kpDocumentHtml(kp) : null), [kp]);
  const frame = useRef<HTMLIFrameElement>(null);
  const downloaded = useKpDownloaded();
  const respond = useKpRespond();
  const [decline, setDecline] = useState(false);

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.isError || !kp || !doc) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const download = async () => {
    try {
      await downloaded.mutateAsync(kp.id);
      await printDocFrame(frame.current);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <Link to="/hr/documents" className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent-text hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> {t('kp.view.back')}
      </Link>
      <HrHeader
        title={t('kp.view.title', { number: kp.number })}
        subtitle={t('kp.view.subtitle', { date: formatDate(kp.sentAt ?? kp.createdAt), total: formatMoney(kp.totalPremium), validUntil: formatDate(kp.params.validUntil) })}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button className={HR_BTN} onClick={() => void download()}>
              <Download className="h-4 w-4" aria-hidden /> {t('kp.download')}
            </Button>
            <span className="text-[13px] text-muted">{printHint()}</span>
          </div>
        }
      />
      {kp.status === 'sent' && kp.dealId && (
        <div className="mb-5 flex flex-wrap items-center gap-3 rounded-card bg-accent-soft p-4 text-accent-text" data-testid="kp-respond">
          <span className="mr-auto font-semibold">{t('kp.view.respond')}</span>
          <Button
            className={HR_BTN}
            loading={respond.isPending}
            onClick={() =>
              void respond
                .mutateAsync({ kpId: kp.id, decision: 'accept' })
                .then(() => toast.success(t('kp.view.accepted')))
                .catch((e: unknown) => toast.error(errorMessage(e)))
            }
          >
            <Check className="h-4 w-4" aria-hidden /> {t('kp.view.accept')}
          </Button>
          <Button variant="secondary" className={HR_BTN} onClick={() => setDecline(true)}>
            {t('kp.view.decline')}
          </Button>
        </div>
      )}
      {(kp.status === 'accepted' || kp.status === 'declined') && (
        <p className="mb-5 rounded-card bg-rail p-4 font-semibold" role="status">
          {KP_STATUS_LABEL[kp.status]}
          {kp.response?.reason && `: ${kp.response.reason}`}
        </p>
      )}
      <KpPreview frameRef={frame} title={doc.title} html={doc.html} />
      <ReasonDialog
        open={decline}
        onClose={() => setDecline(false)}
        title={t('kp.view.declineTitle')}
        description={t('kp.view.declineText')}
        label={t('common.reason')}
        field="reason"
        schema={kpDeclineSchema}
        confirmLabel={t('kp.view.decline')}
        danger
        onSubmit={(reason) => respond.mutateAsync({ kpId: kp.id, decision: 'decline', reason })}
      />
    </>
  );
}
