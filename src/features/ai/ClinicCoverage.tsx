/* «Проверка покрытия» in the clinic's guarantee form (AI_COVERAGE_SPEC §4.2): verdict and clauses, limit as a status only. */
import { Sparkles } from 'lucide-react';
import { useAiStatus, useClinicCoverage } from '@/shared/api/queries/ai';
import { useDebounced } from '@/shared/lib/hooks';
import { Chip } from '@/shared/ui/chips';
import { LIMIT_STATUS_LABEL, VERDICT_CHIP, VERDICT_SHORT } from './labels';

export function ClinicCoverage({ visitId, serviceCode, icd10 }: { visitId: string; serviceCode: string; icd10: string }) {
  const status = useAiStatus();
  const icd = useDebounced(icd10.trim().toUpperCase());
  const on = !!status.data?.scenarios.clinic && !!serviceCode;
  const q = useClinicCoverage(visitId, serviceCode, /^[A-Z]\d{2}(\.\d{1,2})?$/.test(icd) ? icd : '', on);
  if (!on) return null;
  const item = q.data?.available ? q.data.items[0] : undefined;
  if (q.data && !q.data.available) return null;
  const decision = item ? (item.needsSpecialist ? 'unknown' : item.verdict.decision) : null;
  return (
    <section className="rounded-btn border border-border-soft bg-rail/50 p-3 text-[13px] md:col-span-2" aria-label="Проверка покрытия" data-testid="clinic-coverage">
      <p className="mb-1 flex items-center gap-1.5 font-semibold">
        <Sparkles className="h-4 w-4 text-accent" aria-hidden /> Проверка покрытия
      </p>
      {q.isLoading || !item || !decision ? (
        <p className="text-muted">{q.isError ? 'Проверка недоступна' : 'Проверяем…'}</p>
      ) : (
        <>
          <p className="flex flex-wrap items-center gap-2">
            <Chip kind={VERDICT_CHIP[decision]}>{VERDICT_SHORT[decision]}</Chip>
            {item.limitStatus && <Chip kind={item.limitStatus === 'available' ? 'success' : item.limitStatus === 'low' ? 'warning' : 'danger'}>{LIMIT_STATUS_LABEL[item.limitStatus]}</Chip>}
          </p>
          {item.clauses.length > 0 && <p className="mt-1 text-muted">Пункты: {item.clauses.map((c) => c.label).join('; ')}</p>}
          <p className="mt-1 text-[12px] text-muted">Предварительная оценка: решение по письму принимает врач.</p>
        </>
      )}
    </section>
  );
}
