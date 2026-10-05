import { http } from 'msw';
import { msg, t } from '@/i18n/core';
import type { AuditEntry, SessionUser } from '@/shared/types';
import type { AttentionItem, DashboardSummary, IntegrationStatus, Kpi, QueueItem, QueueType } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { canSeeQueueType, QUEUE_TYPES } from '@/shared/domain/queue';
import { formatParamValue, paramLabel } from '@/shared/config/dmsParameters';
import { FLAG_LABEL } from '@/shared/domain/settlement';
import { LIMIT_CATEGORY_LABEL } from '@/shared/domain/labels';
import { isStaffRole, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { CLAIM_CATEGORY_LABEL } from '@/shared/domain/claims';
import { formatMoney, formatPercent } from '@/shared/lib/format';
import { db, hasLiveKp, type Db } from '../db';
import { isOverdueRequest } from '../clinic-core';
import { assistanceName, currentAssistance, linesOf, subTotals } from '../assistance-core';
import { API, byLegalForm, byLegalName, filterLegalForm, forbidden, requireSession, route, sortBy } from '../http';
import { assistanceLegalFormOf, clientLegalFormOf, clinicLegalFormOf } from '../views';
import type { LegalFormCode } from '@/shared/config/legalForms';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../time';
import { dmsParam } from '../params';
import { canApproveDecision } from '@/shared/domain/settlement';
import { canApproveQuote } from '@/shared/domain/tariff';
import { originalReminderDue } from '@/shared/domain/contracts';
import { dealContract, latestQuote, toDealView } from '../lifecycle-core';

export function requireStaff(user: SessionUser): void {
  if (!isStaffRole(user.role)) throw forbidden();
}

const ACTIVE_CLAIM = new Set(['new', 'review', 'medical_review']);

// Queue statuses are packed message keys (the UI translates them); KPIs count items by them.
const ST_QUOTE_MINE = msg('srv.dash.st.quoteMine');
const ST_QUOTE_DRAFT = msg('srv.dash.st.quoteDraft');
const ST_SIGNING = msg('srv.dash.st.signing');
const ST_NO_ORIGINAL = msg('srv.dash.st.noOriginal');
const ST_CLAIM_NEW = msg('srv.dash.st.claimNew');
const ST_CLAIM_OVERDUE = msg('srv.dash.st.claimOverdue');
const ST_ABOVE = msg('srv.dash.st.aboveAuthor');

export function isOverdue(c: { status: string; slaDueAt: string }, now = Date.now()): boolean {
  return ACTIVE_CLAIM.has(c.status) && parseIso(c.slaDueAt) < now;
}

export function renewalsWithoutOffer(d: Db, now: number) {
  return d.clients.filter(
    (c) =>
      c.renewalDate &&
      parseIso(c.renewalDate) >= startOfDay(now) &&
      parseIso(c.renewalDate) - now <= 30 * DAY &&
      !hasLiveKp(d, c.id),
  );
}

/** KPIs follow the role's queue: each card counts what the role works on. */
function kpisFor(d: Db, user: SessionUser, now: number, queue: readonly QueueItem[]): Kpi[] {
  const n = (type: QueueType, status?: string) => queue.filter((i) => i.type === type && (status === undefined || i.status === status)).length;
  switch (user.role) {
    case 'operator':
      return [
        { key: 'sla', label: msg('srv.dash.kpi.sla'), value: n('assistance_sla'), format: 'number', tone: n('assistance_sla') ? 'danger' : 'default', to: '/staff/assistance' },
        { key: 'complaints', label: msg('srv.dash.kpi.complaints'), value: n('complaint'), format: 'number', tone: n('complaint') ? 'warning' : 'default', to: '/staff/assistance' },
        { key: 'appts', label: msg('srv.dash.kpi.appts'), value: n('appointment'), format: 'number', to: '/staff/appointments?status=requested' },
        { key: 'no_response', label: msg('srv.dash.kpi.noResponse'), value: n('clinic_no_response'), format: 'number', tone: n('clinic_no_response') ? 'danger' : 'default', to: '/staff/appointments?status=requested' },
      ];
    case 'underwriter': {
      const loss = d.clients.filter((c) => (c.lossRatio ?? 0) >= dmsParam('lossRatioWarn'));
      return [
        { key: 'quotes', label: msg('srv.dash.kpi.quotes'), value: n('quote', ST_QUOTE_MINE), format: 'number', hint: msg('srv.dash.kpi.quotesHint', { count: n('quote', ST_QUOTE_DRAFT) }), tone: n('quote', ST_QUOTE_MINE) ? 'warning' : 'default', to: '/staff/deals' },
        { key: 'renewals', label: msg('srv.dash.kpi.renewals', { days: dmsParam('renewalLeadDays') }), value: n('renewal'), format: 'number', to: '/staff/clients?view=renewals' },
        { key: 'finance', label: msg('srv.dash.kpi.finance'), value: n('contract') + n('endorsement') + n('limit_request'), format: 'number', hint: msg('srv.dash.kpi.financeHint', { count: n('limit_request') }), to: '/staff/limit-requests?status=pending' },
        { key: 'loss', label: msg('srv.dash.lossFrom', { pct: formatPercent(dmsParam('lossRatioWarn')) }), value: loss.length, format: 'number', tone: loss.length ? 'warning' : 'default', to: '/staff/clients?view=loss' },
      ];
    }
    case 'sales_manager': {
      const mine = d.deals.filter((x) => x.ownerId === user.id && x.stage !== 'lost' && x.stage !== 'active');
      const overdue = queue.filter((i) => i.type === 'invoice');
      return [
        { key: 'leads', label: msg('srv.dash.kpi.leads'), value: n('lead'), format: 'number', hint: msg('srv.dash.kpi.longerDays', { days: dmsParam('leadIdleDays') }), tone: n('lead') ? 'warning' : 'default', to: '/staff/deals' },
        { key: 'kp', label: msg('srv.dash.kpi.kp'), value: n('kp'), format: 'number', hint: msg('srv.dash.kpi.longerDays', { days: dmsParam('kpNoAnswerDays') }), to: '/staff/deals' },
        { key: 'signing', label: msg('srv.dash.kpi.signing'), value: n('contract', ST_SIGNING), format: 'number', hint: msg('srv.dash.kpi.signingHint', { count: n('contract', ST_NO_ORIGINAL) }), to: '/staff/contracts' },
        { key: 'pipeline', label: msg('srv.dash.kpi.pipeline'), value: mine.reduce((sum, x) => sum + (latestQuote(d, x.id)?.total ?? 0), 0), format: 'money', hint: msg('srv.dash.kpi.pipelineHint', { count: overdue.length }) },
      ];
    }
    case 'claims_officer':
      return [
        { key: 'new', label: msg('srv.dash.kpi.newClaims'), value: n('claim', ST_CLAIM_NEW) + n('claim', ST_CLAIM_OVERDUE), format: 'number', to: '/staff/claims?tab=new' },
        { key: 'above', label: msg('srv.dash.kpi.above'), value: n('claim', ST_ABOVE), format: 'number', tone: 'warning', to: '/staff/claims?tab=above' },
        { key: 'appeals', label: msg('srv.dash.kpi.appeals'), value: n('appeal'), format: 'number', tone: n('appeal') ? 'danger' : 'default', to: '/staff/claims?tab=appeals' },
        { key: 'flags', label: msg('srv.dash.kpi.flags'), value: n('fraud_flag'), format: 'number', hint: msg('srv.dash.kpi.flagsHint', { count: queue.filter((i) => i.type === 'rebill').length }), tone: n('fraud_flag') ? 'warning' : 'default', to: '/staff/claims?flagged=1' },
      ];
    case 'doctor_expert': {
      const grants = d.audit.filter((e) => e.action === 'open_medical' && e.actorId === user.id && now - parseIso(e.at) <= 7 * DAY);
      return [
        { key: 'escalations', label: msg('srv.dash.kpi.escalations'), value: n('escalation') + n('guarantee'), format: 'number', hint: msg('srv.dash.kpi.escalationsHint', { count: n('escalation') }), tone: n('escalation') ? 'warning' : 'default', to: '/staff/guarantees' },
        { key: 'opinions', label: msg('srv.dash.kpi.opinions'), value: n('opinion'), format: 'number', to: '/staff/claims?status=medical_review' },
        { key: 'qa', label: msg('srv.dash.kpi.qa'), value: n('qa_sample'), format: 'number', to: '/staff/qa' },
        { key: 'access', label: msg('srv.dash.kpi.access'), value: grants.length, format: 'number' },
      ];
    }
    case 'accountant': {
      const queued = d.bankPayments.filter((b) => b.status === 'pending');
      const rebillsToPay = queue.filter((i) => i.type === 'rebill');
      const overdue = d.invoices.filter((i) => i.contractId && i.status === 'overdue');
      const payouts = d.claims.filter((c) => c.status === 'to_pay');
      return [
        { key: 'allocation', label: msg('srv.dash.kpi.allocation'), value: queued.reduce((sum, b) => sum + b.amount - b.allocated, 0), format: 'money', hint: msg('srv.dash.kpi.allocationHint', { count: queued.length }), tone: queued.length ? 'warning' : 'default', to: '/staff/invoices/queue' },
        { key: 'rebills', label: msg('srv.dash.kpi.rebills'), value: rebillsToPay.length, format: 'number', to: '/staff/rebills' },
        { key: 'overdue', label: msg('srv.dash.kpi.overdue'), value: overdue.reduce((sum, i) => sum + i.amount - (i.paid ?? 0), 0), format: 'money', hint: msg('srv.dash.kpi.overdueHint', { count: overdue.length }), tone: overdue.length ? 'danger' : 'default', to: '/staff/invoices?status=overdue' },
        { key: 'payouts', label: msg('srv.dash.kpi.payouts'), value: payouts.reduce((sum, c) => sum + (c.amountApproved ?? c.amountClaimed), 0), format: 'money', hint: msg('srv.dash.kpi.payoutsHint', { claims: payouts.length, registries: n('payout') - payouts.length }), to: '/staff/claims?status=to_pay' },
      ];
    }
    case 'legal':
      return [
        { key: 'contracts', label: msg('srv.dash.kpi.contracts'), value: n('contract'), format: 'number', tone: n('contract') ? 'warning' : 'default', to: '/staff/contracts?status=legal_review' },
        { key: 'endorsements', label: msg('srv.dash.kpi.endorsements'), value: n('endorsement'), format: 'number', to: '/staff/endorsements' },
        { key: 'scans', label: msg('srv.dash.kpi.scans'), value: n('scan'), format: 'number', to: '/staff/contracts' },
        {
          key: 'changed',
          label: msg('srv.dash.kpi.changed'),
          value: [...d.contracts.filter((c) => c.status === 'legal_review'), ...d.endorsements.filter((e) => e.status === 'legal_review')].reduce((sum, x) => sum + x.clauseOverrides.length, 0),
          format: 'number',
        },
      ];
    case 'admin':
    default: {
      const dayAgo = now - DAY;
      return [
        { key: 'params', label: msg('srv.dash.kpi.params'), value: n('param_change'), format: 'number', tone: n('param_change') ? 'warning' : 'default', to: '/staff/admin/parameters' },
        { key: 'authority', label: msg('srv.dash.kpi.authority'), value: n('authority_change'), format: 'number', hint: msg('srv.dash.kpi.authorityHint', { count: n('ai_change') }), tone: n('authority_change') ? 'warning' : 'default', to: '/staff/admin/users' },
        { key: 'integrations', label: msg('srv.dash.kpi.integrations'), value: n('integration_error'), format: 'number', tone: n('integration_error') ? 'danger' : 'default', to: '/staff/clinics' },
        {
          key: 'failed',
          label: msg('srv.dash.kpi.failedLogins'),
          value: d.audit.filter((e) => e.action === 'login_failed' && parseIso(e.at) >= dayAgo).length,
          format: 'number',
          tone: 'warning',
          to: '/staff/audit?action=login_failed',
        },
      ];
    }
  }
}

function attentionFor(d: Db, user: SessionUser, now: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (can(user, 'clients.read')) {
    out.push({ key: 'renewals_no_offer', label: msg('srv.dash.attention.renewals'), count: renewalsWithoutOffer(d, now).length, to: '/staff/clients?view=renewals' });
    out.push({ key: 'high_loss_ratio', label: msg('srv.dash.lossFrom', { pct: formatPercent(dmsParam('lossRatioWarn')) }), count: d.clients.filter((c) => (c.lossRatio ?? 0) >= dmsParam('lossRatioWarn')).length, to: '/staff/clients?view=loss' });
  }
  if (can(user, 'claims.read')) {
    out.push({ key: 'sla_overdue', label: msg('srv.dash.attention.slaOverdue'), count: d.claims.filter((c) => isOverdue(c, now)).length, to: '/staff/claims?overdue=1' });
  }
  return out;
}

type Builder = (d: Db, user: SessionUser, now: number) => QueueItem[];
const DUE = (iso: string | undefined, now: number) => iso ?? tzIso(now);
const ru = (iso: string) => isoDay(parseIso(iso)).split('-').reverse().join('.');

// ---------------------------------------------------------------- item builders

/** Requests of clients without an assistance that nobody confirmed yet; a silent clinic hands them to MIG. */
const appointmentItems: Builder = (d, user, now) => {
  const served = new Set(d.insured.filter((i) => currentAssistance(d, i.policyId)).map((i) => i.id));
  const out: QueueItem[] = [];
  for (const a of d.appointments) {
    if (a.status !== 'requested' || parseIso(a.startsAt) < now - 3600_000 || served.has(a.insuredId)) continue;
    const noResponse = isOverdueRequest(d, a, now);
    out.push({
      id: a.id,
      type: noResponse ? 'clinic_no_response' : 'appointment',
      entityId: a.id,
      who: a.insuredName,
      details: msg(a.proposedStartsAt ? 'srv.dash.q.apptProposed' : 'srv.dash.q.appt', { specialty: SPECIALTY_LABEL[a.specialty], clinic: a.clinicName }),
      status: msg(noResponse ? 'srv.dash.st.noResponse' : a.proposedStartsAt ? 'srv.dash.st.awaitingPatient' : 'srv.dash.st.awaitingConfirmation'),
      statusTone: noResponse ? 'danger' : 'warning',
      dueAt: a.startsAt,
      action: can(user, 'appointments.manage') ? 'confirm' : 'open',
    });
  }
  return out;
};

const assistanceServiceItems: Builder = (d, _user, now) => {
  const out: QueueItem[] = [];
  for (const a of d.assistances) {
    const breached = d.cases.filter((c) => c.assistanceId === a.id && c.status !== 'resolved' && parseIso(c.slaDueAt) < now);
    if (breached.length) {
      out.push({ id: breached[0]!.id, type: 'assistance_sla', entityId: a.id, who: a.name, details: msg('srv.dash.q.slaBreached', { count: breached.length }), status: msg('srv.dash.st.slaBreached'), statusTone: 'danger', dueAt: breached.map((c) => c.slaDueAt).sort()[0]!, action: 'open' });
    }
  }
  for (const c of d.cases) {
    if (c.type !== 'complaint' || c.status === 'resolved') continue;
    out.push({ id: c.id, type: 'complaint', entityId: c.assistanceId, who: c.insuredName, details: `${c.number} · ${assistanceName(d, c.assistanceId) ?? t('srv.dash.assistance')} · ${c.description.slice(0, 60)}`, status: msg('srv.dash.st.complaint'), statusTone: 'danger', dueAt: c.slaDueAt, action: 'open' });
  }
  return out;
};

/** Renewals within the deal lead time that have no live offer yet. */
const renewalItems: Builder = (d, user, now) => {
  const window = dmsParam('renewalLeadDays') * DAY;
  return d.clients
    .filter((c) => c.renewalDate && c.activePolicyId && parseIso(c.renewalDate) - now <= window && parseIso(c.renewalDate) - now >= -DAY && !hasLiveKp(d, c.id))
    .map((c) => ({
      id: c.id,
      type: 'renewal' as const,
      entityId: c.id,
      policyId: c.activePolicyId,
      who: c.name,
      details: msg('srv.dash.q.renewal', { date: ru(c.renewalDate!), premium: formatMoney(c.premium) }),
      status: msg('srv.dash.st.noKp'),
      statusTone: parseIso(c.renewalDate!) - now <= 30 * DAY ? ('warning' as const) : ('default' as const),
      dueAt: tzIso(parseIso(c.renewalDate!)),
      action: can(user, 'kp.create') ? ('prepare_offer' as const) : ('open' as const),
    }));
};

const quoteItems: Builder = (d, user, now) => {
  const me = d.staff.find((s) => s.id === user.id);
  const out: QueueItem[] = [];
  for (const q of d.quotes) {
    const mine = q.status === 'pending_approval' && me && canApproveQuote(me, q) && q.createdById !== user.id;
    const draft = q.status === 'draft' && q.createdById === user.id;
    if (!mine && !draft) continue;
    const deal = d.deals.find((x) => x.id === q.dealId);
    out.push({
      id: q.id,
      type: 'quote',
      entityId: q.id,
      who: deal ? toDealView(d, deal).clientName : t('srv.dash.quote'),
      details: msg('srv.dash.q.quote', { number: deal?.number ?? '', premium: formatMoney(q.total), discount: formatPercent(q.discountFromTariffPct) }),
      status: mine ? ST_QUOTE_MINE : ST_QUOTE_DRAFT,
      statusTone: mine ? 'warning' : 'default',
      dueAt: DUE(q.updatedAt, now),
      action: 'open',
    });
  }
  return out;
};

/** Contracts and endorsements whose money differs from what was approved: the underwriter signs it off. */
const financeItems: Builder = (d, _user, now) => {
  const out: QueueItem[] = [];
  for (const c of d.contracts.filter((x) => x.financeDiffers && !x.financeApprovedByName && x.status === 'draft')) {
    out.push({ id: `${c.id}:finance`, type: 'contract', entityId: c.id, who: c.clientName, details: msg('srv.dash.q.financeDiffers', { number: c.number }), status: msg('srv.dash.st.approveTerms'), statusTone: 'warning', dueAt: c.createdAt, action: 'open' });
  }
  for (const e of d.endorsements) {
    if (e.amountsApprovedByName || !d.changeRequests.some((r) => e.changeRequestIds.includes(r.id) && r.type === 'other')) continue;
    const c = d.contracts.find((x) => x.id === e.contractId);
    out.push({ id: `${e.id}:finance`, type: 'endorsement', entityId: e.id, who: c?.clientName ?? e.number, details: msg('srv.dash.q.otherAmounts', { number: e.number, amount: formatMoney(e.total) }), status: msg('srv.dash.st.approveAmounts'), statusTone: 'warning', dueAt: DUE(e.createdAt, now), action: 'open' });
  }
  return out;
};

const limitItems: Builder = (d, user) =>
  d.limitRequests
    .filter((r) => r.status === 'pending' && r.requestedById !== user.id)
    .map((r) => ({
      id: r.id,
      type: 'limit_request' as const,
      entityId: r.id,
      who: r.policyNumber,
      details: msg('srv.dash.q.limit', { category: LIMIT_CATEGORY_LABEL[r.category], from: formatMoney(r.from), to: formatMoney(r.to) }),
      status: msg('srv.dash.st.awaitingApproval'),
      statusTone: 'warning' as const,
      dueAt: tzIso(parseIso(r.createdAt) + 2 * DAY),
      action: 'open' as const,
    }));

/** An aggregate per client: no claim details reach the underwriter. */
const lossRatioItems: Builder = (d, _user, now) =>
  d.clients
    .filter((c) => (c.lossRatio ?? 0) >= dmsParam('lossRatioWarn'))
    .map((c) => ({
      id: `${c.id}:loss`,
      type: 'loss_ratio' as const,
      entityId: c.id,
      who: c.name,
      details: msg('srv.dash.q.lossRatio', { pct: formatPercent(c.lossRatio ?? 0), premium: formatMoney(c.premium) }),
      status: msg('srv.dash.st.aboveThreshold', { pct: formatPercent(dmsParam('lossRatioWarn')) }),
      statusTone: 'danger' as const,
      dueAt: c.renewalDate ? tzIso(parseIso(c.renewalDate)) : tzIso(now),
      action: 'open' as const,
    }));

const policyChangeItems: Builder = (d) => {
  const byClient = new Map<string, { name: string; count: number; oldest: string; delta: number; firstId: string }>();
  for (const c of d.policyChanges.filter((x) => x.status === 'pending')) {
    const g = byClient.get(c.clientId) ?? { name: c.clientName, count: 0, oldest: c.requestedAt, delta: 0, firstId: c.id };
    g.count += 1;
    g.delta += c.premiumDelta;
    if (c.requestedAt <= g.oldest) {
      g.oldest = c.requestedAt;
      g.firstId = c.id;
    }
    byClient.set(c.clientId, g);
  }
  return [...byClient].map(([clientId, g]) => ({
    id: g.firstId,
    type: 'policy_change' as const,
    entityId: clientId,
    who: g.name,
    details: msg(g.delta >= 0 ? 'srv.dash.q.policyChangesSurcharge' : 'srv.dash.q.policyChangesRefund', { count: g.count, amount: formatMoney(Math.abs(g.delta)) }),
    status: msg('srv.dash.st.awaitingDecision'),
    statusTone: 'warning' as const,
    dueAt: tzIso(parseIso(g.oldest) + 2 * DAY),
    action: 'open' as const,
  }));
};

const lastActivity = (d: Db, dealId: string, fallback: string) => d.dealEvents.filter((e) => e.dealId === dealId).reduce((m, e) => (e.at > m ? e.at : m), fallback);

const salesItems: Builder = (d, user, now) => {
  const out: QueueItem[] = [];
  const idle = dmsParam('leadIdleDays') * DAY;
  const noAnswer = dmsParam('kpNoAnswerDays') * DAY;
  const days = dmsParam('paperOriginalReminderDays');
  for (const deal of d.deals.filter((x) => x.stage !== 'lost' && x.ownerId === user.id)) {
    const name = toDealView(d, deal).clientName;
    const last = lastActivity(d, deal.id, deal.updatedAt);
    if (deal.stage === 'lead' && now - parseIso(last) >= idle) {
      out.push({ id: `${deal.id}:lead`, type: 'lead', entityId: deal.id, who: name, details: msg('srv.dash.q.lastActivity', { number: deal.number, date: ru(last) }), status: msg('srv.dash.st.noActivity'), statusTone: 'warning', dueAt: tzIso(parseIso(last) + idle), action: 'open' });
    }
    if (deal.stage === 'kp_sent') {
      const kp = d.kp.filter((k) => k.dealId === deal.id && k.status === 'sent').sort((a, b) => ((a.sentAt ?? '') < (b.sentAt ?? '') ? 1 : -1))[0];
      const sent = kp?.sentAt ?? deal.updatedAt;
      if (now - parseIso(sent) >= noAnswer) out.push({ id: `${deal.id}:kp`, type: 'kp', entityId: deal.id, who: name, details: msg('srv.dash.q.kpSent', { number: kp?.number ?? deal.number, date: ru(sent) }), status: msg('srv.dash.st.kpNoAnswer'), statusTone: 'warning', dueAt: tzIso(parseIso(sent) + noAnswer), action: 'open' });
    }
    if (deal.stage === 'kp_accepted') out.push({ id: deal.id, type: 'deal', entityId: deal.id, who: name, details: msg('srv.dash.q.kpAccepted', { number: deal.number }), status: msg('srv.dash.st.prepareContract'), statusTone: 'info', dueAt: deal.updatedAt, action: 'open' });
    const c = dealContract(d, deal.id);
    if (!c) continue;
    if (c.status === 'draft' && c.legalComment) out.push({ id: `${deal.id}:legal`, type: 'deal', entityId: deal.id, who: name, details: `${c.number} · ${c.legalComment.slice(0, 60)}`, status: msg('srv.dash.st.legalReturned'), statusTone: 'warning', dueAt: deal.updatedAt, action: 'open' });
    if (c.status === 'sent' || c.status === 'signing') out.push({ id: `${c.id}:signing`, type: 'contract', entityId: c.id, who: name, details: msg(c.signing.mig ? (c.signing.client ? 'srv.dash.q.signedBoth' : 'srv.dash.q.signedMig') : c.signing.client ? 'srv.dash.q.awaitingMigClientSigned' : 'srv.dash.q.awaitingMig', { number: c.number }), status: ST_SIGNING, statusTone: 'info', dueAt: deal.updatedAt, action: 'open' });
    if (originalReminderDue(c.signing, now, days)) out.push({ id: `${c.id}:orig`, type: 'contract', entityId: c.id, who: name, details: msg('srv.dash.q.noOriginal', { number: c.number, days }), status: ST_NO_ORIGINAL, statusTone: 'warning', dueAt: c.signing.client?.signedAt ?? deal.updatedAt, action: 'open' });
    for (const i of d.invoices.filter((x) => x.contractId === c.id && x.status === 'overdue')) {
      out.push({ id: i.id, type: 'invoice', entityId: i.id, who: name, details: `${i.number} · ${c.number} · ${formatMoney(i.amount - (i.paid ?? 0))}`, status: msg('srv.dash.st.overdueInstallment'), statusTone: 'danger', dueAt: tzIso(parseIso(i.dueDate)), action: 'open' });
    }
  }
  return out;
};

const claimsOfficerItems: Builder = (d, user, now) => {
  const me = d.staff.find((s) => s.id === user.id);
  const out: QueueItem[] = [];
  for (const c of d.claims) {
    if (c.handledBy === 'assistance') continue;
    if (c.status === 'new') {
      const overdue = isOverdue(c, now);
      out.push({ id: c.id, type: 'claim', entityId: c.id, who: c.insuredName, details: `${c.number} · ${CLAIM_CATEGORY_LABEL[c.category]} · ${formatMoney(c.amountClaimed)}`, status: overdue ? ST_CLAIM_OVERDUE : ST_CLAIM_NEW, statusTone: overdue ? 'danger' : 'info', dueAt: c.slaDueAt, action: 'open' });
    }
    if (c.pendingDecision && me && canApproveDecision(me, c.pendingDecision) && c.pendingDecision.byId !== user.id) {
      out.push({ id: `${c.id}:approve`, type: 'claim', entityId: c.id, who: c.insuredName, details: msg('srv.dash.q.pendingDecision', { number: c.number, name: c.pendingDecision.byName, amount: formatMoney(c.pendingDecision.required) }), status: ST_ABOVE, statusTone: 'warning', dueAt: c.slaDueAt, action: 'open' });
    }
    if (c.appeal?.status === 'open') {
      out.push({ id: `${c.id}:appeal`, type: 'appeal', entityId: c.id, who: c.insuredName, details: `${c.number} · ${c.appeal.text.slice(0, 60)}`, status: msg('srv.dash.st.appeal'), statusTone: 'danger', dueAt: tzIso(parseIso(c.appeal.at) + 5 * DAY), action: 'open' });
    }
    const flags = (c.flags ?? []).filter((f) => !f.dismissed);
    if (flags.length && ACTIVE_CLAIM.has(c.status)) {
      out.push({ id: `${c.id}:flags`, type: 'fraud_flag', entityId: c.id, who: c.insuredName, details: `${c.number} · ${flags.map((f) => FLAG_LABEL[f.code]).join(', ')}`, status: msg('srv.dash.st.flags', { count: flags.length }), statusTone: 'danger', dueAt: c.slaDueAt, action: 'open' });
    }
  }
  return [...out, ...rebillItems(d, user, now)];
};

const rebillItems: Builder = (d, user, now) => {
  const out: QueueItem[] = [];
  for (const b of d.rebills) {
    const toReview = can(user, 'rebills.review') && (b.status === 'submitted' || b.status === 'in_review');
    const toPay = can(user, 'rebills.pay') && (b.status === 'accepted' || b.status === 'partially_accepted') && b.acceptedById !== user.id;
    if (!toReview && !toPay) continue;
    const flagged = b.lines.filter((l) => l.checks.length && l.status !== 'accepted' && l.status !== 'rejected').length;
    out.push({
      id: b.id,
      type: 'rebill',
      entityId: b.id,
      who: assistanceName(d, b.assistanceId) ?? t('srv.dash.assistance'),
      details: toPay ? `${b.number} · ${formatMoney(b.totals.accepted + b.totals.fee)}` : msg('srv.dash.q.rebillLines', { number: b.number, count: b.lines.length, amount: formatMoney(b.totals.total) }),
      status: toPay ? msg('srv.dash.st.toPay') : flagged ? msg('srv.dash.st.flaggedLines', { count: flagged }) : msg('srv.dash.st.linesInReview'),
      statusTone: toPay ? 'success' : flagged ? 'warning' : 'info',
      dueAt: tzIso(parseIso(b.submittedAt ?? tzIso(now)) + 14 * DAY),
      action: 'open',
    });
  }
  return out;
};

const doctorItems: Builder = (d, user, now) => {
  const out: QueueItem[] = [];
  for (const g of d.guarantees) {
    if (g.status !== 'requested' || g.approvals.some((x) => x.byId === user.id)) continue;
    // MIG decides only escalations and letters of clients without an assistance (ASSISTANCE_SPEC §9.1).
    if (g.assistanceId && !g.escalated) continue;
    const second = g.approvals.length > 0;
    out.push({ id: g.id, type: g.escalated ? 'escalation' : 'guarantee', entityId: g.id, who: g.insuredName, details: `${g.number} · ${g.serviceName} · ${formatMoney(g.approvedAmount ?? g.estimatedCost)}`, status: second ? msg('srv.dash.st.secondApproval') : g.escalated ? msg('srv.dash.st.escalation', { name: g.assistanceName ?? t('srv.guarantee.assistanceDefault') }) : msg('srv.dash.st.decisionNeeded'), statusTone: second ? 'warning' : 'info', dueAt: tzIso(parseIso(g.createdAt) + DAY), action: 'open' });
  }
  for (const c of d.claims) {
    if (!c.opinion || c.opinion.text) continue;
    out.push({ id: `${c.id}:opinion`, type: 'opinion', entityId: c.id, who: c.insuredName, details: `${c.number} · ${c.opinion.question ?? CLAIM_CATEGORY_LABEL[c.category]}`, status: msg('srv.dash.st.requestedBy', { name: c.opinion.requestedByName }), statusTone: isOverdue(c, now) ? 'danger' : 'info', dueAt: c.slaDueAt, action: 'open' });
  }
  for (const q of d.qaSamples.filter((x) => !x.verdict)) {
    out.push({ id: q.id, type: 'qa_sample', entityId: q.id, who: assistanceName(d, q.assistanceId) ?? t('srv.dash.assistance'), details: msg(q.subject.type === 'guarantee' ? 'srv.dash.q.qaGuarantee' : 'srv.dash.q.qaRegistryLine', { label: q.subject.label }), status: msg('srv.dash.st.checkDecision'), statusTone: 'info', dueAt: tzIso(parseIso(q.createdAt) + 7 * DAY), action: 'open' });
  }
  return out;
};

const accountantItems: Builder = (d, user, now) => {
  const out: QueueItem[] = [];
  for (const b of d.bankPayments.filter((x) => x.status === 'pending')) {
    out.push({ id: b.id, type: 'bank_payment', entityId: b.id, who: b.payerName ?? t('srv.dash.inn', { inn: b.payerInn }), details: b.docNumber ? msg('srv.dash.q.bankPaymentDoc', { doc: b.docNumber, amount: formatMoney(b.amount - b.allocated), purpose: b.purpose.slice(0, 50) }) : `${formatMoney(b.amount - b.allocated)} · ${b.purpose.slice(0, 50)}`, status: msg('srv.dash.st.allocateManually'), statusTone: 'warning', dueAt: tzIso(parseIso(b.date) + 3 * DAY), action: 'open' });
  }
  for (const i of d.invoices.filter((x) => x.contractId && x.status === 'overdue')) {
    out.push({ id: i.id, type: 'invoice', entityId: i.id, who: d.clients.find((c) => c.id === i.clientId)?.name ?? t('srv.dash.client'), details: `${i.number} · ${formatMoney(i.amount - (i.paid ?? 0))}`, status: msg('srv.dash.st.overdueInstallment'), statusTone: 'danger', dueAt: tzIso(parseIso(i.dueDate)), action: 'open' });
  }
  for (const c of d.claims.filter((x) => x.status === 'to_pay')) {
    out.push({ id: c.id, type: 'payout', entityId: c.id, who: c.insuredName, details: `${c.number} · ${formatMoney(c.amountApproved ?? c.amountClaimed)}`, status: msg('srv.dash.st.payoutInsured'), statusTone: 'success', dueAt: c.slaDueAt, action: 'open', subject: 'claim' });
  }
  for (const r of d.registries) {
    const mine = linesOf(r, 'mig');
    if (!mine.length || r.status === 'draft' || r.status === 'paid') continue;
    const pending = mine.filter((l) => l.status === 'pending' || l.status === 'disputed').length;
    const unpaid = mine.filter((l) => l.status === 'accepted' && !l.payment).length;
    if (pending || !unpaid) continue;
    out.push({ id: r.id, type: 'payout', entityId: r.id, who: d.clinics.find((c) => c.id === r.clinicId)?.name ?? t('srv.dash.clinic'), details: msg('srv.dash.q.registry', { period: r.period, amount: formatMoney(subTotals(mine).accepted) }), status: msg('srv.dash.st.payoutClinic'), statusTone: 'success', dueAt: tzIso(parseIso(r.submittedAt ?? tzIso(now)) + 5 * DAY), action: 'open', subject: 'registry' });
  }
  return [...out, ...rebillItems(d, user, now)];
};

const legalItems: Builder = (d, _user, now) => {
  const out: QueueItem[] = [];
  for (const c of d.contracts.filter((x) => x.status === 'legal_review')) {
    out.push({ id: c.id, type: 'contract', entityId: c.id, who: c.clientName, details: msg('srv.dash.q.changedClauses', { number: c.number, count: c.clauseOverrides.length }), status: msg('srv.dash.st.inReview'), statusTone: 'warning', dueAt: c.createdAt, action: 'open' });
  }
  for (const e of d.endorsements.filter((x) => x.status === 'legal_review')) {
    const c = d.contracts.find((x) => x.id === e.contractId);
    out.push({ id: e.id, type: 'endorsement', entityId: e.id, who: c?.clientName ?? e.number, details: msg('srv.dash.q.changedClauses', { number: e.number, count: e.clauseOverrides.length }), status: msg('srv.dash.st.inReview'), statusTone: 'warning', dueAt: DUE(e.createdAt, now), action: 'open' });
  }
  for (const c of d.contracts) {
    for (const s of c.signing.pendingScans ?? []) {
      out.push({ id: `${c.id}:scan:${s.side}`, type: 'scan', entityId: c.id, who: c.clientName, details: msg(s.side === 'mig' ? 'srv.dash.q.scanMigBy' : 'srv.dash.q.scanClientBy', { number: c.number, name: s.uploadedByName }), status: msg('srv.dash.st.checkScan'), statusTone: 'info', dueAt: tzIso(parseIso(s.uploadedAt) + 2 * DAY), action: 'open', subject: 'contract' });
    }
  }
  for (const e of d.endorsements) {
    const c = d.contracts.find((x) => x.id === e.contractId);
    for (const s of e.signing.pendingScans ?? []) {
      out.push({ id: `${e.id}:scan:${s.side}`, type: 'scan', entityId: e.id, who: c?.clientName ?? e.number, details: msg(s.side === 'mig' ? 'srv.dash.q.scanMig' : 'srv.dash.q.scanClient', { number: e.number }), status: msg('srv.dash.st.checkScan'), statusTone: 'info', dueAt: tzIso(parseIso(s.uploadedAt) + 2 * DAY), action: 'open', subject: 'endorsement' });
    }
  }
  return out;
};

const adminItems: Builder = (d, user) => {
  const out: QueueItem[] = [];
  for (const c of d.dmsParams.changes.filter((x) => x.status === 'pending' && x.proposedById !== user.id)) {
    out.push({ id: c.id, type: 'param_change', entityId: c.id, who: c.proposedByName, details: `${paramLabel(c.key)}: ${formatParamValue(c.key, c.from)} → ${formatParamValue(c.key, c.to)}`, status: msg('srv.dash.st.confirmationNeeded'), statusTone: 'warning', dueAt: tzIso(parseIso(c.proposedAt) + DAY), action: 'open' });
  }
  for (const c of d.authorityChanges.filter((x) => x.status === 'pending' && x.proposedById !== user.id && x.staffId !== user.id)) {
    out.push({ id: c.id, type: 'authority_change', entityId: c.staffId, who: c.staffName, details: msg('srv.dash.q.proposedBy', { name: c.proposedByName, reason: c.reason.slice(0, 60) }), status: msg('srv.dash.st.confirmationNeeded'), statusTone: 'warning', dueAt: tzIso(parseIso(c.proposedAt) + DAY), action: 'open' });
  }
  for (const c of d.ai.changes.filter((x) => x.status === 'pending' && x.proposedById !== user.id)) {
    out.push({ id: c.id, type: 'ai_change', entityId: c.id, who: c.proposedByName, details: c.reason.slice(0, 80), status: msg('srv.dash.st.confirmationNeeded'), statusTone: 'warning', dueAt: tzIso(parseIso(c.proposedAt) + DAY), action: 'open' });
  }
  const failing = new Map<string, { count: number; last: string; failed: number }>();
  for (const w of d.webhookDeliveries.filter((x) => x.status !== 'delivered')) {
    const g = failing.get(w.clinicId) ?? { count: 0, last: w.lastAttemptAt, failed: 0 };
    g.count += 1;
    if (w.status === 'failed') g.failed += 1;
    if (w.lastAttemptAt > g.last) g.last = w.lastAttemptAt;
    failing.set(w.clinicId, g);
  }
  for (const [clinicId, g] of failing) {
    out.push({ id: `${clinicId}:webhooks`, type: 'integration_error', entityId: clinicId, who: d.clinics.find((c) => c.id === clinicId)?.name ?? t('srv.dash.clinic'), details: g.failed ? msg('srv.dash.q.webhooksFailed', { count: g.count, failed: g.failed }) : msg('srv.dash.q.webhooks', { count: g.count }), status: msg(g.failed ? 'srv.dash.st.deliveryError' : 'srv.dash.st.retries'), statusTone: g.failed ? 'danger' : 'warning', dueAt: g.last, action: 'open' });
  }
  return out;
};

/** What each role works on (one place to read the whole map of the dashboard). */
const ROLE_QUEUE: Partial<Record<SessionUser['role'], Builder[]>> = {
  operator: [appointmentItems, assistanceServiceItems],
  underwriter: [quoteItems, renewalItems, financeItems, limitItems, lossRatioItems, policyChangeItems],
  sales_manager: [salesItems],
  claims_officer: [claimsOfficerItems],
  doctor_expert: [doctorItems],
  accountant: [accountantItems],
  legal: [legalItems],
  admin: [adminItems],
};

/** Groups kept for old links: «Ассистансы» shows bills, SLA breaches and complaints together. */
const GROUPS: Record<string, QueueType[]> = { assistance: ['rebill', 'assistance_sla', 'complaint'] };

/** Legal form of the row's `who` when it is a legal entity: a client, a clinic, an assistance or a payer. */
function whoLegalForm(d: Db, i: QueueItem): LegalFormCode | undefined {
  const contractClient = (contractId: string | undefined) => clientLegalFormOf(d, d.contracts.find((c) => c.id === contractId)?.clientId);
  const endorsementClient = (id: string) => contractClient(d.endorsements.find((e) => e.id === id)?.contractId);
  const dealClient = (id: string) => clientLegalFormOf(d, d.deals.find((x) => x.id === id)?.clientId);
  switch (i.type) {
    case 'renewal':
    case 'loss_ratio':
    case 'policy_change':
      return clientLegalFormOf(d, i.entityId);
    case 'lead':
    case 'kp':
    case 'deal':
      return dealClient(i.entityId);
    case 'quote':
      return dealClient(d.quotes.find((x) => x.id === i.entityId)?.dealId ?? '');
    case 'contract':
      return contractClient(i.entityId);
    case 'endorsement':
      return endorsementClient(i.entityId);
    case 'scan':
      return i.subject === 'endorsement' ? endorsementClient(i.entityId) : contractClient(i.entityId);
    case 'invoice':
      return clientLegalFormOf(d, d.invoices.find((x) => x.id === i.entityId)?.clientId);
    case 'assistance_sla':
      return assistanceLegalFormOf(d, i.entityId);
    case 'rebill':
      return assistanceLegalFormOf(d, d.rebills.find((x) => x.id === i.entityId)?.assistanceId);
    case 'qa_sample':
      return assistanceLegalFormOf(d, d.qaSamples.find((x) => x.id === i.entityId)?.assistanceId);
    case 'integration_error':
      return clinicLegalFormOf(d, i.entityId);
    case 'payout':
      return i.subject === 'registry' ? clinicLegalFormOf(d, d.registries.find((x) => x.id === i.entityId)?.clinicId) : undefined;
    case 'bank_payment': {
      const b = d.bankPayments.find((x) => x.id === i.entityId);
      return b ? (d.clients.find((c) => c.inn === b.payerInn)?.legalForm ?? b.payerLegalForm) : undefined;
    }
    default:
      return undefined;
  }
}

export function queueFor(d: Db, user: SessionUser, type: QueueType | 'all' | 'assistance', now: number): QueueItem[] {
  const builders = ROLE_QUEUE[user.role] ?? [];
  // Every item passes the permission matrix: a builder can never leak a type the role may not see.
  const all = builders
    .flatMap((b) => b(d, user, now))
    .filter((i) => canSeeQueueType(user, i.type))
    .map((i) => {
      const legalForm = whoLegalForm(d, i);
      return legalForm ? { ...i, legalForm } : i;
    });
  const pick = type === 'all' ? all : all.filter((i) => (GROUPS[type] ?? [type]).includes(i.type));
  return pick.sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
}

export function queueTypesOf(items: readonly QueueItem[]): { type: QueueType; count: number }[] {
  const counts = new Map<QueueType, number>();
  for (const i of items) counts.set(i.type, (counts.get(i.type) ?? 0) + 1);
  return QUEUE_TYPES.filter((t) => counts.has(t)).map((type) => ({ type, count: counts.get(type)! }));
}

export const dashboardHandlers = [
  http.get(
    `${API}/dashboard`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requireStaff(user);
      const d = db();
      const now = Date.now();
      const queue = queueFor(d, user, 'all', now);
      const out: DashboardSummary = {
        firstName: user.displayName.split(' ')[0] ?? user.displayName,
        queueCount: queue.length,
        queueTypes: queueTypesOf(queue),
        kpis: kpisFor(d, user, now, queue),
        attention: attentionFor(d, user, now),
      };
      return out;
    }),
  ),
  http.get(
    `${API}/queue`,
    route(({ request, url }) => {
      const { user } = requireSession(request);
      requireStaff(user);
      const t = url.searchParams.get('type');
      const type = ([...QUEUE_TYPES, 'assistance'] as const).find((x) => x === t) ?? 'all';
      const items = filterLegalForm(queueFor(db(), user, type, Date.now()), url, (i) => i.legalForm);
      return sortBy(items, url, { who: byLegalName((i) => i.who), legalForm: byLegalForm((i) => i.legalForm), dueAt: (i) => i.dueAt }).slice(0, 50);
    }),
  ),
  http.get(
    `${API}/dashboard/medical-access`,
    route(({ request }) => {
      const { user } = requireSession(request);
      if (user.role !== 'admin' && user.role !== 'doctor_expert') throw forbidden();
      const list: AuditEntry[] = db().audit.filter(
        (e) =>
          (e.action === 'reveal_pii' || e.action === 'open_medical') &&
          (user.role === 'admin' || e.actorId === user.id),
      );
      return list.slice(0, 5);
    }),
  ),
  http.get(
    `${API}/integrations/status`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requireStaff(user);
      const now = Date.now();
      const s = db().integrationsSeed;
      const list: IntegrationStatus[] = [
        { name: '1С', status: 'ok', lastSyncAt: tzIso(now - ((s % 9) + 2) * 60_000), queue: 0 },
        { name: t('srv.dash.integration.clinicApi'), status: 'degraded', lastSyncAt: tzIso(now - ((s % 17) + 12) * 60_000), queue: (s % 11) + 3 },
        { name: 'MyID', status: 'ok', lastSyncAt: tzIso(now - ((s % 4) + 1) * 60_000), queue: 0 },
        { name: 'Didox', status: 'ok', lastSyncAt: tzIso(now - ((s % 30) + 20) * 60_000), queue: 1 },
      ];
      return list;
    }),
  ),
];
