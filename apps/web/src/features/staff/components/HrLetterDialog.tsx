import { t } from '@/i18n';
import { useState } from 'react';
import { useHrLetter } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

export function HrLetterDialog({ open, onOpenChange, clientId, clientName }: { open: boolean; onOpenChange: (v: boolean) => void; clientId: string; clientName: string }) {
  const letter = useHrLetter();
  const [subject, setSubject] = useState(() => t('staff.hrLetter.defaultSubject'));
  const [text, setText] = useState(() => t('staff.hrLetter.defaultText'));
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title={t('staff.hrLetter.title')}
      description={t('staff.hrLetter.description', { client: clientName })}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            {t('common.cancel')}
          </Button>
          <Button
            loading={letter.isPending}
            disabled={!subject.trim() || text.trim().length < 10}
            onClick={async () => {
              try {
                await letter.mutateAsync({ clientId, subject: subject.trim(), text: text.trim() });
                toast.success(t('staff.hrLetter.sent'));
                onOpenChange(false);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            {t('staff.hrLetter.submit')}
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label={t('staff.hrLetter.subject')}>{(a) => <Input {...a} value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label={t('staff.hrLetter.text')}>{(a) => <Textarea {...a} value={text} maxLength={2000} rows={6} onChange={(e) => setText(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
