/*
 * Demo files of the portfolio transfer (/staff/admin/migration): six CSV files with 5 clients,
 * 5 contracts, 200 insured persons, used limits, 10 open claims and invoices, with rows that show
 * the validation report. Only in the demo build.
 */
import './messages';
import { t } from '@/i18n';
import { FlaskConical, Download } from 'lucide-react';
import type { MigrationStep } from '@/shared/types/migration';
import { MIGRATION_STEPS, migrationFileName } from '@/shared/domain/migration';
import { downloadText } from '@/shared/lib/csv';
import { formatDate } from '@/shared/lib/format';
import { Button } from '@/shared/ui/button';
import { MIGRATION_DEMO_DATE, migrationDemoFiles } from './migrationSamples';

export function MigrationSamples({ stepLabel }: { stepLabel: (step: MigrationStep) => string }) {
  return (
    <section data-testid="migration-samples" className="mb-4 rounded-card border border-warning/40 bg-warning-soft p-3 text-[13px] text-warning-text">
      <h2 className="flex items-center gap-1.5 font-semibold">
        <FlaskConical className="h-4 w-4" aria-hidden /> {t('demo.migration.title')}
      </h2>
      <p className="mt-1">{t('demo.migration.hint', { date: formatDate(MIGRATION_DEMO_DATE) })}</p>
      <div className="mt-2 flex flex-wrap gap-2">
        {MIGRATION_STEPS.map((s) => (
          <Button
            key={s}
            size="sm"
            variant="secondary"
            onClick={() => {
              const files = migrationDemoFiles();
              downloadText(files[s], migrationFileName(s, 'demo'));
            }}
          >
            <Download className="h-3.5 w-3.5" aria-hidden /> {t('demo.migration.download', { step: stepLabel(s) })}
          </Button>
        ))}
      </div>
    </section>
  );
}
