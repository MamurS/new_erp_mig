/*
 * «ИИ-проверка покрытия» (AI_COVERAGE_SPEC §4.5): scenarios, providers, the confidence threshold, the kill
 * switch, metrics, top disagreements and the golden cases. Changes wait for a second admin; the kill
 * switch works at once (the safe direction). Clauses are conditional while the templates are stubs.
 */
import { useEffect, useState } from 'react';
import { Play, Power } from 'lucide-react';
import type { AiProviderId, AiScenario, AiSettings } from '@/shared/types';
import type { AiGoldenResult } from '@/shared/types/dto';
import { useAiAdmin, useDecideAiSettings, useProposeAiSettings, useRunGolden } from '@/shared/api/queries/ai';
import { errorMessage } from '@/shared/api/client';
import { useUser } from '@/shared/auth/session';
import { aiRejectSchema, aiSettingsChangeSchema } from '@/shared/schemas/forms';
import { AI_PROVIDER_LABEL, AI_SCENARIO_LABEL, AI_SCENARIOS } from '@/features/ai/settings';
import { VERDICT_SHORT } from '@/features/ai/labels';
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

const pct = (v: number | null) => (v === null ? '—' : `${Math.round(v * 100)}%`);

function SettingsForm({ current, pending }: { current: AiSettings; pending: boolean }) {
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
      toast.success('Изменение отправлено на подтверждение второму администратору');
      setReason('');
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  const doKill = async () => {
    if (killReason.trim().length < 5) return toast.error('Опишите причину: минимум 5 символов');
    try {
      await propose.mutateAsync({ to: { ...current, killSwitch: true }, reason: killReason.trim() });
      toast.success('ИИ отключён везде');
      setKill(false);
    } catch (e) {
      toast.error(errorMessage(e));
    }
  };
  return (
    <Card
      title="Настройки"
      actions={
        current.killSwitch ? (
          <Chip kind="danger">ИИ отключён везде</Chip>
        ) : (
          <Button size="sm" variant="danger" onClick={() => setKill(true)}>
            <Power className="h-3.5 w-3.5" aria-hidden /> Отключить ИИ везде
          </Button>
        )
      }
    >
      <table className="w-full text-[13px]">
        <caption className="sr-only">Сценарии</caption>
        <thead>
          <tr className="border-b border-border text-left text-[12px] text-muted">
            <th className="py-2 pr-3 font-medium">Сценарий</th>
            <th className="py-2 pr-3 font-medium">Включён</th>
            <th className="py-2 font-medium">Провайдер</th>
          </tr>
        </thead>
        <tbody>
          {AI_SCENARIOS.map((s) => (
            <tr key={s} className="border-b border-border-soft">
              <td className="py-2 pr-3">{AI_SCENARIO_LABEL[s]}</td>
              <td className="py-2 pr-3">
                <input type="checkbox" aria-label={`Включить: ${AI_SCENARIO_LABEL[s]}`} checked={draft.scenarios[s].enabled} onChange={(e) => setScenario(s, { enabled: e.target.checked })} />
              </td>
              <td className="py-2">
                <Select aria-label={`Провайдер: ${AI_SCENARIO_LABEL[s]}`} className="h-8" value={draft.scenarios[s].provider} onChange={(e) => setScenario(s, { provider: e.target.value as AiProviderId })}>
                  {(Object.keys(AI_PROVIDER_LABEL) as AiProviderId[]).map((p) => (
                    <option key={p} value={p} disabled={p !== 'mock'}>
                      {AI_PROVIDER_LABEL[p]}
                      {p !== 'mock' ? ' — появится с бэкендом' : ''}
                    </option>
                  ))}
                </Select>
              </td>
            </tr>
          ))}
        </tbody>
      </table>
      <div className="mt-3 grid gap-3 sm:grid-cols-[180px_1fr]">
        <Field label="Порог уверенности, %" error={errors['to.confidenceThreshold']} hint="Ниже — «Нужна проверка специалиста»">
          {(a) => <Input {...a} inputMode="numeric" maxLength={3} value={threshold} onChange={(e) => setThreshold(e.target.value)} />}
        </Field>
        <Field label="Основание изменения" error={errors.reason}>
          {(a) => <Input {...a} maxLength={500} value={reason} onChange={(e) => setReason(e.target.value)} />}
        </Field>
      </div>
      <div className="mt-3 flex items-center gap-3">
        <Button disabled={pending} loading={propose.isPending} onClick={() => void submit()}>
          Предложить изменение
        </Button>
        {pending && <span className="text-[12px] text-muted">Есть изменение на подтверждении</span>}
        {current.killSwitch && <span className="text-[12px] text-muted">Чтобы включить ИИ, снимите флажок через «Предложить изменение» — нужен второй администратор.</span>}
      </div>
      {current.killSwitch && (
        <label className="mt-2 flex items-center gap-2 text-[13px]">
          <input type="checkbox" checked={!draft.killSwitch} onChange={(e) => setDraft((d) => ({ ...d, killSwitch: !e.target.checked }))} />
          Включить ИИ снова
        </label>
      )}
      <ConfirmDialog
        open={kill}
        onOpenChange={setKill}
        title="Отключить ИИ везде?"
        description="Все блоки ИИ сразу исчезнут во всех порталах, приложение покажет «Проверка временно недоступна». Включить снова можно только с подтверждением второго администратора."
        confirmLabel="Отключить"
        danger
        loading={propose.isPending}
        onConfirm={() => void doKill()}
      >
        <Field label="Причина">{(a) => <Textarea {...a} rows={2} maxLength={500} value={killReason} onChange={(e) => setKillReason(e.target.value)} />}</Field>
      </ConfirmDialog>
    </Card>
  );
}

function Golden() {
  const run = useRunGolden();
  const [r, setR] = useState<AiGoldenResult | null>(null);
  return (
    <Card
      title="Эталонные случаи"
      actions={
        <Button size="sm" variant="secondary" loading={run.isPending} onClick={() => void run.mutateAsync().then(setR).catch((e: unknown) => toast.error(errorMessage(e)))}>
          <Play className="h-3.5 w-3.5" aria-hidden /> Прогнать
        </Button>
      }
    >
      <p className="text-[13px] text-muted">Случаи из <code>src/features/ai/eval/golden.json</code>: текст, ожидаемые коды и вердикт для демо-программы «Стандарт». В CI точность мока не ниже 90%.</p>
      {r && (
        <div className="mt-3 text-[13px]" data-testid="golden-result">
          <p className="font-semibold">
            Точность {pct(r.accuracy)} · верно {r.correct} из {r.total}
          </p>
          {r.errors.length > 0 && (
            <ul className="mt-1 list-disc pl-5 text-muted">
              {r.errors.slice(0, 20).map((e) => (
                <li key={e.text}>
                  «{e.text}»: ожидали {e.expectedCodes.join(', ') || '—'} / {VERDICT_SHORT[e.expectedDecision]}, получили {e.gotCodes.join(', ') || '—'} / {VERDICT_SHORT[e.gotDecision]}
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
  useDocumentTitle('ИИ-проверка покрытия');
  useTopbar([{ label: 'ИИ-проверка покрытия' }]);
  const me = useUser();
  const q = useAiAdmin();
  const decide = useDecideAiSettings();
  const [reject, setReject] = useState<string | null>(null);
  return (
    <>
      <PageHeader
        title="ИИ-проверка покрытия"
        subtitle="Решают правила таблицы покрытия; ИИ сопоставляет текст с каталогом услуг и объясняет. Пункты программы условные, пока шаблоны документов — заглушки."
      />
      <QueryState query={q}>
        {(v) => {
          const pending = v.changes.find((c) => c.status === 'pending');
          return (
            <div className="grid gap-4 xl:grid-cols-2">
              <div className="flex flex-col gap-4">
                <SettingsForm current={v.settings} pending={!!pending} />
                {pending && (
                  <Card title="Ждёт подтверждения">
                    <p className="text-[13px]">
                      {pending.proposedByName}, {formatDateTime(pending.proposedAt)}: {pending.reason}
                    </p>
                    <p className="mt-1 text-[12px] text-muted">
                      Порог {Math.round(pending.from.confidenceThreshold * 100)}% → {Math.round(pending.to.confidenceThreshold * 100)}% · сценарии: {AI_SCENARIOS.map((s) => `${AI_SCENARIO_LABEL[s]} — ${pending.to.scenarios[s].enabled ? 'вкл' : 'выкл'}`).join('; ')}
                      {pending.from.killSwitch && !pending.to.killSwitch ? ' · ИИ включается снова' : ''}
                    </p>
                    {pending.proposedById === me?.id ? (
                      <p className="mt-2 text-[12px] text-muted">Подтверждает другой администратор</p>
                    ) : (
                      <div className="mt-2 flex gap-2">
                        <Button size="sm" loading={decide.isPending} onClick={() => void decide.mutateAsync({ id: pending.id, decision: 'approve' }).then(() => toast.success('Настройки применены')).catch((e: unknown) => toast.error(errorMessage(e)))}>
                          Подтвердить
                        </Button>
                        <Button size="sm" variant="secondary" onClick={() => setReject(pending.id)}>
                          Отклонить
                        </Button>
                      </div>
                    )}
                  </Card>
                )}
                <Golden />
              </div>
              <div className="flex flex-col gap-4">
                <Card title="Метрики" bodyClassName="p-0">
                  <table className="w-full text-[13px]" data-testid="ai-metrics">
                    <caption className="sr-only">Метрики по сценариям</caption>
                    <thead>
                      <tr className="border-b border-border text-left text-[12px] text-muted">
                        <th className="px-4 py-2 font-medium">Сценарий</th>
                        <th className="px-2 py-2 text-right font-medium">Ответов</th>
                        <th className="px-2 py-2 text-right font-medium">Оценено</th>
                        <th className="px-2 py-2 text-right font-medium">Согласие</th>
                        <th className="px-2 py-2 text-right font-medium">«Нужен специалист»</th>
                        <th className="px-4 py-2 text-right font-medium">Задержка</th>
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
                          <td className="num px-4 py-1.5 text-right">{m.avgLatencyMs === null ? '—' : `${m.avgLatencyMs} мс`}</td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </Card>
                <Card title="Топ расхождений" bodyClassName="p-0">
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
                    <p className="px-4 py-3 text-[13px] text-muted">Расхождений пока нет</p>
                  )}
                </Card>
                <p className="text-[12px] text-muted">Версия шаблона промпта: {v.promptVersion}. Доступные провайдеры: {v.providersAvailable.map((p) => AI_PROVIDER_LABEL[p]).join(', ')}.</p>
              </div>
            </div>
          );
        }}
      </QueryState>
      <ReasonDialog
        open={!!reject}
        onClose={() => setReject(null)}
        title="Отклонить изменение"
        description="Настройки останутся прежними."
        label="Причина"
        field="reason"
        schema={aiRejectSchema}
        confirmLabel="Отклонить"
        danger
        onSubmit={(reason) => decide.mutateAsync({ id: reject!, decision: 'reject', reason })}
      />
    </>
  );
}
