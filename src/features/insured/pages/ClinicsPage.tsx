import { useNavigate } from 'react-router-dom';
import { MapPin, ShieldCheck } from 'lucide-react';
import { useI18n } from '@/i18n';
import { useNearbyClinics } from '@/shared/api/queries/me';
import type { Clinic } from '@/shared/types';
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { CardSkeletons, ChoiceChip, Empty, LoadError, ScreenHeader } from '../components';
import { isSpecialty, SPECIALTIES } from '../lib';

const KEYS = ['specialty'] as const;

export default function ClinicsPage() {
  const { t } = useI18n();
  useDocumentTitle(t('clinics.title'));
  const navigate = useNavigate();
  const [filters, setFilters] = useUrlFilters(KEYS);
  const specialty = isSpecialty(filters.specialty) ? filters.specialty : '';
  const q = useNearbyClinics(specialty);

  const bookHere = (c: Clinic) => {
    const spec = specialty || c.specialties[0];
    navigate('/app/booking', { state: { clinicId: c.id, specialty: spec } });
  };

  return (
    <div>
      <ScreenHeader title={t('clinics.title')} />
      <div role="group" aria-label={t('clinics.filter')} className="-mx-4 flex gap-2 overflow-x-auto px-4 pb-2">
        <ChoiceChip selected={specialty === ''} onClick={() => setFilters({ specialty: null })}>
          {t('clinics.all')}
        </ChoiceChip>
        {SPECIALTIES.map((s) => (
          <ChoiceChip key={s} selected={specialty === s} onClick={() => setFilters({ specialty: s })}>
            {t(`specialty.${s}`)}
          </ChoiceChip>
        ))}
      </div>
      <div className="mt-3">
        {q.isLoading ? (
          <CardSkeletons />
        ) : q.isError ? (
          <LoadError error={q.error} onRetry={() => void q.refetch()} />
        ) : !q.data || q.data.length === 0 ? (
          <Empty
            title={t('clinics.empty')}
            action={
              <Button variant="secondary" onClick={() => setFilters({ specialty: null })} className="h-12 rounded-btn px-5 text-[15px]">
                {t('clinics.all')}
              </Button>
            }
          />
        ) : (
          <ul className="flex flex-col gap-3">
            {q.data.map((c) => (
              <li key={c.id} className="rounded-card border border-border bg-surface p-4">
                <div className="flex items-start justify-between gap-2">
                  <p className="font-bold">{c.name}</p>
                  {c.distanceKm !== undefined && (
                    <span className="shrink-0 rounded-full bg-sky px-2 py-0.5 text-[12px] font-bold text-sky-text">
                      {t('clinics.km', { km: c.distanceKm })}
                    </span>
                  )}
                </div>
                <p className="mt-1 flex items-start gap-1 text-[14px] text-muted">
                  <MapPin className="mt-0.5 h-3.5 w-3.5 shrink-0" aria-hidden />
                  <span>{c.address}</span>
                </p>
                <p className="mt-1 text-[13px] text-muted">{c.specialties.map((s) => t(`specialty.${s}`)).join(', ')}</p>
                <div className="mt-3 flex items-center justify-between gap-2">
                  <span className="inline-flex items-center gap-1 rounded-full bg-accent-soft px-2.5 py-1 text-[12px] font-bold text-accent-text">
                    <ShieldCheck className="h-3.5 w-3.5" aria-hidden />
                    {t('clinics.byPolicy')}
                  </span>
                  <Button onClick={() => bookHere(c)} className="h-11 rounded-btn px-4 text-[15px] font-semibold">
                    {t('clinics.bookHere')}
                  </Button>
                </div>
              </li>
            ))}
          </ul>
        )}
      </div>
    </div>
  );
}
