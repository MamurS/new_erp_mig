/* Bell in the top bar (MIG portal, HR cabinet): in-app notifications, e.g. «… выполнил(а) вашу задачу». */
import { t, tm } from '@/i18n';
import { useNavigate } from 'react-router-dom';
import { Bell } from 'lucide-react';
import { useNotifications, useReadNotifications } from '@/shared/api/queries/tasks';
import { formatDateTime } from '@/shared/lib/format';
import { cn } from '@/shared/lib/cn';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/shared/ui/dropdown';

export function NotificationsBell({ className }: { className?: string }) {
  const navigate = useNavigate();
  const list = useNotifications();
  const read = useReadNotifications();
  const items = list.data ?? [];
  const unread = items.filter((n) => !n.read).length;
  return (
    <Menu onOpenChange={(o) => !o && unread > 0 && read.mutate()}>
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
          items.slice(0, 10).map((n) => (
            <MenuItem key={n.id} data-testid="notification" onSelect={() => n.link && navigate(n.link)} className="flex flex-col items-start gap-0.5 whitespace-normal">
              <span className={cn('text-[13px]', !n.read && 'font-semibold')}>{tm(n.text)}</span>
              {n.detail && <span className="text-[12px] text-muted">{tm(n.detail)}</span>}
              <span className="num text-[11px] text-muted">{formatDateTime(n.createdAt)}</span>
            </MenuItem>
          ))
        )}
      </MenuContent>
    </Menu>
  );
}
