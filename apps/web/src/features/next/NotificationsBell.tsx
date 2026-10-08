/*
 * Bell in the top bar of every portal (DECISIONS «Запросы между сотрудниками: полный цикл»): requests
 * («… просит: …»), their answers, deadlines and reminders. The counter shows the unread ones; a click opens
 * the object and marks that notification read; «Отметить всё прочитанным» clears the counter.
 */
import { t, tm } from '@/i18n';
import { useNavigate } from 'react-router-dom';
import { Bell, CheckCheck } from 'lucide-react';
import { useNotifications, useReadNotification, useReadNotifications } from '@/shared/api/queries/tasks';
import { formatDateTime } from '@mig/domain/lib/format';
import { cn } from '@/shared/lib/cn';
import { Menu, MenuContent, MenuItem, MenuSeparator, MenuTrigger } from '@/shared/ui/dropdown';

export function NotificationsBell({ className }: { className?: string }) {
  const navigate = useNavigate();
  const list = useNotifications();
  const readOne = useReadNotification();
  const readAll = useReadNotifications();
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;
  return (
    <Menu>
      <MenuTrigger asChild>
        <button
          type="button"
          aria-label={unread ? `${t('next.bell.label')}. ${t('next.bell.unread', { n: unread })}` : t('next.bell.label')}
          data-testid="notifications"
          className={cn('relative shrink-0 rounded-btn p-2 text-muted hover:bg-rail hover:text-text', className)}
        >
          <Bell className="h-4 w-4" aria-hidden />
          {unread > 0 && (
            <span data-testid="notifications-count" className="num absolute right-0.5 top-0.5 min-w-[16px] rounded-full bg-danger px-1 text-[10px] font-bold leading-4 text-white">
              {unread}
            </span>
          )}
        </button>
      </MenuTrigger>
      <MenuContent className="w-80 max-w-[calc(100vw-24px)]">
        {items.length === 0 ? (
          <p className="px-3 py-3 text-[13px] text-muted">{t('next.bell.empty')}</p>
        ) : (
          <>
            {unread > 0 && (
              <>
                <MenuItem data-testid="notifications-read-all" onSelect={() => readAll.mutate()} className="text-[13px] text-accent-text">
                  <CheckCheck className="h-4 w-4" aria-hidden /> {t('next.bell.readAll')}
                </MenuItem>
                <MenuSeparator />
              </>
            )}
            <div className="max-h-[60vh] overflow-y-auto">
              {items.slice(0, 20).map((n) => (
                <MenuItem
                  key={n.id}
                  data-testid="notification"
                  data-unread={!n.read || undefined}
                  onSelect={() => {
                    if (!n.read) readOne.mutate(n.id);
                    if (n.link) navigate(n.link);
                  }}
                  className="flex flex-col items-start gap-0.5 whitespace-normal"
                >
                  <span className={cn('text-[13px]', !n.read && 'font-semibold')}>{tm(n.text)}</span>
                  {n.detail && <span className="text-[12px] text-muted">{tm(n.detail)}</span>}
                  <span className="num text-[11px] text-muted">{formatDateTime(n.createdAt)}</span>
                </MenuItem>
              ))}
            </div>
          </>
        )}
      </MenuContent>
    </Menu>
  );
}
