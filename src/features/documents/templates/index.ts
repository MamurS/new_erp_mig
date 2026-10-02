/*
 * Registry of document templates and the catalog of their clauses. Claim decisions, the coverage table
 * and contract edits refer to clauses by a global id `${templateId}:${clauseId}` (e.g. `contract:4.3`).
 */
import { CONTRACT_TEMPLATE } from './contract';
import { ENDORSEMENT_TEMPLATE } from './endorsement';
import { CERTIFICATE_TEMPLATE } from './certificate';
import { CLAIM_DECISION_LETTER_TEMPLATE } from './claimDecisionLetter';
import type { DocTemplate, DocTemplateId, StubClause } from './types';

export type { DocTemplate, DocTemplateId, StubClause, StubSection, FieldDef, TableDef } from './types';
export { stubText } from './types';

export const DOC_TEMPLATES: Record<DocTemplateId, DocTemplate> = {
  contract: CONTRACT_TEMPLATE,
  endorsement: ENDORSEMENT_TEMPLATE,
  certificate: CERTIFICATE_TEMPLATE,
  claimDecisionLetter: CLAIM_DECISION_LETTER_TEMPLATE,
};

export interface CatalogClause extends StubClause {
  /** Global id: `contract:4.3`. */
  ref: string;
  templateId: DocTemplateId;
  templateName: string;
  section: string;
}

export const CLAUSE_CATALOG: CatalogClause[] = Object.values(DOC_TEMPLATES).flatMap((t) =>
  t.sections.flatMap((s) => s.clauses.map((c) => ({ ...c, ref: `${t.id}:${c.id}`, templateId: t.id, templateName: t.name, section: s.title }))),
);

export function clauseByRef(ref: string): CatalogClause | undefined {
  return CLAUSE_CATALOG.find((c) => c.ref === ref);
}

/** Clauses a claim decision may refer to (refusal or partial approval): the contract's coverage and settlement sections. */
export const DECISION_CLAUSES: CatalogClause[] = CLAUSE_CATALOG.filter((c) => c.templateId === 'contract' && /^(4|8)\./.test(c.id));

/** «п. 4.3 договора «Исключения из страхового покрытия»». Plain text. */
export function clauseLabel(ref: string): string {
  const c = clauseByRef(ref);
  if (!c) return ref;
  const where = c.templateId === 'contract' ? 'договора' : `«${c.templateName}»`;
  return `п. ${c.id} ${where} «${c.title}»`;
}

/** Short reference for people: «п. 4.3». */
export function clauseShort(ref: string): string {
  const c = clauseByRef(ref);
  return c ? `п. ${c.id}` : ref;
}

export function clausesOf(templateId: DocTemplateId): StubClause[] {
  return DOC_TEMPLATES[templateId].sections.flatMap((s) => s.clauses);
}
