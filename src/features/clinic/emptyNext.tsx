/*
 * Pieces of the partner empty states (clinic, assistance, insured app; DECISIONS «Пустые состояния»).
 * External roles cannot create tasks («Попросить {роль}» is for MIG staff and HR only), so they get the
 * responsible role in the text and a way to reach MIG: the support mailbox (subject only — the question may
 * hold personal data and never goes into a URL) or, in the app, the chat.
 */
import { Link } from 'react-router-dom';
import { Mail, MessageCircle } from 'lucide-react';
import { t } from '@/i18n';
import { useUser } from '@/shared/auth/session';
import { MIG_SUPPORT_EMAIL, supportMailto } from '@/shared/config/support';
import { safeUrl } from '@/shared/lib/safeUrl';
import { portalOfRole } from '@/features/help/routeMap';
import { HelpMore } from '@/features/next/NextActions';

const LINK = 'inline-flex items-center gap-1 text-accent-text underline-offset-2 hover:underline';

/** «Написать в МИГ» for clinics and assistance, «Написать нам» (chat) in the app; nothing for MIG staff and HR. */
export function ContactMig() {
  const user = useUser();
  if (!user) return null;
  const portal = portalOfRole(user.role);
  if (portal === 'staff' || portal === 'hr') return null;
  if (portal === 'app')
    return (
      <Link to="/app/chat" className={LINK} data-testid="empty-contact">
        <MessageCircle className="h-3.5 w-3.5" aria-hidden /> {t('emptyPartner.contact.chat')}
      </Link>
    );
  return (
    <a href={safeUrl(supportMailto(MIG_SUPPORT_EMAIL, t('emptyPartner.contact.subject')))} className={LINK} data-testid="empty-contact">
      <Mail className="h-3.5 w-3.5" aria-hidden /> {t('emptyPartner.contact.mig')}
    </a>
  );
}

/** The help link and, when asked, the contact — the `help` slot of an empty state. */
export function EmptyHelp({ article, section, contact = false }: { article: string; section?: string; contact?: boolean }) {
  return (
    <>
      <HelpMore article={article} section={section} />
      {contact && <ContactMig />}
    </>
  );
}
