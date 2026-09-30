/*
 * Sandbox (CLINIC_SPEC §4.8.6): real calls to the integration API with the clinic's own key.
 * The secret lives only in this component's state and is never stored or logged.
 */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { integrationCall, type IntegrationCallResult } from '@/shared/api/client';
import { useIntegrationKeys } from '@/shared/api/queries/clinic';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { Panel } from '../components';

interface SandboxMethod {
  id: string;
  method: 'GET' | 'POST' | 'PUT';
  path: string;
  label: string;
  params: string[];
  body?: unknown;
}

const METHODS: SandboxMethod[] = [
  { id: 'coverage', method: 'POST', path: '/coverage/check', label: 'Проверить пациента', params: [], body: { qrToken: 'ABCD-EFGH' } },
  { id: 'visit', method: 'GET', path: '/visits/{visitId}', label: 'Визит', params: ['visitId'] },
  { id: 'appointments', method: 'GET', path: '/appointments?status=requested&limit=20', label: 'Записи', params: [] },
  { id: 'confirm', method: 'POST', path: '/appointments/{id}/confirm', label: 'Подтвердить запись', params: ['id'] },
  { id: 'reschedule', method: 'POST', path: '/appointments/{id}/reschedule', label: 'Предложить другое время', params: ['id'], body: { startsAt: '2026-10-02T10:30:00+05:00' } },
  { id: 'decline', method: 'POST', path: '/appointments/{id}/decline', label: 'Отклонить запись', params: ['id'], body: { reason: 'Врач в отпуске' } },
  { id: 'slots', method: 'PUT', path: '/slots', label: 'Заменить слоты', params: [], body: { slots: [{ specialty: 'therapist', startsAt: '2026-10-02T09:00:00+05:00', durationMin: 30, doctorRef: 'dr-17' }] } },
  { id: 'guarantee-create', method: 'POST', path: '/guarantees', label: 'Запросить ГП', params: [], body: { visitId: '', serviceCode: 'DG-310', icd10: 'G43.9', estimatedCost: 1800000 } },
  { id: 'guarantee', method: 'GET', path: '/guarantees/{id}', label: 'Гарантийное письмо', params: ['id'] },
  { id: 'registry-create', method: 'POST', path: '/registries', label: 'Отправить реестр', params: [], body: { period: '2026-09', lines: [{ visitId: '', serviceDate: '2026-09-30', serviceCode: 'TH-101', icd10: 'J06.9', quantity: 1, price: 180000 }] } },
  { id: 'registry', method: 'GET', path: '/registries/{id}', label: 'Реестр', params: ['id'] },
  { id: 'payments', method: 'GET', path: '/payments', label: 'Оплаты', params: [] },
];

const secretSchema = z.object({ clientId: z.string().trim().min(1, 'Выберите ключ').max(80), clientSecret: z.string().trim().min(8, 'Вставьте client_secret').max(200) });
const paramSchema = z.string().trim().regex(/^[0-9a-f-]{36}$/i, 'Нужен UUID');
const bodySchema = z
  .string()
  .max(50_000, 'Тело запроса слишком большое')
  .transform((s, ctx) => {
    try {
      return s.trim() ? (JSON.parse(s) as unknown) : undefined;
    } catch {
      ctx.addIssue({ code: z.ZodIssueCode.custom, message: 'Тело — не корректный JSON' });
      return z.NEVER;
    }
  });

function statusKind(status: number) {
  return status < 300 ? 'success' : status < 500 ? 'warning' : 'danger';
}

export function SandboxTab() {
  const keys = useIntegrationKeys();
  const active = useMemo(() => (keys.data ?? []).filter((k) => !k.revokedAt), [keys.data]);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [methodId, setMethodId] = useState(METHODS[0]!.id);
  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0]!;
  const [params, setParams] = useState<Record<string, string>>({});
  const [body, setBody] = useState(JSON.stringify(METHODS[0]!.body, null, 2));
  const [idemKey, setIdemKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ request: string; response: IntegrationCallResult } | null>(null);
  const selectedId = clientId || active[0]?.clientId || '';

  const getToken = async () => {
    const parsed = secretSchema.safeParse({ clientId: selectedId, clientSecret: secret });
    if (!parsed.success) {
      setTokenError(parsed.error.issues[0]?.message ?? 'Проверьте данные');
      return;
    }
    setBusy(true);
    setTokenError(null);
    try {
      const r = await integrationCall('POST', '/oauth/token', { form: true, body: { grant_type: 'client_credentials', client_id: parsed.data.clientId, client_secret: parsed.data.clientSecret } });
      const t = (r.body as { access_token?: unknown } | null)?.access_token;
      if (r.status === 200 && typeof t === 'string') {
        setToken(t);
        setSecret('');
        toast.success('Токен получен на 15 минут');
      } else {
        setToken(null);
        setTokenError((r.body as { detail?: string } | null)?.detail ?? `Ошибка ${r.status}`);
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: string) => {
    const m = METHODS.find((x) => x.id === id);
    if (!m) return;
    setMethodId(id);
    setBody(m.body === undefined ? '' : JSON.stringify(m.body, null, 2));
    setResult(null);
  };

  const send = async () => {
    let path = method.path;
    for (const p of method.params) {
      const v = paramSchema.safeParse(params[p] ?? '');
      if (!v.success) {
        toast.error(`${p}: ${v.error.issues[0]?.message ?? 'ошибка'}`);
        return;
      }
      path = path.replace(`{${p}}`, v.data);
    }
    let parsedBody: unknown;
    if (method.method !== 'GET') {
      const b = bodySchema.safeParse(body);
      if (!b.success) {
        toast.error(b.error.issues[0]?.message ?? 'Ошибка в теле запроса');
        return;
      }
      parsedBody = b.data;
    }
    const headers: Record<string, string> = {};
    const idem = idemKey.trim().slice(0, 128);
    if (idem && method.method === 'POST') headers['Idempotency-Key'] = idem;
    setBusy(true);
    try {
      const response = await integrationCall(method.method, path, { token: token ?? undefined, body: parsedBody, headers });
      const reqText = [`${method.method} /api/integration/v1${path}`, 'Authorization: Bearer ••••', ...Object.entries(headers).map(([k, v]) => `${k}: ${v}`), parsedBody !== undefined ? `\n${JSON.stringify(parsedBody, null, 2)}` : '']
        .filter(Boolean)
        .join('\n');
      setResult({ request: reqText, response });
    } finally {
      setBusy(false);
    }
  };

  return (
    <div className="grid gap-4 lg:grid-cols-2" data-testid="sandbox">
      <div className="flex flex-col gap-4">
        <Panel title="1. Токен">
          <div className="flex flex-col gap-3 p-4">
            {active.length === 0 ? (
              <p className="text-[14px] text-muted">Создайте ключ на вкладке «Ключи API».</p>
            ) : (
              <>
                <Field label="Ключ">
                  {(a) => (
                    <Select {...a} value={selectedId} onChange={(e) => setClientId(e.target.value)}>
                      {active.map((k) => (
                        <option key={k.id} value={k.clientId}>
                          {k.name} · {k.clientId}
                        </option>
                      ))}
                    </Select>
                  )}
                </Field>
                <Field label="client_secret" error={tokenError ?? undefined} hint="Секрет не сохраняется — вставьте его из менеджера паролей">
                  {(a) => <Input {...a} type="password" autoComplete="off" maxLength={200} value={secret} onChange={(e) => setSecret(e.target.value)} />}
                </Field>
                <div className="flex items-center gap-2">
                  <Button loading={busy && !token} onClick={() => void getToken()}>
                    Получить токен
                  </Button>
                  {token && <Chip kind="success">Токен получен</Chip>}
                </div>
              </>
            )}
          </div>
        </Panel>
        <Panel title="2. Запрос">
          <div className="flex flex-col gap-3 p-4">
            <Field label="Метод">
              {(a) => (
                <Select {...a} value={methodId} onChange={(e) => pick(e.target.value)}>
                  {METHODS.map((m) => (
                    <option key={m.id} value={m.id}>
                      {m.method} {m.path} — {m.label}
                    </option>
                  ))}
                </Select>
              )}
            </Field>
            {method.params.map((p) => (
              <Field key={`${methodId}-${p}`} label={p}>
                {(a) => <Input {...a} autoComplete="off" maxLength={36} value={params[p] ?? ''} onChange={(e) => setParams((s) => ({ ...s, [p]: e.target.value }))} placeholder="UUID" />}
              </Field>
            ))}
            {method.method !== 'GET' && (
              <>
                <Field label="Тело запроса (JSON)">{(a) => <Textarea {...a} rows={8} className="font-mono text-[12px]" maxLength={50_000} value={body} onChange={(e) => setBody(e.target.value)} />}</Field>
                {method.method === 'POST' && (
                  <Field label="Idempotency-Key (необязательно)">{(a) => <Input {...a} autoComplete="off" maxLength={128} value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />}</Field>
                )}
              </>
            )}
            <div>
              <Button loading={busy && !!token} disabled={!token} onClick={() => void send()}>
                Отправить
              </Button>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title="Ответ">
        {result ? (
          <div className="flex flex-col gap-3 p-4" data-testid="sandbox-result">
            <pre className="overflow-x-auto rounded-btn bg-rail p-3 font-mono text-[12px]">{result.request}</pre>
            <div className="flex flex-wrap items-center gap-2">
              <span data-testid="sandbox-status">
                <Chip kind={statusKind(result.response.status)}>{result.response.status}</Chip>
              </span>
              {result.response.requestId && <code className="text-[12px] text-muted">X-Request-Id: {result.response.requestId}</code>}
            </div>
            <pre className="max-h-[480px] overflow-auto rounded-btn bg-[#0f172a] p-3 font-mono text-[12px] text-[#e2e8f0]">
              {Object.entries(result.response.headers)
                .map(([k, v]) => `${k}: ${v}`)
                .join('\n')}
              {'\n\n'}
              {typeof result.response.body === 'string' ? result.response.body : JSON.stringify(result.response.body, null, 2)}
            </pre>
          </div>
        ) : (
          <p className="p-4 text-[14px] text-muted">Получите токен, выберите метод и отправьте запрос — здесь появится ответ.</p>
        )}
      </Panel>
    </div>
  );
}
