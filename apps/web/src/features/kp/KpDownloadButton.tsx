/*
 * «Download PDF» for a saved offer outside the KP screen (client documents, HR cabinet).
 * The heavy renderer and templates are loaded on click; the document is printed from a hidden frame.
 */
import { useRef, useState } from 'react';
import { Download } from 'lucide-react';
import { useQueryClient } from '@tanstack/react-query';
import { t } from '@/i18n';
import { useKpDownloaded } from '@/shared/api/queries/kp';
import { qk } from '@/shared/api/queries/keys';
import { errorMessage, request } from '@/shared/api/client';
import * as S from '@mig/contracts/schemas';
import { Button, type ButtonProps } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { DocFrame, printDocFrame } from '@/features/documents/DocFrame';

/** Toast and hint shown before the print dialog. */
export const printHint = (): string => t('documents.print.hint');

/** Works with the id only: the saved document is fetched (and access checked by the server) on click. */
export function KpDownloadButton({ kpId, number, label: labelProp, ...props }: { kpId: string; number: string; label?: string } & Omit<ButtonProps, 'onClick'>) {
  const label = labelProp ?? t('kp.download');
  const [doc, setDoc] = useState<{ title: string; html: string } | null>(null);
  const [busy, setBusy] = useState(false);
  const frame = useRef<HTMLIFrameElement>(null);
  const downloaded = useKpDownloaded();
  const qc = useQueryClient();

  const start = async () => {
    setBusy(true);
    try {
      const [{ kpDocumentHtml }, kp] = await Promise.all([
        import('./render'),
        qc.fetchQuery({ queryKey: qk.kp(kpId), queryFn: () => request(`/kp/${kpId}`, { schema: S.kpDocument }) }),
      ]);
      setDoc(kpDocumentHtml(kp));
    } catch (e) {
      toast.error(errorMessage(e));
      setBusy(false);
    }
  };

  const onLoad = async () => {
    try {
      await downloaded.mutateAsync(kpId);
      toast.info(printHint());
      await printDocFrame(frame.current);
    } catch (e) {
      toast.error(errorMessage(e));
    } finally {
      setBusy(false);
      setDoc(null);
    }
  };

  return (
    <>
      <Button variant="secondary" size="sm" loading={busy} onClick={() => void start()} aria-label={t('kp.downloadNumber', { label, number })} {...props}>
        <Download className="h-3.5 w-3.5" aria-hidden />
        {label}
      </Button>
      {doc && (
        <DocFrame
          ref={frame}
          html={doc.html}
          title={doc.title}
          hidden
          onLoad={() => void onLoad()}
          style={{ position: 'fixed', left: -10_000, top: 0, width: 794, height: 1123, border: 0 }}
        />
      )}
    </>
  );
}
