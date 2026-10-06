/*
 * A contract transferred from the previous system is in force without a signing in the new one: its
 * signed scan is attached later, with the upload rules of contract scans (PDF/JPEG/PNG, 20 MB, images
 * re-encoded without metadata).
 */
import { t, tm } from '@/i18n';
import { useRef } from 'react';
import { FileUp } from 'lucide-react';
import type { ContractView } from '@/shared/types/dto';
import { errorMessage } from '@/shared/api/client';
import { useAttachMigratedScan } from '@/shared/api/queries/migration';
import { useCan } from '@/shared/auth/guards';
import { prepareScan } from '@/shared/lib/attachments';
import { formatDateTime } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { Card } from '@/shared/ui/page';
import { toast } from '@/shared/ui/toast';

export function MigratedScanCard({ c }: { c: ContractView }) {
  const attach = useAttachMigratedScan();
  const fileRef = useRef<HTMLInputElement>(null);
  const canVerify = useCan('contracts.verify_scan');
  const canDraft = useCan('contracts.draft');
  const canUpload = canVerify || canDraft;
  const onFile = async (file: File | undefined) => {
    if (!file) return;
    const prepared = await prepareScan(file);
    if (fileRef.current) fileRef.current.value = '';
    if ('error' in prepared) {
      toast.error(tm(prepared.error));
      return;
    }
    try {
      await attach.mutateAsync({ contractId: c.id, file: prepared.file });
      toast.success(t('migration.scanAttached'));
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card
      title={t('migration.scan')}
      actions={
        canUpload && (
          <>
            <Button size="sm" variant="secondary" loading={attach.isPending} onClick={() => fileRef.current?.click()}>
              <FileUp className="h-3.5 w-3.5" aria-hidden /> {c.migratedScan ? t('migration.scanReplace') : t('migration.scanAttach')}
            </Button>
            <input
              ref={fileRef}
              type="file"
              className="sr-only"
              accept="application/pdf,image/jpeg,image/png,.pdf,.jpg,.jpeg,.png"
              aria-label={t('migration.scanAttach')}
              onChange={(e) => void onFile(e.target.files?.[0])}
            />
          </>
        )
      }
    >
      <p className="text-[13px]" data-testid="migrated-scan">
        {c.migratedScan ? t('migration.scanInfo', { at: formatDateTime(c.migratedScan.uploadedAt), name: c.migratedScan.uploadedByName }) : t('migration.scanNone')}
      </p>
      {canUpload && <p className="mt-1 text-[12px] text-muted">{t('migration.scanHint')}</p>}
    </Card>
  );
}
