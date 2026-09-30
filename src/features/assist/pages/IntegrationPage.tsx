/* Integration of the assistance (§6, §8): the same screens as for clinics, bound to this partner. */
import ClinicIntegrationPage from '@/features/clinic/integration/IntegrationPage';
import { ASSIST_PARTNER, PartnerProvider } from '@/features/clinic/integration/partner';
import { useTopbar } from '@/features/staff/topbar';

export default function IntegrationPage() {
  useTopbar([{ label: 'Интеграция' }]);
  return (
    <PartnerProvider partner={ASSIST_PARTNER}>
      <ClinicIntegrationPage />
    </PartnerProvider>
  );
}
