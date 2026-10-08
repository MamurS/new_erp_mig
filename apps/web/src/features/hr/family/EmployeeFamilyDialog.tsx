import { Link } from 'react-router-dom';
import { Plus } from 'lucide-react';
import type { HrEmployee } from '@mig/contracts/dto';
import { useHrFamily } from '@/shared/api/queries/hr';
import { RELATION_LABEL } from '@mig/domain/family';
import { cn } from '@/shared/lib/cn';
import { buttonVariants } from '@/shared/ui/button';
import { Modal } from '@/shared/ui/dialog';
import { ErrorState, SkeletonRows } from '@/shared/ui/states';
import { HR_BTN } from '../ui';
import { FamilyStatusChip } from './FamilyStatusChip';
import { t } from '@/i18n';

/** The family of one employee as a list of people (no medical data) and the way to add someone. */
export function EmployeeFamilyDialog({ employee, onClose }: { employee: Pick<HrEmployee, 'id' | 'fullName'>; onClose: () => void }) {
  const family = useHrFamily(employee.id);
  return (
    <Modal
      open
      onOpenChange={(o) => {
        if (!o) onClose();
      }}
      title={t('hr.family.ofEmployee', { name: employee.fullName })}
      description={t('hr.family.dialogNote')}
      footer={
        <Link to={`/hr/family/new?employeeId=${employee.id}`} state={{ employeeName: employee.fullName }} className={cn(buttonVariants({ variant: 'primary' }), HR_BTN)}>
          <Plus className="h-4 w-4" aria-hidden />
          {t('hr.familyAdd.title')}
        </Link>
      }
    >
      {family.isLoading ? (
        <SkeletonRows rows={3} />
      ) : family.isError ? (
        <ErrorState error={family.error} onRetry={() => void family.refetch()} />
      ) : (family.data ?? []).length === 0 ? (
        <p className="text-muted">{t('hr.family.noneForEmployee')}</p>
      ) : (
        <ul className="divide-y divide-border" data-testid="employee-family">
          {(family.data ?? []).map((m) => (
            <li key={m.id} className="flex flex-wrap items-center justify-between gap-2 py-2.5">
              <span className="min-w-0">
                <span className="block font-semibold">{m.fullName}</span>
                <span className="block text-[13px] text-muted">
                  {RELATION_LABEL[m.relation]}
                  {m.isStudent ? ` · ${t('hr.family.student')}` : ''} · <span className="num">{m.birthDateMasked || '—'}</span>
                  {m.certificateNumber ? (
                    <>
                      {' · '}
                      <span className="num">{m.certificateNumber}</span>
                    </>
                  ) : null}
                </span>
              </span>
              <FamilyStatusChip member={m} />
            </li>
          ))}
        </ul>
      )}
    </Modal>
  );
}
