/* HR cabinet: read-only view of a commercial offer sent to the company (/hr/kp/:kpId). */
import { useMemo, useRef } from 'react';
import { Link, useParams } from 'react-router-dom';
import { ArrowLeft, Download } from 'lucide-react';
import { useKp, useKpDownloaded } from '@/shared/api/queries/kp';
import { errorMessage } from '@/shared/api/client';
import { formatDate, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { HR_BTN, HrHeader } from '@/features/hr/ui';
import { printKpFrame } from './KpFrame';
import { PRINT_HINT } from './KpDownloadButton';
import { KpPreview } from './KpPreview';
import { kpDocumentHtml } from './render';

export default function KpViewPage() {
  const { kpId = '' } = useParams();
  useDocumentTitle('Коммерческое предложение');
  const q = useKp(kpId);
  const kp = q.data;
  const doc = useMemo(() => (kp ? kpDocumentHtml(kp) : null), [kp]);
  const frame = useRef<HTMLIFrameElement>(null);
  const downloaded = useKpDownloaded();

  if (q.isLoading) return <SkeletonRows rows={8} />;
  if (q.isError || !kp || !doc) return <ErrorState error={q.error} onRetry={() => void q.refetch()} />;

  const download = async () => {
    try {
      await downloaded.mutateAsync(kp.id);
      await printKpFrame(frame.current);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <>
      <Link to="/hr/documents" className="mb-3 inline-flex items-center gap-1.5 text-[14px] font-semibold text-accent-text hover:underline">
        <ArrowLeft className="h-4 w-4" aria-hidden /> Счета и документы
      </Link>
      <HrHeader
        title={`Коммерческое предложение ${kp.number}`}
        subtitle={`Программа GOLD · от ${formatDate(kp.sentAt ?? kp.createdAt)} · общая премия ${formatMoney(kp.totalPremium)} · действительно до ${formatDate(kp.params.validUntil)}`}
        actions={
          <div className="flex flex-col items-end gap-1">
            <Button className={HR_BTN} onClick={() => void download()}>
              <Download className="h-4 w-4" aria-hidden /> Скачать PDF
            </Button>
            <span className="text-[13px] text-muted">{PRINT_HINT}</span>
          </div>
        }
      />
      <KpPreview frameRef={frame} title={doc.title} html={doc.html} />
    </>
  );
}
