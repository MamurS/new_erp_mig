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

function Tile({ label, value, hint, to, tone }: { label: string; value: string; hint?: string; to: string; tone?: 'warning' }) {
  return (
    <Link to={to} className={cn('flex flex-col gap-1 rounded-card border border-border bg-surface p-4 hover:border-accent', tone === 'warning' && 'border-warning bg-warning-soft')}>
      <span className="text-[13px] text-muted">{label}</span>
      <span className={cn('font-heading text-[26px] font-semibold num', tone === 'warning' && 'text-warning-text')}>{value}</span>
      {hint && <span className={cn('text-[12px]', tone === 'warning' ? 'text-warning-text' : 'text-muted')}>{hint}</span>}
    </Link>
  );
}

export default function HomePage() {
  useDocumentTitle('Кабинет клиники');
  const q = useClinicOverview();
  const canRegistries = useCan('registries.submit');
  return (
    <>
      <PageTitle title="Главная" />
      <Link
        to="/clinic/check"
        className="mb-5 flex items-center gap-4 rounded-card bg-accent p-5 text-white shadow-sm hover:opacity-95"
        aria-label="Проверить пациента"
      >
        <ScanLine className="h-10 w-10" aria-hidden />
        <span>
          <span className="block font-heading text-[22px] font-semibold">Проверить пациента</span>
          <span className="block text-[14px] opacity-90">QR из приложения, код из 8 символов или номер полиса и ПИНФЛ</span>
        </span>
      </Link>
      <QueryState query={q} skeleton={<SkeletonRows rows={4} />}>
        {(o) => (
          <>
            <div className="mb-5 grid grid-cols-2 gap-3 lg:grid-cols-4">
              <Tile label="Записи на сегодня" value={String(o.appointmentsToday)} to="/clinic/appointments?view=schedule" />
              <Tile
                label="Заявки без ответа"
                value={String(o.unanswered)}
                hint={o.unansweredOverdue ? `Просрочено: ${o.unansweredOverdue}` : 'Ответ в течение 2 часов'}
                tone={o.unansweredOverdue ? 'warning' : undefined}
                to="/clinic/appointments"
              />
              <Tile label="ГП на рассмотрении" value={String(o.guaranteesPending)} to="/clinic/guarantees" />
              <Tile
                label="Реестр текущего месяца"
                value={o.currentRegistry ? formatMoney(o.currentRegistry.claimed) : '—'}
                hint={o.currentRegistry ? REGISTRY_STATUS_LABEL[o.currentRegistry.status] : 'Ещё не создан'}
                to={canRegistries ? (o.currentRegistry ? `/clinic/registries/${o.currentRegistry.id}` : '/clinic/registries') : '/clinic'}
              />
            </div>
            <Panel title="Последние события">
              {o.events.length === 0 ? (
                <p className="p-4 text-muted">Событий пока нет</p>
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
          <Link to="/clinic/guarantees">Гарантийные письма</Link>
        </Button>
      </div>
    </>
  );
}
