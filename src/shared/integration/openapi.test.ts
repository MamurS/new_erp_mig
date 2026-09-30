// @vitest-environment node
/* The committed OpenAPI files must match the zod schemas (regenerate with `npm run build:openapi`). */
import { readFileSync } from 'node:fs';
import { describe, expect, it } from 'vitest';
import { buildOpenApi, toYaml } from './openapi-files';

describe('OpenAPI contract', () => {
  const doc = buildOpenApi();

  it('public/docs/integration/openapi.json is up to date', () => {
    expect(readFileSync('public/docs/integration/openapi.json', 'utf8')).toBe(`${JSON.stringify(doc, null, 2)}\n`);
  });

  it('docs/integration/openapi.yaml is up to date', () => {
    expect(readFileSync('docs/integration/openapi.yaml', 'utf8')).toBe(toYaml(doc));
  });

  it('describes every method of CLINIC_SPEC §6.3', () => {
    const ops = Object.entries(doc.paths ?? {}).flatMap(([p, m]) => Object.keys(m as object).map((k) => `${k.toUpperCase()} ${p}`));
    for (const op of [
      'POST /oauth/token',
      'POST /coverage/check',
      'GET /visits/{visitId}',
      'GET /appointments',
      'POST /appointments/{id}/confirm',
      'POST /appointments/{id}/reschedule',
      'POST /appointments/{id}/decline',
      'PUT /slots',
      'POST /guarantees',
      'GET /guarantees/{id}',
      'POST /guarantees/{id}/documents',
      'POST /registries',
      'GET /registries/{id}',
      'POST /registries/{id}/lines/{lineId}/dispute',
      'GET /payments',
    ]) {
      expect(ops).toContain(op);
    }
  });

  it('describes every assistance method of ASSISTANCE_SPEC §8 in its own section', () => {
    const ops = Object.entries(doc.paths ?? {}).flatMap(([p, m]) => Object.keys(m as object).map((k) => `${k.toUpperCase()} ${p}`));
    for (const op of [
      'GET /assistance/roster',
      'GET /assistance/insured/{id}/limits',
      'POST /assistance/cases',
      'PATCH /assistance/cases/{id}',
      'GET /assistance/appointments',
      'POST /assistance/appointments/{id}/confirm',
      'POST /assistance/appointments/{id}/reschedule',
      'POST /assistance/appointments/{id}/decline',
      'GET /assistance/guarantees',
      'POST /assistance/guarantees/{id}/decide',
      'GET /assistance/registries',
      'POST /assistance/registries/{id}/lines/{lineId}/decide',
      'POST /assistance/registries/{id}/payments',
      'POST /assistance/rebills',
      'GET /assistance/rebills/{id}',
      'POST /assistance/rebills/{id}/lines/{lineId}/dispute',
    ]) {
      expect(ops).toContain(op);
    }
  });
});
