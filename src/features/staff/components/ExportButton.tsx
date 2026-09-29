import { Download } from 'lucide-react';
import { useExport, type ExportType } from '@/shared/api/queries/staff';
import { errorMessage } from '@/shared/api/client';
import { downloadText, exportFileName } from '@/shared/lib/csv';
import { useCan } from '@/shared/auth/guards';
import { Button } from '@/shared/ui/button';
import { toast } from '@/shared/ui/toast';

const FILE_KIND: Record<ExportType, string> = {
  clients: 'clients',
  claims_financial: 'claims-financial',
  policies: 'policies',
  hr_employees: 'employees',
  loss_ratio: 'loss-ratio',
  claims_by_category: 'claims-by-category',
  premium_by_month: 'premium-by-month',
};

export function ExportButton({ type, label = 'Экспорт в CSV' }: { type: ExportType; label?: string }) {
  const allowed = useCan('exports.create');
  const exp = useExport();
  if (!allowed) return null;
  return (
    <Button
      variant="secondary"
      loading={exp.isPending}
      onClick={async () => {
        try {
          const csv = await exp.mutateAsync(type);
          downloadText(csv.replace(/^\ufeff/, ''), exportFileName(FILE_KIND[type]));
          toast.success('Выгрузка готова. Запись добавлена в журнал аудита');
        } catch (e) {
          toast.error(errorMessage(e));
        }
      }}
    >
      <Download className="h-3.5 w-3.5" aria-hidden /> {label}
    </Button>
  );
}
