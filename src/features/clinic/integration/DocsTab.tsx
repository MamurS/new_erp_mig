/* API documentation generated from the OpenAPI document (CLINIC_SPEC §4.8.5). Rendered as text only. */
import { useQuery } from '@tanstack/react-query';
import { fetchPublicJson } from '@/shared/api/client';
import { cn } from '@/shared/lib/cn';
import { QueryState, SkeletonRows } from '@/shared/ui/states';
import { Panel } from '../components';
import { usePartner } from './partner';

interface Operation {
  summary?: string;
  description?: string;
  tags?: string[];
  security?: Record<string, string[]>[];
  parameters?: { name: string; in: string; required?: boolean; description?: string }[];
  requestBody?: { content?: Record<string, { schema?: { example?: unknown } }> };
  responses?: Record<string, { description?: string }>;
}
interface OpenApiDoc {
  info: { title: string; version: string; description?: string };
  servers?: { url: string }[];
  paths: Record<string, Record<string, Operation>>;
}

const METHOD_TONE: Record<string, string> = { get: 'bg-sky text-sky-text', post: 'bg-success-soft text-success-text', put: 'bg-warning-soft text-warning-text' };

function curlFor(base: string, method: string, path: string, op: Operation): string {
  const url = `https://erp.mig.uz${base}${path}`;
  const lines = [`curl -X ${method.toUpperCase()} '${url}'`];
  if (path === '/oauth/token') {
    lines.push("  -H 'Content-Type: application/x-www-form-urlencoded'");
    lines.push("  -d 'grant_type=client_credentials&client_id=$CLIENT_ID&client_secret=$CLIENT_SECRET'");
    return lines.join(' \\\n');
  }
  lines.push('  -H "Authorization: Bearer $ACCESS_TOKEN"');
  const example = op.requestBody?.content?.['application/json']?.schema?.example;
  if (method === 'post' && path !== '/guarantees/{id}/documents') lines.push("  -H 'Idempotency-Key: 4f1c…'");
  if (op.requestBody?.content?.['multipart/form-data']) lines.push("  -F 'files=@referral.pdf' -F 'comment=Направление'");
  else if (example !== undefined) {
    lines.push("  -H 'Content-Type: application/json'");
    lines.push(`  -d '${JSON.stringify(example)}'`);
  }
  return lines.join(' \\\n');
}

const VERIFY_SAMPLES: [string, string][] = [
  [
    'Python',
    `import hmac, hashlib, time

def verify(secret: str, header: str, raw_body: bytes) -> bool:
    parts = dict(p.split("=", 1) for p in header.split(","))
    t, v1 = int(parts["t"]), parts["v1"]
    if abs(time.time() - t) > 300:          # старше 5 минут — повтор
        return False
    expected = hmac.new(secret.encode(), f"{t}.".encode() + raw_body, hashlib.sha256).hexdigest()
    return hmac.compare_digest(expected, v1)`,
  ],
  [
    'C#',
    `using System.Security.Cryptography; using System.Text;

static bool Verify(string secret, string header, string rawBody) {
    var parts = header.Split(',').Select(p => p.Split('=', 2)).ToDictionary(p => p[0], p => p[1]);
    var t = long.Parse(parts["t"]);
    if (Math.Abs(DateTimeOffset.UtcNow.ToUnixTimeSeconds() - t) > 300) return false;
    using var h = new HMACSHA256(Encoding.UTF8.GetBytes(secret));
    var expected = Convert.ToHexString(h.ComputeHash(Encoding.UTF8.GetBytes($"{t}.{rawBody}"))).ToLowerInvariant();
    return CryptographicOperations.FixedTimeEquals(Encoding.ASCII.GetBytes(expected), Encoding.ASCII.GetBytes(parts["v1"]));
}`,
  ],
  [
    'PHP',
    `function verify(string $secret, string $header, string $rawBody): bool {
    parse_str(str_replace(',', '&', $header), $p);
    if (abs(time() - (int)$p['t']) > 300) return false;
    $expected = hash_hmac('sha256', $p['t'] . '.' . $rawBody, $secret);
    return hash_equals($expected, $p['v1']);
}`,
  ],
];

const PROBLEM_EXAMPLE = `HTTP/1.1 422 Unprocessable Content
Content-Type: application/problem+json
X-Request-Id: 7d0c2c4e-…

{
  "type": "https://mig.uz/problems/validation",
  "title": "Unprocessable Content",
  "status": 422,
  "detail": "Реестр не прошёл проверки",
  "errors": { "lines[0]": "Цена выше прайса договора (180000)" }
}`;

function Code({ children }: { children: string }) {
  return <pre className="overflow-x-auto rounded-btn bg-[#0f172a] p-3 font-mono text-[12px] leading-relaxed text-[#e2e8f0]">{children}</pre>;
}

export function DocsTab() {
  const partner = usePartner();
  const q = useQuery({ queryKey: ['clinic', 'openapi'], queryFn: () => fetchPublicJson('/docs/integration/openapi.json') as Promise<OpenApiDoc>, staleTime: Infinity });
  return (
    <QueryState query={q} skeleton={<SkeletonRows rows={8} />}>
      {(doc) => {
        const base = doc.servers?.[0]?.url ?? '/api/integration/v1';
        const ops = Object.entries(doc.paths).flatMap(([path, methods]) => Object.entries(methods).map(([method, op]) => ({ path, method, op })));
        const tags = [...new Set(ops.flatMap((o) => o.op.tags ?? ['Прочее']))].filter(partner.docsTag);
        return (
          <div className="flex flex-col gap-4" data-testid="api-docs">
            <Panel title={`${doc.info.title} · v${doc.info.version}`}>
              <div className="flex flex-col gap-2 p-4 text-[14px]">
                <p>{doc.info.description}</p>
                <p>
                  Базовый адрес: <code>{base}</code>. Авторизация: OAuth 2.0 client credentials — <code>POST /oauth/token</code> с <code>client_id</code> и <code>client_secret</code>, токен действует 15 минут. Пагинация курсорная:
                  <code> ?cursor=&amp;limit=</code>.
                </p>
                <p>
                  Контракт для бэкенда: <code>docs/integration/openapi.yaml</code>, JSON — <a className="text-accent-text underline" href="/docs/integration/openapi.json" download>openapi.json</a>.
                </p>
              </div>
            </Panel>
            {tags.map((tag) => (
              <Panel key={tag} title={tag}>
                <ul className="divide-y divide-border-soft">
                  {ops
                    .filter((o) => (o.op.tags ?? ['Прочее']).includes(tag))
                    .map(({ path, method, op }) => (
                      <li key={`${method} ${path}`} className="flex flex-col gap-2 px-4 py-3">
                        <div className="flex flex-wrap items-center gap-2">
                          <span className={cn('rounded-btn px-2 py-0.5 font-mono text-[12px] font-bold uppercase', METHOD_TONE[method] ?? 'bg-rail')}>{method}</span>
                          <code className="font-semibold">{path}</code>
                          <span className="text-muted">{op.summary}</span>
                          {op.security?.[0] && Object.values(op.security[0])[0]?.map((s) => (
                            <span key={s} className="rounded-btn bg-rail px-1.5 text-[11px] text-muted">
                              {s}
                            </span>
                          ))}
                        </div>
                        {op.description && <p className="text-[13px] text-muted">{op.description}</p>}
                        {op.parameters && op.parameters.length > 0 && (
                          <p className="text-[13px]">
                            Параметры:{' '}
                            {op.parameters.map((p) => (
                              <code key={`${p.in}-${p.name}`} className="mr-2">
                                {p.name}
                                <span className="text-muted"> ({p.in}{p.required ? ', обязательный' : ''})</span>
                              </code>
                            ))}
                          </p>
                        )}
                        <Code>{curlFor(base, method, path, op)}</Code>
                        <p className="text-[12px] text-muted">
                          Ответы:{' '}
                          {Object.entries(op.responses ?? {})
                            .map(([code, r]) => `${code} — ${r.description ?? ''}`)
                            .join(' · ')}
                        </p>
                      </li>
                    ))}
                </ul>
              </Panel>
            ))}
            <Panel title="Формат ошибок">
              <div className="flex flex-col gap-2 p-4 text-[14px]">
                <p>
                  Ошибки — <code>application/problem+json</code> (RFC 9457): <code>type</code>, <code>title</code>, <code>status</code>, <code>detail</code>, <code>errors</code>. Сообщайте в поддержку значение <code>X-Request-Id</code>.
                </p>
                <Code>{PROBLEM_EXAMPLE}</Code>
              </div>
            </Panel>
            <Panel title="Вебхуки и проверка подписи">
              <div className="flex flex-col gap-3 p-4 text-[14px]">
                <p>
                  Тело события: <code>{'{ "id", "type", "createdAt", "objectId" }'}</code> — без персональных и медицинских данных. Заголовок <code>MIG-Signature: t=&#123;unix&#125;,v1=&#123;hex&#125;</code>, где v1 = HMAC-SHA256(секрет, «t.сырое_тело»). Отвечайте 2xx в течение 10 секунд; иначе повторы через 1, 5, 30 минут, 2 и 12 часов.
                </p>
                {VERIFY_SAMPLES.map(([lang, code]) => (
                  <div key={lang}>
                    <h3 className="mb-1 font-semibold">{lang}</h3>
                    <Code>{code}</Code>
                  </div>
                ))}
              </div>
            </Panel>
          </div>
        );
      }}
    </QueryState>
  );
}
