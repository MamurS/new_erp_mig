/* Serialisation of the OpenAPI document for scripts/build-openapi.mjs and its freshness test. */
export { buildOpenApi } from './openapi';

const PLAIN = /^[A-Za-z_][A-Za-z0-9_./-]*$/;
const RESERVED = new Set(['true', 'false', 'null', 'yes', 'no', 'on', 'off', '~']);

function scalar(v: unknown): string {
  if (v === null || v === undefined) return 'null';
  if (typeof v === 'number' || typeof v === 'boolean') return String(v);
  const s = String(v);
  // Plain style only for simple identifiers; everything else is a JSON string, which is valid YAML.
  return PLAIN.test(s) && !RESERVED.has(s.toLowerCase()) ? s : JSON.stringify(s);
}

function key(k: string): string {
  return PLAIN.test(k) && !RESERVED.has(k.toLowerCase()) ? k : JSON.stringify(k);
}

/** Minimal deterministic YAML 1.2 emitter for JSON-compatible data (block style). */
export function toYaml(value: unknown, indent = 0): string {
  const pad = ' '.repeat(indent);
  if (Array.isArray(value)) {
    if (value.length === 0) return `${pad}[]\n`;
    return value
      .map((item) => {
        if (item !== null && typeof item === 'object' && Object.keys(item).length > 0) {
          const inner = toYaml(item, indent + 2);
          return `${pad}- ${inner.slice(indent + 2)}`;
        }
        return `${pad}- ${item !== null && typeof item === 'object' ? (Array.isArray(item) ? '[]' : '{}') : scalar(item)}\n`;
      })
      .join('');
  }
  if (value !== null && typeof value === 'object') {
    const entries = Object.entries(value as Record<string, unknown>).filter(([, v]) => v !== undefined);
    if (entries.length === 0) return `${pad}{}\n`;
    return entries
      .map(([k, v]) => {
        if (v !== null && typeof v === 'object' && (Array.isArray(v) ? v.length > 0 : Object.keys(v).length > 0)) {
          return `${pad}${key(k)}:\n${toYaml(v, indent + 2)}`;
        }
        const empty = v !== null && typeof v === 'object' ? (Array.isArray(v) ? '[]' : '{}') : scalar(v);
        return `${pad}${key(k)}: ${empty}\n`;
      })
      .join('');
  }
  return `${pad}${scalar(value)}\n`;
}
