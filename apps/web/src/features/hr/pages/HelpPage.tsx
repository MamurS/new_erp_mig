/*
 * HR help: the common help screen (the guide for HR, search, «Задать вопрос», PDF) plus the client's MIG
 * manager — the HR channel for «Написать нам» — and the short FAQ of the cabinet.
 */
import { ChevronDown, Mail, Phone } from 'lucide-react';
import { useHrOverview } from '@/shared/api/queries/hr';
import { supportMailto } from '@/shared/config/support';
import { safeUrl } from '@/shared/lib/safeUrl';
import { Avatar } from '@/shared/ui/chips';
import { buttonVariants } from '@/shared/ui/button';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { HelpScreen } from '@/features/help/HelpScreen';
import { HrCard, HrSectionTitle } from '../ui';
import { t } from '@/i18n';

const faq = (): { q: string; a: string }[] => [
  { q: t('hr.help.q1'), a: t('hr.help.a1') },
  { q: t('hr.help.q2'), a: t('hr.help.a2') },
  { q: t('hr.help.q3'), a: t('hr.help.a3') },
  { q: t('hr.help.q4'), a: t('hr.help.a4') },
  { q: t('hr.help.q5'), a: t('hr.help.a5') },
  { q: t('hr.help.q6'), a: t('hr.help.a6') },
];

export default function HelpPage() {
  const overview = useHrOverview();
  const manager = overview.data?.manager;
  const support = manager ? (
    <a href={safeUrl(supportMailto(manager.email, t('help.support.subject')))} className={buttonVariants({ variant: 'secondary', size: 'md' })} data-testid="help-support">
      <Mail className="h-4 w-4" aria-hidden /> {t('help.support.us')}
    </a>
  ) : undefined;

  return <HelpScreen support={support} aside={<HrContacts overview={overview} />} />;
}

function HrContacts({ overview }: { overview: ReturnType<typeof useHrOverview> }) {
  return (
    <>
      <div className="grid gap-6 xl:grid-cols-[minmax(0,1fr)_340px]">
        <section aria-labelledby="hr-faq">
          <HrSectionTitle className="mb-3">
            <span id="hr-faq">{t('hr.help.faq')}</span>
          </HrSectionTitle>
          <div className="flex flex-col gap-3">
            {faq().map((f) => (
              <details key={f.q} className="group rounded-card border border-border bg-surface">
                <summary className="flex min-h-14 cursor-pointer list-none items-center justify-between gap-3 px-5 py-3 font-semibold [&::-webkit-details-marker]:hidden">
                  {f.q}
                  <ChevronDown className="h-5 w-5 shrink-0 text-muted transition-transform group-open:rotate-180 motion-reduce:transition-none" aria-hidden />
                </summary>
                <p className="px-5 pb-4 text-muted">{f.a}</p>
              </details>
            ))}
          </div>
        </section>

        <aside aria-label={t('hr.help.managerAria')}>
          <HrCard tone="accent">
            <QueryState query={overview} skeleton={<SkeletonRows rows={3} />}>
              {(o) => (
                <div className="flex flex-col gap-4 text-text">
                  <div className="flex items-center gap-3">
                    <Avatar name={o.manager.name} className="h-12 w-12 bg-surface text-[15px]" />
                    <div>
                      <p className="text-[13px] text-muted">{t('hr.help.yourManager')}</p>
                      <p className="font-heading text-[18px] font-semibold">{o.manager.name}</p>
                    </div>
                  </div>
                  <a
                    href={safeUrl(`tel:${o.manager.phone.replace(/[^\d+]/g, '')}`)}
                    className="flex min-h-12 items-center gap-3 rounded-btn bg-surface px-4 font-semibold hover:brightness-95"
                  >
                    <Phone className="h-4 w-4 text-accent" aria-hidden />
                    {o.manager.phone}
                  </a>
                  <a
                    href={safeUrl(`mailto:${o.manager.email}`)}
                    className="flex min-h-12 items-center gap-3 rounded-btn bg-surface px-4 font-semibold hover:brightness-95"
                  >
                    <Mail className="h-4 w-4 text-accent" aria-hidden />
                    {o.manager.email}
                  </a>
                  <p className="text-[13px] text-muted">{t('hr.help.hours')}</p>
                </div>
              )}
            </QueryState>
          </HrCard>
        </aside>
      </div>
    </>
  );
}
