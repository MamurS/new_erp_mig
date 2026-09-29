import { useState } from 'react';
import { useHrLetter } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { Button } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { Field, Input, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';

export function HrLetterDialog({ open, onOpenChange, clientId, clientName }: { open: boolean; onOpenChange: (v: boolean) => void; clientId: string; clientName: string }) {
  const letter = useHrLetter();
  const [subject, setSubject] = useState('Продление полиса ДМС');
  const [text, setText] = useState(`Добрый день! Напоминаем, что срок действия полиса ДМС вашей компании скоро заканчивается. Подготовим предложение на продление — ответьте на это письмо, пожалуйста.`);
  return (
    <Modal
      open={open}
      onOpenChange={onOpenChange}
      title="Письмо HR"
      description={`Письмо уйдёт контакту HR компании «${clientName}» с адреса dms@mig.example.`}
      footer={
        <>
          <Button variant="secondary" onClick={() => onOpenChange(false)}>
            Отмена
          </Button>
          <Button
            loading={letter.isPending}
            disabled={!subject.trim() || text.trim().length < 10}
            onClick={async () => {
              try {
                await letter.mutateAsync({ clientId, subject: subject.trim(), text: text.trim() });
                toast.success('Письмо HR отправлено');
                onOpenChange(false);
              } catch (e) {
                toast.error(errorMessage(e));
              }
            }}
          >
            Отправить письмо
          </Button>
        </>
      }
    >
      <div className="flex flex-col gap-3">
        <Field label="Тема">{(a) => <Input {...a} value={subject} maxLength={120} onChange={(e) => setSubject(e.target.value)} />}</Field>
        <Field label="Текст">{(a) => <Textarea {...a} value={text} maxLength={2000} rows={6} onChange={(e) => setText(e.target.value)} />}</Field>
      </div>
    </Modal>
  );
}
