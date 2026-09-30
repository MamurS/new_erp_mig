/* Chats with insured persons (§5.1): messages from the app of the assistance's clients land here. */
import { useState } from 'react';
import { useAssistSend, useAssistThread, useAssistThreads } from '@/shared/api/queries/assist';
import { errorMessage } from '@/shared/api/client';
import { chatSchema } from '@/shared/schemas/forms';
import { formatDateTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Input } from '@/shared/ui/input';
import { PageHeader } from '@/shared/ui/page';
import { EmptyState, SkeletonRows } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '@/features/staff/topbar';

export default function ChatPage() {
  useDocumentTitle('Чаты');
  useTopbar([{ label: 'Чаты' }]);
  const threads = useAssistThreads();
  const [active, setActive] = useState<string | null>(null);
  const current = active ?? threads.data?.[0]?.insuredId ?? null;
  const thread = useAssistThread(current);
  const send = useAssistSend();
  const [text, setText] = useState('');
  const submit = async () => {
    const parsed = chatSchema.safeParse({ text });
    if (!parsed.success || !current) return;
    try {
      await send.mutateAsync({ id: current, text: parsed.data.text });
      setText('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <>
      <PageHeader title="Чаты с застрахованными" />
      <div className="grid min-h-[480px] gap-4 lg:grid-cols-[320px_1fr]">
        <div className="rounded-card border border-border bg-surface">
          {threads.isLoading ? (
            <SkeletonRows rows={5} />
          ) : !threads.data?.length ? (
            <EmptyState title="Сообщений нет" />
          ) : (
            <ul className="divide-y divide-border-soft" aria-label="Диалоги">
              {threads.data.map((t) => (
                <li key={t.insuredId}>
                  <button type="button" onClick={() => setActive(t.insuredId)} className={cn('flex w-full flex-col items-start px-3 py-2 text-left hover:bg-rail', t.insuredId === current && 'bg-rail')}>
                    <span className="flex w-full items-center gap-2">
                      <span className="min-w-0 flex-1 truncate font-medium">{t.insuredName}</span>
                      {t.unanswered && <span className="h-2 w-2 rounded-full bg-accent" aria-label="Ждёт ответа" />}
                    </span>
                    <span className="w-full truncate text-[12px] text-muted">{t.lastText}</span>
                  </button>
                </li>
              ))}
            </ul>
          )}
        </div>
        <div className="flex flex-col rounded-card border border-border bg-surface">
          <div className="flex-1 space-y-2 overflow-y-auto p-4" data-testid="assist-chat">
            {(thread.data ?? []).map((m) => (
              <div key={m.id} className={cn('max-w-[75%] rounded-card px-3 py-2', m.from === 'operator' ? 'ml-auto bg-accent-soft' : 'bg-rail')}>
                <p className="whitespace-pre-wrap">{m.text}</p>
                <p className="mt-0.5 text-[11px] text-muted num">{formatDateTime(m.at)}</p>
              </div>
            ))}
          </div>
          {current && (
            <form
              className="flex gap-2 border-t border-border p-3"
              onSubmit={(e) => {
                e.preventDefault();
                void submit();
              }}
            >
              <Input value={text} maxLength={1000} onChange={(e) => setText(e.target.value)} placeholder="Ответ застрахованному" aria-label="Ответ" />
              <Button type="submit" loading={send.isPending}>
                Отправить
              </Button>
            </form>
          )}
        </div>
      </div>
    </>
  );
}
