/*
 * Values and tables of the stub documents from API data. Pure: the same functions feed the editor
 * preview, the print to PDF and (later) the backend renderer.
 */
import type { ContractView, EndorsementView, CertificateView, ClaimLetter } from '@/shared/types/dto';
import type { LimitCategory } from '@/shared/types';
import { ACTIVATION_RULE_LABEL, PAYMENT_FREQUENCY_LABEL } from '@/shared/domain/contracts';
import { DECISION_KIND_LABEL } from '@/shared/domain/settlement';
import { translate, type I18nKey } from '@/i18n';
import { formatDateDoc as formatDate, formatMoneyDoc as formatMoney } from '@/shared/lib/format';
import { PROGRAMS } from '@/shared/domain/programs';
import { MIG_REQUISITES, MIG_RULES_REF } from './mig';
import type { StubRenderInput } from './render';

/**
 * Documents keep their own language (Russian) whatever the interface language is: labels are read
 * from the Russian dictionary, dates and money use the fixed document formats.
 */
const docLabel = (prefix: 'labels.limitCategory' | 'labels.program' | 'labels.role', id: string): string =>
  translate('ru', `${prefix}.${id}` as I18nKey);


const clientName = (c: { legalForm: string; name: string }) => `${c.legalForm} «${c.name}»`;
const sideLine = (s: ContractView['signing']['mig']) =>
  s ? `${s.signerName} · ${s.method === 'eimzo' ? `ЭЦП, сертификат ${s.certificate?.serial ?? ''}` : s.method === 'edo' ? `ЭДО ${s.edoProvider ?? ''}` : s.method === 'scan' ? 'скан проверен' : 'на бумаге'} · ${formatDate(s.signedAt)}` : undefined;

export function contractDocument(c: ContractView, opts: { showChanges?: boolean } = {}): StubRenderInput {
  const r = c.client.requisites;
  const limits = PROGRAMS[c.params.program].limits;
  const values: Record<string, string> = {
    'contract.number': c.number,
    'contract.date': formatDate(c.createdAt),
    'contract.version': String(c.version),
    'contract.startDate': formatDate(c.params.startDate),
    'contract.endDate': formatDate(c.params.endDate),
    'contract.activationRule': ACTIVATION_RULE_LABEL[c.params.activationRule],
    'contract.paymentFrequency': PAYMENT_FREQUENCY_LABEL[c.params.paymentFrequency].toLowerCase(),
    'contract.rulesRef': MIG_RULES_REF,
    'mig.name': MIG_REQUISITES.name,
    'mig.inn': MIG_REQUISITES.inn,
    'mig.address': MIG_REQUISITES.address,
    'mig.bank': MIG_REQUISITES.bank,
    'mig.account': MIG_REQUISITES.account,
    'mig.mfo': MIG_REQUISITES.mfo,
    'client.name': clientName(c.client),
    'client.inn': c.client.inn,
    'client.signatory.name': c.params.clientSignatory.name,
    'client.signatory.position': c.params.clientSignatory.position.toLowerCase(),
    'client.signatory.basis': c.params.clientSignatory.basis,
    'program.name': docLabel('labels.program', c.params.program),
    'premium.employee': formatMoney(c.params.premiumEmployee),
    'premium.family': formatMoney(c.params.premiumFamily),
    'premium.total': formatMoney(c.params.total),
    'insured.employees': String(c.params.employees),
    'insured.family': String(c.params.familyMembers),
    'insured.total': String(c.params.employees + c.params.familyMembers),
  };
  if (r) {
    values['client.address'] = r.address ?? '—';
    values['client.bank'] = r.bank;
    values['client.account'] = r.account;
    values['client.mfo'] = r.mfo;
  }
  if (c.migSignatory) {
    values['mig.signatory.name'] = c.migSignatory.fullName;
    values['mig.signatory.position'] = docLabel('labels.role', c.migSignatory.role).toLowerCase();
    values['mig.signatory.basis'] = c.migSignatory.basis;
  }
  return {
    templateId: 'contract',
    title: `Договор ДМС ${c.number}`,
    values,
    overrides: Object.fromEntries(c.clauseOverrides.map((o) => [o.clauseId, o.text])),
    showChanges: opts.showChanges,
    signatures: { mig: sideLine(c.signing.mig), client: sideLine(c.signing.client) },
    tables: {
      program: (Object.keys(limits) as LimitCategory[]).map((k) => [docLabel('labels.limitCategory', k), formatMoney(limits[k])]),
      insured: c.insuredRows.map((x, i) => [String(i + 1), x.fullName, x.position, String(x.familyMembers)]),
      schedule: c.params.paymentSchedule.map((p, i) => [String(i + 1), formatDate(p.dueDate), formatMoney(p.amount)]),
    },
  };
}

export function endorsementDocument(e: EndorsementView, opts: { showChanges?: boolean } = {}): StubRenderInput {
  const effective = e.kind === 'termination' && e.terminationDate ? formatDate(e.terminationDate) : [...new Set(e.requests.map((r) => formatDate(r.effectiveDate)))].join(', ') || '—';
  return {
    templateId: 'endorsement',
    title: `Доп. соглашение ${e.number}`,
    values: {
      'endorsement.number': e.number,
      'endorsement.date': formatDate(e.createdAt ?? new Date().toISOString()),
      'endorsement.kind': e.kind === 'termination' ? 'Досрочное расторжение договора по соглашению сторон' : 'Изменение состава застрахованных и условий',
      'endorsement.effective': effective,
      'endorsement.total': formatMoney(Math.abs(e.total)),
      'endorsement.totalLabel': e.total >= 0 ? 'к доплате' : 'к возврату',
      'contract.number': e.contractNumber,
      'mig.name': MIG_REQUISITES.name,
      'mig.signatory.name': e.migSignatory?.fullName ?? '—',
      'client.name': e.clientName,
      'client.signatory.name': e.clientSignatoryName,
    },
    overrides: Object.fromEntries(e.clauseOverrides.map((o) => [o.clauseId, o.text])),
    showChanges: opts.showChanges,
    signatures: { mig: sideLine(e.signing.mig), client: sideLine(e.signing.client) },
    tables: { lines: e.lines.map((l, i) => [String(i + 1), l.description, String(l.days), l.formula, formatMoney(l.amount)]) },
  };
}

export function certificateDocument(c: CertificateView): StubRenderInput {
  return {
    templateId: 'certificate',
    title: `Сертификат ${c.certificateNumber}`,
    values: {
      'certificate.number': c.certificateNumber,
      'contract.number': c.contractNumber,
      'insured.name': c.fullName,
      'insured.from': formatDate(c.insuredFrom),
      'client.name': c.clientName,
      'policy.number': c.policyNumber,
      'policy.endDate': formatDate(c.policyEndDate),
      'program.name': docLabel('labels.program', c.program),
      'assistance.name': c.assistanceName,
      'assistance.phone': c.assistancePhone,
      'mig.name': MIG_REQUISITES.name,
    },
  };
}

export function letterDocument(l: ClaimLetter): StubRenderInput {
  return {
    templateId: 'claimDecisionLetter',
    title: `Решение по обращению ${l.claimNumber}`,
    values: {
      'claim.number': l.claimNumber,
      'claim.amountClaimed': formatMoney(l.amountClaimed),
      'insured.name': l.insuredName,
      'decision.date': formatDate(l.decision.at),
      'decision.kind': DECISION_KIND_LABEL[l.decision.kind],
      'decision.amount': formatMoney(l.decision.amount),
      'decision.clause': l.decision.clauseRef ?? 'Решение принято в пределах программы страхования',
      'decision.reason': l.decision.reason || 'Расходы возмещаются в полном объёме',
      'mig.name': MIG_REQUISITES.name,
    },
  };
}
