// @vitest-environment node
/*
 * The GOLD brochure texts are approved: any change to them must be deliberate.
 * If the brochure was updated on purpose, rerun `node scripts/import-gold-templates.mjs`
 * and replace PINNED_SHA256 below in the same commit.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { describe, expect, it } from 'vitest';
import { KP_TEMPLATE_VERSION } from '@/shared/domain/kp';
import { GOLD_TEMPLATES, GOLD_TEMPLATE_VERSION } from './gold';
import { KP_TEMPLATES } from '.';

const PINNED_SHA256 = '23829eaf1b483b0c2b2bc81609373c26a9279780922f7e1602d4b4b39155c124';

const sha256 = (s: string) => createHash('sha256').update(s).digest('hex');

describe('GOLD templates', () => {
  it('match the pinned SHA-256 of the approved brochure', () => {
    expect(sha256(JSON.stringify(GOLD_TEMPLATES))).toBe(PINNED_SHA256);
  });

  it('are an exact copy of vendor/gold-brochure-generator/templates.js', () => {
    const raw = readFileSync(resolve(__dirname, '../../../../vendor/gold-brochure-generator/templates.js'), 'utf8').trim();
    const vendor = JSON.parse(raw.slice('window.GOLD_TEMPLATES='.length).replace(/;\s*$/, '')) as Record<string, string[]>;
    expect(Object.keys(vendor).sort()).toEqual(Object.keys(GOLD_TEMPLATES).sort());
    for (const [key, pages] of Object.entries(GOLD_TEMPLATES)) expect(pages, key).toEqual(vendor[key]);
  });

  it('have 16 pages for each of the 6 language/cover combinations, without scripts or handlers', () => {
    const t = KP_TEMPLATES.gold;
    for (const lang of t.languages)
      for (const variant of t.variants) {
        const pages = t.pages[`${lang}-${variant}`];
        expect(pages).toHaveLength(16);
        for (const p of pages) {
          expect(p).not.toMatch(/<script/i);
          expect(p).not.toMatch(/\son[a-z]+\s*=/i);
        }
      }
  });

  it('version is the same in the registry, the generated module and the domain constant', () => {
    expect(GOLD_TEMPLATE_VERSION).toBe('GOLD 09/26');
    expect(KP_TEMPLATES.gold.version).toBe(GOLD_TEMPLATE_VERSION);
    expect(KP_TEMPLATE_VERSION.gold).toBe(GOLD_TEMPLATE_VERSION);
  });
});
