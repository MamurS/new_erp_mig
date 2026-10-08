import { t } from '@/i18n';
import type { ReactNode } from 'react';
import { Button } from './button';
import { Modal } from './dialog';

export interface ConfirmDialogProps {
  open: boolean;
  onOpenChange: (open: boolean) => void;
  title: string;
  /** Explains the consequences of the action. */
  description: ReactNode;
  confirmLabel: string;
  cancelLabel?: string;
  danger?: boolean;
  loading?: boolean;
  disabled?: boolean;
  onConfirm: () => void;
  children?: ReactNode;
}

export function ConfirmDialog(p: ConfirmDialogProps) {
  return (
    <Modal
      open={p.open}
      onOpenChange={p.onOpenChange}
      title={p.title}
      description={p.description}
      footer={
        <>
          <Button variant="secondary" onClick={() => p.onOpenChange(false)}>
            {p.cancelLabel ?? t('common.cancel')}
          </Button>
          <Button variant={p.danger ? 'danger' : 'primary'} loading={p.loading} disabled={p.disabled} onClick={p.onConfirm}>
            {p.confirmLabel}
          </Button>
        </>
      }
    >
      {p.children}
    </Modal>
  );
}
