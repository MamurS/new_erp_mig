/*
 * Links out of the help: «Открыть раздел» to screens the role may open, and «Написать куратору / нам»
 * when the help has no answer (each portal's own support channel).
 */
import type { ReactNode } from 'react';
import { Link } from 'react-router-dom';
import { ArrowUpRight, Mail, MessageCircle } from 'lucide-react';
import { t, tKey } from '@/i18n';
import type { Role } from '@mig/contracts';
import type { HelpOpenRoute } from '@mig/contracts/help';
import { MIG_SUPPORT_EMAIL, supportMailto } from '@/shared/config/support';
import { safeUrl } from '@/shared/lib/safeUrl';
import { buttonVariants } from '@/shared/ui/button';
import { canOpenRoute, portalOfRole, type ScreenLink } from './routeMap';

/** The button text: the screen's navigation label in the current language, else its name in the guide. */
export function screenLabel(s: { label?: string; labelKey?: string; names?: readonly string[] }): string {
  if (s.labelKey) return tKey(s.labelKey);
  return s.label ?? s.names?.[0] ?? '';
}

/** «Открыть раздел «…»» buttons. The routes are checked against the role again (the screen guards do too). */
export function OpenSectionLinks({ role, links, className }: { role: Role; links: readonly (ScreenLink | HelpOpenRoute)[]; className?: string }) {
  const allowed = links.filter((l) => canOpenRoute(role, l.route));
  if (!allowed.length) return null;
  return (
    <div role="group" aria-label={t('help.openSections')} className={className ?? 'flex flex-wrap gap-2'} data-testid="help-open-links">
      {allowed.map((l) => {
        const name = screenLabel(l);
        return (
          <Link key={l.route} to={l.route} className={buttonVariants({ variant: 'soft', size: 'sm' })} data-route={l.route}>
            {t('help.openSectionNamed', { name })}
            <ArrowUpRight className="h-3.5 w-3.5" aria-hidden />
          </Link>
        );
      })}
    </div>
  );
}

/**
 * Where to write when the help has no answer: MIG staff — the DMS curator; the insured person — the chat
 * of the app; HR — the client's MIG manager (passed by the HR cabinet); clinics and assistance — MIG.
 */
export function SupportLink({ role, override }: { role: Role; override?: ReactNode }) {
  if (override) return <>{override}</>;
  const cls = buttonVariants({ variant: 'secondary', size: 'md' });
  const portal = portalOfRole(role);
  if (portal === 'app') {
    return (
      <Link to="/app/chat" className={cls} data-testid="help-support">
        <MessageCircle className="h-4 w-4" aria-hidden /> {t('help.support.us')}
      </Link>
    );
  }
  const label = portal === 'staff' ? t('help.support.curator') : t('help.support.us');
  return (
    <a href={safeUrl(supportMailto(MIG_SUPPORT_EMAIL, t('help.support.subject')))} className={cls} data-testid="help-support">
      <Mail className="h-4 w-4" aria-hidden /> {label}
    </a>
  );
}
