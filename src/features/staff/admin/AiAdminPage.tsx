/*
 * «ИИ-проверка покрытия» (AI_COVERAGE_SPEC §4.5): scenarios, providers, the confidence threshold, the kill
 * switch, metrics, top disagreements and the golden cases. Changes wait for a second admin; the kill
 * switch works at once (the safe direction). Clauses are conditional while the templates are stubs.
 */
import { useEffect, useState } from 'react';
import { useSearchParams } from 'react-router-dom';
import { Play, Power } from 'lucide-react';
import type { AiProviderId, AiScenario, AiSettings } from '@/shared/types';
import type { AiGoldenResult } from '@/shared/types/dto';
import { useAiAdmin, useDecideAiSettings, useProposeAiSettings, useRunGolden } from '@/shared/api/queries/ai';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { aiRejectSchema, aiSettingsChangeSchema } from '@/shared/schemas/forms';
import { AI_PROVIDER_LABEL, AI_SCENARIO_LABEL, AI_SCENARIOS } from '@/features/ai/settings';
import { VERDICT_SHORT } from '@/features/ai/labels';
import { t, tm } from '@/i18n';
import { formatDateTime } from '@/shared/lib/format';
import { useDocumentTitle } from '@/shared/lib/hooks';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { Card, PageHeader } from '@/shared/ui/page';
import { QueryState } from '@/shared/ui/states';
import { toast } from '@/shared/ui/toast';
import { useTopbar } from '../topbar';
import { ReasonDialog } from '../lifecycle/common';
import { TableScroll } from '@/shared/ui/table-scroll';
import { Tabs, TabsContent, TabsList, TabsTrigger } from '@/shared/ui/tabs';
import { HelpQuestionsTab } from './HelpQuestionsTab';

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

/** `available`: the providers the server can call (the others need the backend); not a fixed list in the screen. */
function SettingsForm({ current, pending, available }: { current: AiSettings; pending: boolean; available: readonly AiProviderId[] }) {
  const propose = useProposeAiSettings();
  const [draft, setDraft] = useState<AiSettings>(current);
  const [threshold, setThreshold] = useState(String(Math.round(current.confidenceThreshold * 100)));
  const [reason, setReason] = useState('');
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [kill, setKill] = useState(false);
  const [killReason, setKillReason] = useState('');
  useEffect(() => {
    setDraft(current);
    setThreshold(String(Math.round(current.confidenceThreshold * 100)));
  }, [current]);
  const setScenario = (s: AiScenario, patch: Partial<AiSettings['scenarios'][AiScenario]>) => setDraft((d) => ({ ...d, scenarios: { ...d.scenarios, [s]: { ...d.scenarios[s], ...patch } } }));
  const submit = async () => {
    const parsed = aiSettingsChangeSchema.safeParse({ to: { ...draft, confidenceThreshold: Number(threshold.replace(',', '.')) / 100 }, reason });
    if (!parsed.success) return setErrors(Object.fromEntries(parsed.error.issues.map((i) => [i.path.join('.'), i.message])));
    setErrors({});
    try {
      await propose.mutateAsync(parsed.data);
      toast.success(t('staffOps.ai.sent'));
      setReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doKill = async () => {
    if (killReason.trim().length < 5) return toast.error(t('staffOps.ai.reasonMin'));
    try {
      await propose.mutateAsync({ to: { ...current, killSwitch: true }, reason: killReason.trim() });
      toast.success(t('staffOps.ai.killed'));
      setKill(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card
      title={t('staffOps.ai.settings')}
      actions={
        current.killSwitch ? (
          <Chip kind="danger">{t('staffOps.ai.killed')}</Chip>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setKill(true)}>
            <Power className="h-3.5 w-3.5" aria-hidden /> {t('staffOps.ai.killSwitch')}
          </Button>
        )
      }
    >
      <TableScroll>
      <table className="w-full text-[13px]">
        <caption className="sr-only">{t('staffOps.ai.scenarios')}</caption>
        <thead>
          <tr className="text-left text-[12px] text-muted">
            <th className="py-2 pr-3 font-medium">{t('staffOps.ai.scenario')}</th>
            <th className="py-2 pr-3 font-medium">{t('staffOps.ai.enabled')}</th>
            <th className="py-2 font-medium">{t('staffOps.ai.provider')}</th>
          </tr>
        </thead>
        <tbody>
          {AI_SCENARIOS.map((s) => (
            <tr key={s} className="border-b border-border-soft">
              <td className="py-2 pr-3">{AI_SCENARIO_LABEL[s]}</td>
              <td className="py-2 pr-3">
                <input type="checkbox" aria-label={t('staffOps.ai.enableAria', { name: AI_SCENARIO_LABEL[s] })} checked={draft.scenarios[s].enabled} onChange={(e) => setScenario(s, { enabled: e.target.checked })} />
              </td>
              <td className="py-2">
                <Select aria-label={t('staffOps.ai.providerAria', { name: AI_SCENARIO_LABEL[s] })} className="h-8" value={draft.scenarios[s].provider} onChange={(e) => setScenario(s, { provider: e.target.value as AiProviderId })}>
                  {(Object.keys(AI_PROVIDER_LABEL) as AiProviderId[]).map((p) => (
                    <option key={p} value={p} disabled={!available.includes(p)}>
                      {AI_PROVIDER_LABEL[p]}
                      {!available.includes(p) ? t('staffOps.ai.withBackend') : ''}
                    </option>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      </TableScroll>
      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label={t('staffOps.ai.threshold')} error={tm(errors['to.confidenceThreshold']) || undefined} hint={t('staffOps.ai.thresholdHint')}>
          {(a) => <Input {...a} inputMode="numeric" maxLength={3} value={threshold} onChange={(e) => setThreshold(e.target.value)} />}
        </Field>
        <Field label={t('staffOps.authority.reason')} error={tm(errors.reason) || undefined}>
          {(a) => <Input {...a} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={pending} loading={propose.isPending} onClick={() => void submit()}>
          {t('staffOps.ai.propose')}
        </Button>
        {pending && <span className="text-[12px] text-muted">{t('staffOps.ai.hasPending')}</span>}
        {current.killSwitch && <span className="text-[12px] text-muted">{t('staffOps.ai.reenableHint')}</span>}
      </div>
      {current.killSwitch && (
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={!draft.killSwitch} onChange={(e) => setDraft((d) => ({ ...d, killSwitch: !e.target.checked }))} />
          {t('staffOps.ai.reenable')}
        </label>
      )}
      <ConfirmDialog
        open={kill}
        onOpenChange={setKill}
        title={t('staffOps.ai.killTitle')}
        description={t('staffOps.ai.killText')}
        confirmLabel={t('staffOps.ai.kill')}
        danger
        loading={propose.isPending}
        onConfirm={() => void doKill()}
      >
        <Field label={t('common.reason')}>{(a) => <Textarea {...a} rows={2} maxLength={500} value={killReason} onChange={(e) => setKillReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </Card>
  );
}

function Golden() {
  const run = useRunGolden();
  const [r, setR] = useState<AiGoldenResult | null>(null);
  return (
    <Card
      title={t('staffOps.ai.golden')}
      actions={
        <Button size="sm" variant="secondary" loading={run.isPending} onClick={() => void run.mutateAsync().then(setR).catch((e: unknown) => toast.error(errorMessage(e)))}>
          <Play className="h-3.5 w-3.5" aria-hidden /> {t('staffOps.ai.run')}
        </Button>
      }
    >
      <p className="text-[13px] text-muted">
        {t('staffOps.ai.goldenFrom')} <code>src/features/ai/eval/golden.json</code>
        {t('staffOps.ai.goldenText')}
      </p>
      {r && (
        <div className="mt-3 text-[13px]" data-testid="golden-result">
          <p className="font-semibold">
            {t('staffOps.ai.goldenResult', { accuracy: pct(r.accuracy), correct: r.correct, total: r.total })}
          </p>
          {r.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {r.errors.slice(0, 20).map((e) => (
                <li key={e.text}>
                  {t('staffOps.ai.goldenError', {
                    text: e.text,
                    expCodes: e.expectedCodes.join(', ') || '—',
                    expVerdict: VERDICT_SHORT[e.expectedDecision],
                    gotCodes: e.gotCodes.join(', ') || '—',
                    gotVerdict: VERDICT_SHORT[e.gotDecision],
                  })}
                </li>
              ))}
            </ul>
          )}
        </div>
      )}
    </Card>
  );
}

export default function AiAdminPage() {
  useDocumentTitle(t('staffOps.ai.title'));
  useTopbar([{ label: t('staffOps.ai.title') }]);
  const me = useUser();
  const q = useAiAdmin();
  const decide = useDecideAiSettings();
  const [reject, setReject] = useState<string | null>(null);
  // The tab is in the URL (?tab=help) so a link can open the help questions directly.
  const [params, setParams] = useSearchParams();
  const tab = params.get('tab') === 'help' ? 'help' : 'settings';
  return (
    <>
      <PageHeader
        title={t('staffOps.ai.title')}
        subtitle={t('staffOps.ai.subtitle')}
      />
      <Tabs
        value={tab}
        onValueChange={(v) =>
          setParams(
            (p) => {
              const n = new URLSearchParams(p);
              if (v === 'help') n.set('tab', 'help');
              else n.delete('tab');
              return n;
            },
            { replace: true },
          )
        }
      >
        <TabsList className="mb-1">
          <TabsTrigger value="settings">{t('help.admin.tabSettings')}</TabsTrigger>
          <TabsTrigger value="help">{t('help.admin.tab')}</TabsTrigger>
        </TabsList>
        <TabsContent value="help">
          <HelpQuestionsTab />
        </TabsContent>
        <TabsContent value="settings">
          <QueryState query={q}>
            {(v) => {
              const pending = v.changes.find((c) => c.status === 'pending');
              return (
                <div className="grid gap-4 xl:grid-cols-2">
                  <div className="flex flex-col gap-4">
                    <SettingsForm current={v.settings} pending={!!pending} available={v.providersAvailable} />
                    {pending && (
                      <Card title={t('staffOps.ai.pendingTitle')}>
                        <p className="text-[13px]">
                          {pending.proposedByName}, {formatDateTime(pending.proposedAt)}: {pending.reason}
                        </p>
                        <p className="mt-1 text-[12px] text-muted">
                          {t('staffOps.ai.pendingSummary', {
                            from: Math.round(pending.from.confidenceThreshold * 100),
                            to: Math.round(pending.to.confidenceThreshold * 100),
                            list: AI_SCENARIOS.map((s) => t(pending.to.scenarios[s].enabled ? 'staffOps.ai.scenarioOn' : 'staffOps.ai.scenarioOff', { name: AI_SCENARIO_LABEL[s] })).join('; '),
                          })}
                          {pending.from.killSwitch && !pending.to.killSwitch ? t('staffOps.ai.reenabling') : ''}
                        </p>
                        {pending.proposedById === me?.id ? (
                          <p className="mt-2 text-[12px] text-muted">{t('staffOps.ai.otherAdmin')}</p>
                        ) : (
                          <div className="mt-2 flex gap-2">
                            <Button size="sm" loading={decide.isPending} onClick={() => void decide.mutateAsync({ id: pending.id, decision: 'approve' }).then(() => toast.success(t('staffOps.ai.applied'))).catch((e: unknown) => toast.error(errorMessage(e)))}>
                              {t('common.confirm')}
                            </Button>
                            <Button size="sm" variant="secondary" onClick={() => setReject(pending.id)}>
                              {t('common.reject')}
                            </Button>
                          </div>
                        )}
                      </Card>
                    )}
                    <Golden />
                  </div>
                  <div className="flex flex-col gap-4">
                    <Card title={t('staffOps.ai.metrics')} bodyClassName="p-0">
                      <TableScroll>
                      <table className="w-full text-[13px]" data-testid="ai-metrics">
                        <caption className="sr-only">{t('staffOps.ai.metricsCaption')}</caption>
                        <thead>
                          <tr className="text-left text-[12px] text-muted">
                            <th className="px-4 py-2 font-medium">{t('staffOps.ai.scenario')}</th>
                            <th className="px-2 py-2 text-right font-medium">{t('staffOps.ai.col.calls')}</th>
                            <th className="px-2 py-2 text-right font-medium">{t('staffOps.ai.col.rated')}</th>
                            <th className="px-2 py-2 text-right font-medium">{t('staffOps.ai.col.agree')}</th>
                            <th className="px-2 py-2 text-right font-medium">{t('staffOps.ai.col.specialist')}</th>
                            <th className="px-4 py-2 text-right font-medium">{t('staffOps.ai.col.latency')}</th>
                          </tr>
                        </thead>
                        <tbody>
                          {v.metrics.map((m) => (
                            <tr key={m.scenario} className="border-b border-border-soft" data-testid={`ai-metric-${m.scenario}`}>
                              <td className="px-4 py-1.5">{AI_SCENARIO_LABEL[m.scenario]}</td>
                              <td className="num px-2 py-1.5 text-right">{m.calls}</td>
                              <td className="num px-2 py-1.5 text-right">{m.rated}</td>
                              <td className="num px-2 py-1.5 text-right">{pct(m.agreeShare)}</td>
                              <td className="num px-2 py-1.5 text-right">{pct(m.specialistShare)}</td>
                              <td className="num px-4 py-1.5 text-right">{m.avgLatencyMs === null ? '—' : t('staffOps.ai.ms', { n: m.avgLatencyMs })}</td>
                            </tr>
                          ))}
                        </tbody>
                      </table>
                      </TableScroll>
                    </Card>
                    <Card title={t('staffOps.ai.disagreements')} bodyClassName="p-0">
                      {v.disagreements.length ? (
                        <ul className="divide-y divide-border-soft text-[13px]" data-testid="ai-disagreements">
                          {v.disagreements.map((x) => (
                            <li key={x.id} className="px-4 py-2">
                              <p>
                                <span className="text-muted">{AI_SCENARIO_LABEL[x.scenario]}:</span> «{x.input}» → {VERDICT_SHORT[x.decision]}
                              </p>
                              <p className="text-[12px] text-muted">
                                {x.byName}, {formatDateTime(x.at)}: {x.comment}
                              </p>
                            </li>
                          ))}
                        </ul>
                      ) : (
                        <p className="px-4 py-3 text-[13px] text-muted">{t('staffOps.ai.noDisagreements')}</p>
                      )}
                    </Card>
                    <p className="text-[12px] text-muted">{t('staffOps.ai.footer', { version: v.promptVersion, providers: v.providersAvailable.map((p) => AI_PROVIDER_LABEL[p]).join(', ') })}</p>
                  </div>
                </div>
              );
            }}
          </QueryState>
        </TabsContent>
      </Tabs>
      <ReasonDialog
        open={!!reject}
        onClose={() => setReject(null)}
        title={t('staffOps.ai.rejectTitle')}
        description={t('staffOps.ai.rejectText')}
        label={t('common.reason')}
        field="reason"
        schema={aiRejectSchema}
        confirmLabel={t('common.reject')}
        danger
        onSubmit={(reason) => decide.mutateAsync({ id: reject!, decision: 'reject', reason })}
      />
    </>
  );
}
