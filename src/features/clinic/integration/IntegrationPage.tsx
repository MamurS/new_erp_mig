/* Integration (CLINIC_SPEC §4.8, clinic_admin): overview, API keys, webhooks, request log, docs, sandbox. */
import { useDocumentTitle, useUrlFilters } from '@/shared/lib/hooks';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { PageTitle } from '../components';
import { OverviewTab } from './OverviewTab';
import { KeysTab } from './KeysTab';
import { WebhooksTab } from './WebhooksTab';
import { LogsTab } from './LogsTab';
import { DocsTab } from './DocsTab';
import { SandboxTab } from './SandboxTab';
import { usePartner } from './partner';
import { t, defineLabels } from '@/i18n';

const TABS = ['overview', 'keys', 'webhooks', 'logs', 'docs', 'sandbox'] as const;
const TAB_LABEL = defineLabels('clinic.integration.tab', TABS);
const KEYS = ['tab'] as const;

export default function IntegrationPage() {
  useDocumentTitle(t('clinic.nav.integration'));
  const [f, setF] = useUrlFilters(KEYS);
  const tab = TABS.some((k) => k === f.tab) ? f.tab : 'overview';
  return (
    <>
      <PageTitle title={t('clinic.nav.integration')} subtitle={t('clinic.integration.subtitle', { system: usePartner().systemName })} />
      <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v })}>
        <TabsList>
          {TABS.map((k) => (
            <TabsTrigger key={k} value={k}>
              {TAB_LABEL[k]}
            </TabsTrigger>
          ))}
        </TabsList>
        <TabsContent value="overview">
          <OverviewTab />
        </TabsContent>
        <TabsContent value="keys">
          <KeysTab />
        </TabsContent>
        <TabsContent value="webhooks">
          <WebhooksTab />
        </TabsContent>
        <TabsContent value="logs">
          <LogsTab />
        </TabsContent>
        <TabsContent value="docs">
          <DocsTab />
        </TabsContent>
        <TabsContent value="sandbox">
          <SandboxTab />
        </TabsContent>
      </Tabs>
    </>
  );
}
