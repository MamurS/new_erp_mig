/*
 * Demo simulator of an assistance company's system (ASSISTANCE_SPEC §8). Real integration API calls
 * with its own key, created through the portal; the secret stays in memory only.
 */
import './messages';
import { t, tm } from '@/i18n';
import { docNumber } from '@mig/domain/numbering';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { integrationCall, request, errorMessage, type IntegrationCallResult } from '@/shared/api/client';
import * as C from '@mig/contracts/schemas-clinic';
import * as A from '@mig/contracts/schemas-assist';
import { ASSIST_SCOPES } from '@mig/contracts/integration';
import { addDaysISO, todayISO } from '@mig/domain/lib/format';
import { Button } from '@/shared/ui/button';
import { useDmsParam } from '@/shared/api/queries/params';

interface Creds {
  clientId: string;
  clientSecret: string;
  token?: string;
}
interface Line {
  id: string;
  status: string;
  amount: number;
  payment?: unknown;
}

function problemText(r: IntegrationCallResult): string {
  const b = r.body as { detail?: string; errors?: Record<string, string> } | null;
  const first = b?.errors ? Object.entries(b.errors)[0] : undefined;
  const detail = b?.detail ? tm(b.detail) : t('demo.sim.error');
  return first ? t('demo.sim.problemField', { status: r.status, detail, field: first[0], message: tm(first[1]) }) : t('demo.sim.problem', { status: r.status, detail });
}

export function AssistSimulator() {
  const qc = useQueryClient();
  const creds = useRef<Creds | null>(null);
  const validityDays = useDmsParam('guaranteeValidityDays');
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  const token = async (): Promise<string> => {
    if (!creds.current) {
      // eslint-disable-next-line mig/no-cyrillic-ui -- demo data sent to the API, not an interface string
      const k = await request('/assist/integration/keys', { method: 'POST', body: { name: 'Демо-CRM ассистанса', scopes: [...ASSIST_SCOPES], ipAllowlist: '' }, schema: C.keyCreated });
      creds.current = { clientId: k.clientId, clientSecret: k.clientSecret };
      say(t('demo.sim.keyCreated', { id: k.clientId }));
    }
    if (!creds.current.token) {
      const r = await integrationCall('POST', '/oauth/token', { form: true, body: { grant_type: 'client_credentials', client_id: creds.current.clientId, client_secret: creds.current.clientSecret } });
      const t = (r.body as { access_token?: string } | null)?.access_token;
      if (!t) throw new Error(problemText(r));
      creds.current.token = t;
    }
    return creds.current.token;
  };

  const call = async (method: 'GET' | 'POST', path: string, body?: unknown): Promise<IntegrationCallResult> => {
    let r = await integrationCall(method, path, { token: await token(), body, headers: method === 'POST' ? { 'Idempotency-Key': crypto.randomUUID() } : {} });
    if (r.status === 401) {
      creds.current = null;
      r = await integrationCall(method, path, { token: await token(), body });
    }
    return r;
  };

  const run = (name: string, fn: () => Promise<string>) => async () => {
    setBusy(name);
    try {
      say(await fn());
    } catch (e) {
      say(t('demo.sim.failed', { message: errorMessage(e) }));
    } finally {
      setBusy(null);
      void qc.invalidateQueries({ queryKey: ['assist'] });
      void qc.invalidateQueries({ queryKey: ['integration'] });
    }
  };

  const syncRoster = run('roster', async () => {
    let cursor: string | null = null;
    let total = 0;
    let pages = 0;
    do {
      const r = await call('GET', `/assistance/roster?limit=100${cursor ? `&cursor=${encodeURIComponent(cursor)}` : ''}`);
      if (r.status !== 200) return problemText(r);
      const b = r.body as { items: unknown[]; nextCursor: string | null };
      total += b.items.length;
      cursor = b.nextCursor;
      pages += 1;
    } while (cursor && pages < 50);
    return t('demo.assist.rosterDone', { n: total });
  });

  const decideGuarantees = run('guarantees', async () => {
    const { authorityLimit } = await request('/assist/overview', { schema: A.overview });
    const r = await call('GET', '/assistance/guarantees?status=requested&limit=100');
    if (r.status !== 200) return problemText(r);
    const items = (r.body as { items: { id: string; estimatedCost: number; escalated?: boolean }[] }).items.filter((g) => !g.escalated);
    let approved = 0;
    let escalated = 0;
    for (const g of items) {
      const within = g.estimatedCost <= authorityLimit;
      const res = await call(
        'POST',
        `/assistance/guarantees/${g.id}/decide`,
        // eslint-disable-next-line mig/no-cyrillic-ui -- demo data sent to the API, not an interface string
        within ? { decision: 'approve', amount: g.estimatedCost, validUntil: addDaysISO(todayISO(), validityDays) } : { decision: 'escalate', reason: 'Показания подтверждены, сумма выше полномочий ассистанса' },
      );
      if (res.status === 200) {
        if (within) approved++;
        else escalated++;
      }
    }
    return items.length ? t('demo.assist.guaranteesDone', { approved, escalated }) : t('demo.assist.noGuarantees');
  });

  const registries = async () => {
    const r = await call('GET', '/assistance/registries?limit=100');
    if (r.status !== 200) throw new Error(problemText(r));
    return (r.body as { items: { id: string; lines: Line[] }[] }).items;
  };

  const acceptRegistry = run('accept', async () => {
    const reg = (await registries()).find((x) => x.lines.some((l) => l.status === 'pending'));
    if (!reg) return t('demo.assist.noRegistries');
    let ok = 0;
    const pending = reg.lines.filter((l) => l.status === 'pending');
    for (const l of pending) if ((await call('POST', `/assistance/registries/${reg.id}/lines/${l.id}/decide`, { decision: 'accept' })).status === 200) ok++;
    return t('demo.assist.registryDone', { ok, n: pending.length });
  });

  const payClinic = run('pay', async () => {
    const reg = (await registries()).find((x) => x.lines.some((l) => l.status === 'accepted' && !l.payment));
    if (!reg) return t('demo.assist.noUnpaid');
    const lines = reg.lines.filter((l) => l.status === 'accepted' && !l.payment);
    const amount = lines.reduce((s, l) => s + l.amount, 0);
    const r = await call('POST', `/assistance/registries/${reg.id}/payments`, { lineIds: lines.map((l) => l.id), paidAt: todayISO(), amount, paymentOrderNumber: docNumber('paymentOrder', { n: Number(String(Date.now()).slice(-5)) }) });
    return r.status === 200 ? t('demo.assist.payDone', { n: lines.length }) : problemText(r);
  });

  const rebill = run('rebill', async () => {
    const r = await call('POST', '/assistance/rebills', { period: todayISO().slice(0, 7) });
    if (r.status !== 201) return problemText(r);
    const b = r.body as { number: string; lines: unknown[] };
    return t('demo.assist.rebillDone', { number: b.number, n: b.lines.length });
  });

  const buttons: [string, string, () => Promise<void>][] = [
    ['roster', t('demo.assist.roster'), syncRoster],
    ['guarantees', t('demo.assist.guarantees'), decideGuarantees],
    ['accept', t('demo.assist.accept'), acceptRegistry],
    ['pay', t('demo.assist.pay'), payClinic],
    ['rebill', t('demo.assist.rebill'), rebill],
  ];
  return (
    <section className="rounded-card border border-dashed border-warning/60 bg-warning-soft/40 p-4" aria-label={t('demo.assist.label')} data-testid="assist-simulator">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Bot className="h-4 w-4" aria-hidden /> {t('demo.assist.title')}
      </h2>
      <p className="mb-3 text-[12px] text-muted">{t('demo.assist.hint')}</p>
      <div className="flex flex-wrap gap-2">
        {buttons.map(([key, label, fn]) => (
          <Button key={key} size="sm" variant="secondary" loading={busy === key} disabled={!!busy} onClick={() => void fn()}>
            {label}
          </Button>
        ))}
      </div>
      {log.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5 font-mono text-[12px]" data-testid="assist-sim-log" aria-live="polite">
          {log.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
