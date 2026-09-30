/* Network clinics and their prices for this assistance (§5.3): the pair «clinic + payer». Read-only. */
import { useState } from 'react';
import { useAssistClinics } from '@/shared/api/queries/assist';
import { SERVICE_CATEGORY_LABEL } from '@/shared/domain/clinics';
import { formatMoney } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { cn } from '@/shared/lib/cn';
import { Chip } from '@/shared/ui/chips';
import { PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { useTopbar } from '@/features/staff/topbar';

export default function ClinicsPage() {
  useDocumentTitle('Клиники и прайсы');
  useTopbar([{ label: 'Клиники и прайсы' }]);
  const q = useAssistClinics();
  const [active, setActive] = useState<string | null>(null);
  return (
    <>
      <PageHeader title="Клиники сети и прайсы" subtitle="Цена строки реестра проверяется по прайсу пары «клиника + ассистанс». Без отдельного договора действует прайс МИГ" />
      <QueryState query={q}>
        {(list) => {
          const current = list.find((c) => c.clinicId === active) ?? list[0];
          return (
            <div className="grid gap-4 lg:grid-cols-[320px_1fr]">
              <ul className="rounded-card border border-border bg-surface" aria-label="Клиники">
                {list.map((c) => (
                  <li key={c.clinicId}>
                    <button type="button" onClick={() => setActive(c.clinicId)} className={cn('flex w-full items-center justify-between gap-2 border-b border-border-soft px-3 py-2 text-left hover:bg-rail', current?.clinicId === c.clinicId && 'bg-rail')}>
                      <span className="min-w-0">
                        <span className="block truncate font-medium">{c.clinicName}</span>
                        <span className="block text-[12px] text-muted">{c.city}</span>
                      </span>
                      {c.ownPrices && <Chip kind="accent">свой прайс</Chip>}
                    </button>
                  </li>
                ))}
              </ul>
              {current && (
                <div className="rounded-card border border-border bg-surface">
                  <div className="border-b border-border-soft px-4 py-2.5 font-bold">
                    {current.clinicName} · {current.ownPrices ? 'прайс по договору с ассистансом' : 'прайс МИГ'}
                  </div>
                  <table className="w-full text-left">
                    <caption className="sr-only">Прайс-лист</caption>
                    <thead className="text-[12px] text-muted">
                      <tr>
                        <th className="px-4 py-2 font-medium">Код</th>
                        <th className="px-4 py-2 font-medium">Услуга</th>
                        <th className="px-4 py-2 font-medium">Категория</th>
                        <th className="px-4 py-2 text-right font-medium">Цена</th>
                      </tr>
                    </thead>
                    <tbody>
                      {current.priceList.map((p) => (
                        <tr key={p.code} className="border-t border-border-soft">
                          <td className="num px-4 py-1.5">{p.code}</td>
                          <td className="px-4 py-1.5">
                            {p.name} {p.requiresGuarantee && <Chip kind="sky">нужно ГП</Chip>}
                          </td>
                          <td className="px-4 py-1.5 text-muted">{SERVICE_CATEGORY_LABEL[p.category]}</td>
                          <td className="num px-4 py-1.5 text-right">{formatMoney(p.price)}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              )}
            </div>
          );
        }}
      </QueryState>
    </>
  );
}
