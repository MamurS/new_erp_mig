/* One-time secret display: shown once in a modal with «Копировать», then only the last 4 characters remain. */
import { useState } from 'react';
import { Copy } from 'lucide-react';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { toast } from '@/shared/ui/toast';
import { t } from '@/i18n';

export function SecretReveal({ title, items, onClose }: { title: string; items: { label: string; value: string; testId: string }[]; onClose: () => void }) {
  const [copied, setCopied] = useState<string | null>(null);
  const copy = async (label: string, value: string) => {
    try {
      await navigator.clipboard.writeText(value);
      setCopied(label);
      toast.success(t('common.copied'));
    } catch {
      toast.error(t('clinic.secret.copyFailed'));
    }
  };
  return (
    <Modal
      open
      onOpenChange={(o) => !o && onClose()}
      title={title}
      wide
      footer={<Button onClick={onClose}>{t('clinic.secret.saved')}</Button>}
    >
      <p role="alert" className="mb-3 rounded-btn bg-warning-soft px-3 py-2 font-semibold text-warning-text">
        {t('clinic.secret.warning')}
      </p>
      <dl className="flex flex-col gap-3">
        {items.map((it) => (
          <div key={it.label}>
            <dt className="text-[12px] text-muted">{it.label}</dt>
            <dd className="flex flex-wrap items-center gap-2">
              <code className="break-all rounded-btn bg-rail px-2 py-1 font-mono text-[13px]" data-testid={it.testId}>
                {it.value}
              </code>
              <Button size="sm" variant="secondary" onClick={() => void copy(it.label, it.value)} aria-label={t('clinic.secret.copyAria', { label: it.label })}>
                <Copy className="h-3.5 w-3.5" aria-hidden /> {copied === it.label ? t('common.copied') : t('common.copy')}
              </Button>
            </dd>
          </div>
        ))}
      </dl>
    </Modal>
  );
}
