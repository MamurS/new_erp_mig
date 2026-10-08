import type { HrFamilyMember } from '@mig/contracts/dto';
import { Chip } from '@/shared/ui/chips';
import { AppStatusChip } from '../ui';
import { t } from '@/i18n';

/** Status of a family member for HR: a request MIG has not approved, excluded, over the age limit, or the app. */
export function FamilyStatusChip({ member: m }: { member: Pick<HrFamilyMember, 'status' | 'overAgeLimit' | 'appStatus'> }) {
  if (m.status === 'pending') return <Chip kind="sun">{t('hr.employees.pending')}</Chip>;
  if (m.status === 'rejected') return <Chip kind="danger">{t('hr.employees.rejected')}</Chip>;
  if (m.status === 'excluded') return <span className="text-muted">{t('hr.employees.excluded')}</span>;
  if (m.overAgeLimit) return <Chip kind="warning">{t('hr.family.overAgeLimit')}</Chip>;
  return <AppStatusChip status={m.appStatus} />;
}
