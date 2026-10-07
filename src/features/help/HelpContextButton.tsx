/* «?» in the top bar of every portal: opens the help on the part that explains the current screen. */
import { Link, useLocation } from 'react-router-dom';
import { CircleHelp } from 'lucide-react';
import { t } from '@/i18n';
import { useUser } from '@/shared/auth/session';
import { cn } from '@/shared/lib/cn';
import { Tooltip } from '@/shared/ui/tooltip';
import { helpAnchorForPath } from './routeMap';
import { helpBase } from './paths';

export function HelpContextButton({ className }: { className?: string }) {
  const user = useUser();
  const { pathname } = useLocation();
  if (!user) return null;
  const base = helpBase(user.role);
  const anchor = helpAnchorForPath(pathname);
  const label = t('help.contextButton');
  return (
    <Tooltip content={label} side="bottom">
      <Link to={anchor ? `${base}/${anchor}` : base} aria-label={label} data-testid="help-context" className={cn('shrink-0 rounded-btn p-2 text-muted hover:bg-rail hover:text-text', className)}>
        <CircleHelp className="h-4 w-4" aria-hidden />
      </Link>
    </Tooltip>
  );
}
