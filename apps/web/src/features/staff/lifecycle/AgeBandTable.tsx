/* The age-band rate table of a quote / contract (appendix 4): annual premium per person of each age band. */
import { t } from '@/i18n';
import type { AgeBandRate } from '@mig/contracts';
import { bandLabel } from '@mig/domain/pricing';
import { formatMoney } from '@mig/domain/lib/format';
import { TableScroll } from '@/shared/ui/table-scroll';

export function AgeBandTable({ rates }: { rates: readonly AgeBandRate[] }) {
  return (
    <TableScroll>
      <table className="w-full text-[12px]" data-testid="age-band-table">
        <thead>
          <tr className="text-left text-muted">
            <th className="px-2 py-1 font-medium">{t('staffLc.pricing.band')}</th>
            <th className="px-2 py-1 text-right font-medium">{t('staffLc.pricing.annual')}</th>
          </tr>
        </thead>
        <tbody>
          {rates.map((r) => (
            <tr key={r.minAge} className="border-t border-border-soft">
              <td className="num px-2 py-1">{bandLabel(r)}</td>
              <td className="num px-2 py-1 text-right">{formatMoney(r.annual)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </TableScroll>
  );
}
