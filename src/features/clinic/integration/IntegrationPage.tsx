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

const TABS = [
  ['overview', 'Обзор'],
  ['keys', 'Ключи API'],
  ['webhooks', 'Вебхуки'],
  ['logs', 'Журнал запросов'],
  ['docs', 'Документация'],
  ['sandbox', 'Песочница'],
] as const;
const KEYS = ['tab'] as const;

export default function IntegrationPage() {
  useDocumentTitle('Интеграция');
  const [f, setF] = useUrlFilters(KEYS);
  const tab = TABS.some(([k]) => k === f.tab) ? f.tab : 'overview';
  return (
    <>
      <PageTitle title="Интеграция" subtitle="Подключение медицинской информационной системы клиники к МИГ по API" />
      <Tabs value={tab} onValueChange={(v) => setF({ tab: v === 'overview' ? null : v })}>
        <TabsList>
          {TABS.map(([k, label]) => (
            <TabsTrigger key={k} value={k}>
              {label}
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
