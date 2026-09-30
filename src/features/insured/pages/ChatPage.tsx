import { useEffect, useRef, useState } from 'react';
import { Send } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useChat, useSendChat } from '@/shared/api/queries/me';
import { errorMessage } from '@/shared/api/client';
import type { ChatMessage } from '@/shared/types';
import { formatTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { chatSchema } from '@/shared/schemas/forms';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';
import { CardSkeletons, Empty, LoadError, ScreenHeader } from '../components';
import { CHAT_MAX, linkify } from '../lib';
import { useMyAssistance } from '@/shared/api/queries/assist';

/** Message text as plain React text; only safe http(s) URLs become links. */
export function MessageText({ text }: { text: string }) {
  return (
    <>
      {linkify(text).map((p, i) =>
        p.kind === 'link' ? (
          <a key={i} href={p.href} target="_blank" rel="noopener noreferrer" className="break-all underline">
            {p.value}
          </a>
        ) : (
          <span key={i}>{p.value}</span>
        ),
      )}
    </>
  );
}

function Bubble({ m }: { m: ChatMessage }) {
  const { t } = useI18n();
  const mine = m.from === 'insured';
  return (
    <li className={cn('flex flex-col', mine ? 'items-end' : 'items-start')}>
      <span className="mb-0.5 px-1 text-[12px] text-muted">
        {mine ? t('chat.you') : t('chat.operator')} · {formatTime(m.at)}
      </span>
      <p
        className={cn(
          'max-w-[85%] whitespace-pre-wrap break-words rounded-card px-4 py-2.5 text-[15px]',
          mine ? 'rounded-br-md bg-accent text-white' : 'rounded-bl-md border border-border bg-surface',
        )}
      >
        <MessageText text={m.text} />
      </p>
    </li>
  );
}

export default function ChatPage() {
  const { t } = useI18n();
  useDocumentTitle(t('chat.title'));
  const q = useChat();
  const send = useSendChat();
  const assistance = useMyAssistance();
  const [text, setText] = useState('');
  const endRef = useRef<HTMLDivElement>(null);
  const count = q.data?.length ?? 0;

  useEffect(() => {
    endRef.current?.scrollIntoView?.({ block: 'end' });
  }, [count]);

  const submit = async () => {
    const parsed = chatSchema.safeParse({ text });
    if (!parsed.success || send.isPending) return;
    try {
      await send.mutateAsync(parsed.data.text);
      setText('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };

  return (
    <div className="flex min-h-[calc(100vh-var(--banner-h,0px)-140px)] flex-col">
      <ScreenHeader title={t('chat.title')} back="/app" />
      {assistance.data?.assistance && (
        <p className="-mt-2 mb-3 text-[13px] text-muted" data-testid="chat-assistance">
          {t('chat.assistance', { name: assistance.data.assistance.name })}
        </p>
      )}
      <div className="flex-1">
        {q.isLoading ? (
          <CardSkeletons count={2} />
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : count === 0 ? (
          <Empty title={t('chat.empty')} />
        ) : (
          <ul aria-label={t('chat.messages')} aria-live="polite" className="flex flex-col gap-3">
            {q.data?.map((m) => <Bubble key={m.id} m={m} />)}
          </ul>
        )}
        <div ref={endRef} />
      </div>
      <form
        onSubmit={(e) => {
          e.preventDefault();
          void submit();
        }}
        className="sticky bottom-[76px] mt-4 rounded-card border border-border bg-surface p-2 shadow-lg"
      >
        <div className="flex items-end gap-2">
          <label htmlFor="chat-input" className="sr-only">
            {t('chat.placeholder')}
          </label>
          <textarea
            id="chat-input"
            value={text}
            maxLength={CHAT_MAX}
            rows={1}
            placeholder={t('chat.placeholder')}
            onChange={(e) => setText(e.target.value.slice(0, CHAT_MAX))}
            onKeyDown={(e) => {
              if (e.key === 'Enter' && !e.shiftKey) {
                e.preventDefault();
                void submit();
              }
            }}
            className="max-h-32 min-h-[48px] flex-1 resize-none rounded-btn border border-border bg-bg px-3 py-3 text-[15px] focus-visible:outline-2 focus-visible:outline-accent"
          />
          <Button type="submit" aria-label={t('chat.send')} loading={send.isPending} disabled={!text.trim()} className="h-12 w-12 shrink-0 rounded-btn p-0">
            {!send.isPending && <Send className="h-5 w-5" aria-hidden />}
          </Button>
        </div>
        <p className="mt-1 px-1 text-right text-[12px] text-muted" aria-live="off">
          {t('chat.limit', { n: text.length })}
        </p>
      </form>
    </div>
  );
}
