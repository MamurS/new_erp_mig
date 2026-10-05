/*
 * Demo «МИС клиники» simulator (CLINIC_SPEC §4.9). Makes real integration API calls the way
 * a clinic information system would: it creates its own key through the portal, keeps the
 * secret in memory only and uses the regular /api/integration/v1 endpoints.
 */
import './messages';
import { t, tm } from '@/i18n';
import { useRef, useState } from 'react';
import { useQueryClient } from '@tanstack/react-query';
import { Bot } from 'lucide-react';
import { integrationCall, request, errorMessage, type IntegrationCallResult } from '@/shared/api/client';
import * as C from '@/shared/api/schemas-clinic';
import { INTEGRATION_SCOPES } from '@/shared/integration/schemas';
import { DAY, at, isoDay, startOfDay, tzIso } from '@/mocks/time';
import { Button } from '@/shared/ui/button';

interface Creds {
  clientId: string;
  clientSecret: string;
  token?: string;
}

function problemText(r: IntegrationCallResult): string {
  const b = r.body as { detail?: string; errors?: Record<string, string> } | null;
  const first = b?.errors ? Object.entries(b.errors)[0] : undefined;
  const detail = b?.detail ? tm(b.detail) : t('demo.sim.error');
  return first ? t('demo.sim.problemField', { status: r.status, detail, field: first[0], message: tm(first[1]) }) : t('demo.sim.problem', { status: r.status, detail });
}

export function MisSimulator() {
  const qc = useQueryClient();
  const creds = useRef<Creds | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [log, setLog] = useState<string[]>([]);
  const say = (s: string) => setLog((l) => [s, ...l].slice(0, 8));

  const token = async (): Promise<string> => {
    if (!creds.current) {
      // eslint-disable-next-line mig/no-cyrillic-ui -- demo data sent to the API, not an interface string
      const k = await request('/clinic/integration/keys', { method: 'POST', body: { name: 'Демо-МИС', scopes: [...INTEGRATION_SCOPES], ipAllowlist: '' }, schema: C.keyCreated });
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

  /** Call with a cached token; on 401 (expired or revoked) start over once. */
  const call = async (method: 'GET' | 'POST' | 'PUT', path: string, body?: unknown): Promise<IntegrationCallResult> => {
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
      void qc.invalidateQueries({ queryKey: ['clinic'] });
    }
  };

  const pushSlots = run('slots', async () => {
    const tomorrow = startOfDay(Date.now()) + DAY;
    const slots = [];
    for (let day = 0; day < 7; day++) {
      for (const [h, m] of [[9, 0], [9, 30], [10, 0], [11, 0], [14, 0], [15, 30]] as const) {
        slots.push({ specialty: day % 2 ? 'cardiologist' : 'therapist', startsAt: tzIso(at(tomorrow + day * DAY, h, m)), durationMin: 30, doctorRef: `mis-dr-${day % 3}` });
      }
    }
    const r = await call('PUT', '/slots', { slots });
    return r.status === 200 ? t('demo.mis.slotsDone', { n: slots.length }) : problemText(r);
  });

  const checkPatient = run('check', async () => {
    const { shortCode } = (await request('/__demo/mis-card', { method: 'POST' })) as { shortCode: string };
    const r = await call('POST', '/coverage/check', { qrToken: shortCode });
    if (r.status !== 200) return problemText(r);
    const b = r.body as { person: { fullName: string }; visitId: string };
    return t('demo.mis.checked', { name: b.person.fullName, visit: b.visitId.slice(0, 8) });
  });

  const sendRegistry = run('registry', async () => {
    const { shortCode } = (await request('/__demo/mis-card', { method: 'POST' })) as { shortCode: string };
    const check = await call('POST', '/coverage/check', { qrToken: shortCode });
    if (check.status !== 200) return problemText(check);
    const cov = check.body as { visitId: string; categories: { category: string; status: string }[] };
    const covered = new Set(cov.categories.filter((c) => c.status === 'covered').map((c) => c.category));
    // Prices of the patient's payer (its assistance or MIG).
    const prices = await request('/clinic/price-list', { query: { visitId: cov.visitId }, schema: C.priceList });
    const services = prices.filter((p) => !p.requiresGuarantee && covered.has(p.category) && !/[<>]/.test(p.name));
    if (services.length === 0) return t('demo.mis.noServices');
    const today = isoDay(Date.now());
    const lines = Array.from({ length: 20 }, (_, i) => {
      const s = services[i % services.length]!;
      return { visitId: cov.visitId, serviceDate: today, serviceCode: s.code, icd10: 'J06.9', quantity: 1, price: s.price };
    });
    const r = await call('POST', '/registries', { period: today.slice(0, 7), lines });
    return r.status === 201 ? t('demo.mis.registryDone', { n: lines.length }) : problemText(r);
  });

  const confirmAll = run('confirm', async () => {
    const r = await call('GET', '/appointments?status=requested&limit=50');
    if (r.status !== 200) return problemText(r);
    const items = (r.body as { items: { id: string }[] }).items;
    let ok = 0;
    for (const a of items) if ((await call('POST', `/appointments/${a.id}/confirm`)).status === 200) ok++;
    return items.length ? t('demo.mis.confirmed', { ok, n: items.length }) : t('demo.mis.noRequests');
  });

  return (
    <section className="rounded-card border border-dashed border-warning/60 bg-warning-soft/40 p-4" aria-label={t('demo.mis.label')} data-testid="mis-simulator">
      <h2 className="mb-1 flex items-center gap-2 font-semibold">
        <Bot className="h-4 w-4" aria-hidden /> {t('demo.mis.title')}
      </h2>
      <p className="mb-3 text-[12px] text-muted">{t('demo.mis.hint')}</p>
      <div className="flex flex-wrap gap-2">
        <Button size="sm" variant="secondary" loading={busy === 'slots'} disabled={!!busy} onClick={() => void pushSlots()}>
          {t('demo.mis.slots')}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === 'check'} disabled={!!busy} onClick={() => void checkPatient()}>
          {t('demo.mis.check')}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === 'registry'} disabled={!!busy} onClick={() => void sendRegistry()}>
          {t('demo.mis.registry')}
        </Button>
        <Button size="sm" variant="secondary" loading={busy === 'confirm'} disabled={!!busy} onClick={() => void confirmAll()}>
          {t('demo.mis.confirm')}
        </Button>
      </div>
      {log.length > 0 && (
        <ul className="mt-3 flex flex-col gap-0.5 font-mono text-[12px]" data-testid="mis-log" aria-live="polite">
          {log.map((l, i) => (
            <li key={`${i}-${l}`}>{l}</li>
          ))}
        </ul>
      )}
    </section>
  );
}
