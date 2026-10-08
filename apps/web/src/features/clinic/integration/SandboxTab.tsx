/*
 * Sandbox (CLINIC_SPEC §4.8.6): real calls to the integration API with the clinic's own key.
 * The secret lives only in this component's state and is never stored or logged.
 */
import { useMemo, useState } from 'react';
import { z } from 'zod';
import { integrationCall, type IntegrationCallResult } from '@/shared/api/client';
import { useIntegrationKeys } from '@/shared/api/queries/clinic';
import { buildSandboxRequest, sandboxDefaults, type SandboxParam } from '@/shared/integration/sandbox';
import { usePartner } from './partner';
import { Button } from '@/shared/ui/button';
import { Chip } from '@/shared/ui/chips';
import { Field, Input, Select, Textarea } from '@/shared/ui/input';
import { toast } from '@/shared/ui/toast';
import { Panel } from '../components';
import { t, tm, msg, defineLabels } from '@/i18n';

const secretSchema = z.object({ clientId: z.string().trim().min(1, msg('clinic.sandbox.pickKey')).max(80), clientSecret: z.string().trim().min(8, msg('clinic.sandbox.pasteSecret')).max(200) });
function statusKind(status: number) {
  return status < 300 ? 'success' : status < 500 ? 'warning' : 'danger';
}

const WHERE = defineLabels('clinic.sandbox.where', ['path', 'query', 'body'] as const);

function ParamField({ param: p, value, error, onChange }: { param: SandboxParam; value: string; error?: string; onChange: (v: string) => void }) {
  const label = t(p.required ? 'clinic.sandbox.paramRequired' : 'clinic.sandbox.param', { name: p.name, where: WHERE[p.in] });
  return (
    <Field label={label} error={tm(error)} hint={p.hint}>
      {(a) =>
        p.kind === 'select' ? (
          <Select {...a} value={value} onChange={(e) => onChange(e.target.value)}>
            {(p.options ?? []).map((o) => (
              <option key={o} value={o}>
                {o || '—'}
              </option>
            ))}
          </Select>
        ) : p.kind === 'json' ? (
          <Textarea {...a} rows={7} className="font-mono text-[12px]" maxLength={50_000} value={value} onChange={(e) => onChange(e.target.value)} />
        ) : (
          <Input
            {...a}
            autoComplete="off"
            spellCheck={false}
            maxLength={p.kind === 'uuid' ? 36 : 1000}
            inputMode={p.kind === 'number' ? 'numeric' : undefined}
            placeholder={p.kind === 'uuid' ? 'UUID' : p.kind === 'date' ? t('clinic.sandbox.datePlaceholder') : undefined}
            value={value}
            onChange={(e) => onChange(e.target.value)}
          />
        )
      }
    </Field>
  );
}

export function SandboxTab() {
  const partner = usePartner();
  const METHODS = partner.sandbox;
  const keys = useIntegrationKeys(partner.base);
  const active = useMemo(() => (keys.data ?? []).filter((k) => !k.revokedAt), [keys.data]);
  const [clientId, setClientId] = useState('');
  const [secret, setSecret] = useState('');
  const [token, setToken] = useState<string | null>(null);
  const [tokenError, setTokenError] = useState<string | null>(null);
  const [methodId, setMethodId] = useState(METHODS[0]!.id);
  const method = METHODS.find((m) => m.id === methodId) ?? METHODS[0]!;
  const [values, setValues] = useState<Record<string, string>>(() => sandboxDefaults(METHODS[0]!));
  const [errors, setErrors] = useState<Record<string, string>>({});
  const [idemKey, setIdemKey] = useState('');
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<{ request: string; response: IntegrationCallResult } | null>(null);
  const selectedId = clientId || active[0]?.clientId || '';

  const getToken = async () => {
    const parsed = secretSchema.safeParse({ clientId: selectedId, clientSecret: secret });
    if (!parsed.success) {
      setTokenError(parsed.error.issues[0]?.message ?? t('clinic.sandbox.checkData'));
      return;
    }
    setBusy(true);
    setTokenError(null);
    try {
      const r = await integrationCall('POST', '/oauth/token', { form: true, body: { grant_type: 'client_credentials', client_id: parsed.data.clientId, client_secret: parsed.data.clientSecret } });
      const tok = (r.body as { access_token?: unknown } | null)?.access_token;
      if (r.status === 200 && typeof tok === 'string') {
        setToken(tok);
        setSecret('');
        toast.success(t('clinic.sandbox.tokenToast'));
      } else {
        setToken(null);
        setTokenError((r.body as { detail?: string } | null)?.detail ?? t('clinic.sandbox.httpError', { status: r.status }));
      }
    } finally {
      setBusy(false);
    }
  };

  const pick = (id: string) => {
    const m = METHODS.find((x) => x.id === id);
    if (!m) return;
    setMethodId(id);
    setValues(sandboxDefaults(m));
    setErrors({});
    setResult(null);
  };

  const send = async () => {
    const req = buildSandboxRequest(method, values);
    if (!req.ok) {
      setErrors(req.errors);
      return;
    }
    setErrors({});
    const path = req.path;
    const parsedBody = req.body;
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
        <Panel title={t('clinic.sandbox.step1')}>
          <div className="flex flex-col gap-3 p-4">
            {active.length === 0 ? (
              <p className="text-[14px] text-muted">{t('clinic.sandbox.noKeys')}</p>
            ) : (
              <>
                <Field label={t('clinic.logs.key')}>
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
                <Field label="client_secret" error={tokenError ? tm(tokenError) : undefined} hint={t('clinic.sandbox.secretHint')}>
                  {(a) => <Input {...a} type="password" autoComplete="off" maxLength={200} value={secret} onChange={(e) => setSecret(e.target.value)} />}
                </Field>
                <div className="flex items-center gap-2">
                  <Button loading={busy && !token} onClick={() => void getToken()}>
                    {t('clinic.sandbox.getToken')}
                  </Button>
                  {token && <Chip kind="success">{t('clinic.sandbox.tokenReceived')}</Chip>}
                </div>
              </>
            )}
          </div>
        </Panel>
        <Panel title={t('clinic.sandbox.step2')}>
          <div className="flex flex-col gap-3 p-4">
            <Field label={t('clinic.logs.method')}>
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
              <ParamField key={`${methodId}-${p.name}`} param={p} value={values[p.name] ?? ''} error={errors[p.name]} onChange={(v) => setValues((s) => ({ ...s, [p.name]: v }))} />
            ))}
            {method.method === 'POST' && (
              <Field label={t('clinic.sandbox.idempotency')}>{(a) => <Input {...a} autoComplete="off" maxLength={128} value={idemKey} onChange={(e) => setIdemKey(e.target.value)} />}</Field>
            )}
            <div>
              <Button loading={busy && !!token} disabled={!token} onClick={() => void send()}>
                {t('clinic.sandbox.run')}
              </Button>
            </div>
          </div>
        </Panel>
      </div>
      <Panel title={t('clinic.logs.response')}>
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
          <p className="p-4 text-[14px] text-muted">{t('clinic.sandbox.placeholder')}</p>
        )}
      </Panel>
    </div>
  );
}
