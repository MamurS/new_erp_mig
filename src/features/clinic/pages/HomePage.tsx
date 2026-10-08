/* Clinic home (CLINIC_SPEC §4.1): big «Проверить пациента», tiles, recent events. */
import { Link } from 'react-router-dom';
import { ScanLine } from 'lucide-react';
import { useClinicOverview } from '@/shared/api/queries/clinic';
import { REGISTRY_STATUS_LABEL } from '@/shared/domain/clinics';
import { formatDateTime, formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Button } from '@/shared/ui/button';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { useCan } from '@/shared/auth/guards';
import { PageTitle, Panel } from '../components';
import { t } from '@/i18n';

/** A figure of the home screen; a link only when there is a screen behind it for this person (`to`). */
function Tile({ label, value, hint, to, tone }: { label: string; value: string; hint?: string; to?: string; tone?: 'warning' }) {
  const body = (
    <>
      <span className="text-[13px] text-muted">{label}</span>
      <span className={cn('font-heading text-[26px] font-semibold num', tone === 'warning' && 'text-warning-text')}>{value}</span>
      {hint && <span className={cn('text-[12px]', tone === 'warning' ? 'text-warning-text' : 'text-muted')}>{hint}</span>}
    </>
  );
  const cls = cn('flex flex-col gap-1 rounded-card border border-border bg-surface p-4', to && 'hover:border-accent', tone === 'warning' && 'border-warning bg-warning-soft');
  return to ? (
    <Link to={to} className={cls}>
      {body}
    </Link>
  ) : (
    <div className={cls}>{body}</div>
  );
}

export default function HomePage() {
  useDocumentTitle(t('shell.portal.clinic'));
  const q = useClinicOverview();
  const canRegistries = useCan('registries.submit');
  return (
    <>
      <PageTitle title={t('clinic.nav.home')} />
      <Link
        to="/clinic/check"
        className="mb-5 flex items-center gap-4 rounded-card bg-accent p-5 text-white shadow-xs hover:opacity-95"
        aria-label={t('clinic.home.checkPatient')}
      >
        <ScanLine className="h-10 w-10" aria-hidden />
        <span>
          <span className="block font-heading text-[22px] font-semibold">{t('clinic.home.checkPatient')}</span>
          <span className="block text-[14px] opacity-90">{t('clinic.home.checkHint')}</span>
        </span>
      </Link>
      <QueryState query={q} skeleton={<SkeletonRows rows={4} />}>
        {(o) => (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label={t('clinic.home.today')} value={String(o.appointmentsToday)} to="/clinic/appointments?view=schedule" />
              <Tile
                label={t('clinic.home.unanswered')}
                value={String(o.unanswered)}
                hint={o.unansweredOverdue ? t('clinic.home.overdue', { n: o.unansweredOverdue }) : t('clinic.home.answerWithin')}
                tone={o.unansweredOverdue ? 'warning' : undefined}
                to="/clinic/appointments"
              />
              <Tile label={t('clinic.home.gpPending')} value={String(o.guaranteesPending)} to="/clinic/guarantees" />
              <Tile
                label={t('clinic.home.currentRegistry')}
                value={o.currentRegistry ? formatMoney(o.currentRegistry.claimed) : '—'}
                hint={o.currentRegistry ? REGISTRY_STATUS_LABEL[o.currentRegistry.status] : t('clinic.home.notCreated')}
                to={canRegistries ? (o.currentRegistry ? `/clinic/registries/${o.currentRegistry.id}` : '/clinic/registries') : undefined}
              />
            </div>
            <Panel title={t('clinic.home.events')}>
              {o.events.length === 0 ? (
                <p className="p-4 text-muted">{t('clinic.home.noEvents')}</p>
              ) : (
                <ul className="divide-y divide-border-soft">
                  {o.events.map((e) => (
                    <li key={e.id} className="flex flex-wrap items-center justify-between gap-2 px-4 py-2.5">
                      <span>{e.text}</span>
                      <span className="text-[12px] text-muted">{formatDateTime(e.at)}</span>
                    </li>
                  ))}
                </ul>
              )}
            </Panel>
          </>
        )}
      </QueryState>
      <div className="mt-4">
        <Button asChild variant="secondary">
          <Link to="/clinic/guarantees">{t('clinic.nav.guarantees')}</Link>
        </Button>
      </div>
    </>
  );
}
