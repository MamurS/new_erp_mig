/*
 * Structure of a stub document template (LIFECYCLE_SPEC §7.1). The structure is real: sections and
 * clauses with ids («4.3»); the texts are stubs until MIG provides them. Replacing a text must not
 * change ids, fields or tables: contracts, decisions and the coverage table refer to clause ids.
 */

export type DocTemplateId = 'contract' | 'endorsement' | 'certificate' | 'claimDecisionLetter';

export interface StubClause {
  /** «4.3»; unique inside the template. Global reference: `${templateId}:${id}`. */
  id: string;
  /** Short heading, conditional until MIG gives the real one. */
  title: string;
  /** Clause text. Stub: «[Текст пункта 4.3 будет предоставлен МИГ]». */
  text: string;
  /** Data line printed under the text, with `{{fields}}`: the values the clause is about. */
  data?: string;
}

export interface StubSection {
  id: string;
  title: string;
  clauses: StubClause[];
  /** A table filled by the renderer (an appendix list or a schedule); see `tables`. */
  table?: string;
}

export interface FieldDef {
  key: string;
  description: string;
  /** Where the value comes from: the screen and the object field. */
  source: string;
}

export interface TableDef {
  id: string;
  title: string;
  columns: string[];
  source: string;
}

export interface DocTemplate {
  id: DocTemplateId;
  name: string;
  version: string;
  /** Only approved templates are pinned by a hash test; stubs are free to change. */
  approved: boolean;
  /** Document heading with fields. */
  heading: string;
  /** Line under the heading (place and date). */
  subheading?: string;
  sections: StubSection[];
  fields: FieldDef[];
  tables: TableDef[];
  /** Signature block: who signs (MIG and/or the client). */
  signatures: 'both' | 'mig' | 'none';
}

export function stubText(id: string): string {
  return `[Текст пункта ${id} будет предоставлен МИГ]`;
}

/** A clause with a stub text. */
export function clause(id: string, title: string, data?: string): StubClause {
  return data ? { id, title, text: stubText(id), data } : { id, title, text: stubText(id) };
}
