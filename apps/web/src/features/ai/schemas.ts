/*
 * Structured output of a provider is always validated (AI_COVERAGE_SPEC §3.3): unknown codes are
 * dropped, confidences are clamped, an invalid answer becomes «Нужна проверка специалиста».
 */
import { z } from 'zod';
import type { NormalizeOutput } from './provider';

const normalizeSchema = z.object({
  codes: z.array(z.object({ code: z.string().trim().min(1).max(20), confidence: z.number().finite() })).max(20),
  icd10: z.array(z.string().trim().regex(/^[A-Z]\d{2}(\.\d{1,2})?$/)).max(10).default([]),
});

const explainSchema = z.object({ text: z.string().trim().min(1).max(1200) });

/** null — the answer is invalid; otherwise codes known to the catalog only, highest confidence first. */
export function checkNormalizeOutput(raw: unknown, known: (code: string) => boolean): NormalizeOutput | null {
  const parsed = normalizeSchema.safeParse(raw);
  if (!parsed.success) return null;
  const seen = new Set<string>();
  const codes = parsed.data.codes
    .filter((c) => known(c.code) && !seen.has(c.code) && seen.add(c.code))
    .map((c) => ({ code: c.code, confidence: Math.min(1, Math.max(0, c.confidence)) }))
    .sort((a, b) => b.confidence - a.confidence);
  return { codes, icd10: parsed.data.icd10 };
}

export function checkExplainOutput(raw: unknown): string | null {
  const parsed = explainSchema.safeParse(raw);
  return parsed.success ? parsed.data.text : null;
}
