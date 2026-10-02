import { http } from 'msw';
import type { AuditEntry, SessionUser } from '@/shared/types';
import type { AttentionItem, DashboardSummary, IntegrationStatus, Kpi, QueueItem, QueueType } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { formatMoney, formatPercent } from '@/shared/lib/format';
import { db, hasLiveKp, type Db } from '../db';
import { isOverdueRequest } from '../clinic-core';
import { assistanceName, currentAssistance, linesOf, subTotals } from '../assistance-core';
import { API, forbidden, requireSession, route } from '../http';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../time';
import { dmsParam } from '../params';
import { canApproveDecision } from '@/shared/domain/settlement';
import { canApproveQuote } from '@/shared/domain/tariff';
import { originalReminderDue } from '@/shared/domain/contracts';
import { currentReserve } from '../settlement-core';
import { dealContract, latestQuote, toDealView } from '../lifecycle-core';

export function requireStaff(user: SessionUser): void {
  if (!isStaffRole(user.role)) throw forbidden();
}

const ACTIVE_CLAIM = new Set(['new', 'review', 'medical_review']);

export function isOverdue(c: { status: string; slaDueAt: string }, now = Date.now()): boolean {
  return ACTIVE_CLAIM.has(c.status) && parseIso(c.slaDueAt) < now;
}

function isToday(iso: string, now: number): boolean {
  return isoDay(parseIso(iso)) === isoDay(now);
}

function q4Range(now: number): [number, number] {
  const y = new Date(now).getFullYear();
  return [parseIso(`${y}-10-01`), parseIso(`${y}-12-31`) + DAY - 1];
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

function kpisFor(d: Db, user: SessionUser, now: number): Kpi[] {
  const apptsToday = d.appointments.filter(
    (a) => isToday(a.startsAt, now) && (a.status === 'requested' || a.status === 'confirmed'),
  ).length;
  const activePolicies = d.policies.filter((p) => p.status === 'active').length;
  switch (user.role) {
    case 'operator': {
      const inWork = d.claims.filter((c) => ACTIVE_CLAIM.has(c.status));
      const overdue = inWork.filter((c) => isOverdue(c, now)).length;
      const [a, b] = q4Range(now);
      const q4 = d.clients
        .filter((c) => c.renewalDate && parseIso(c.renewalDate) >= a && parseIso(c.renewalDate) <= b)
        .reduce((s, c) => s + c.premium, 0);
      return [
        { key: 'policies', label: 'Активные полисы', value: activePolicies, format: 'number', to: '/staff/policies?status=active' },
        { key: 'appts', label: 'Записи сегодня', value: apptsToday, format: 'number', to: '/staff/appointments?date=today' },
        {
          key: 'claims',
          label: 'Убытки в работе',
          value: inWork.length,
          format: 'number',
          hint: `${overdue} просрочено по SLA`,
          tone: overdue ? 'warning' : 'default',
          to: '/staff/claims?status=active',
        },
        { key: 'q4', label: 'Премия к продлению в Q4', value: q4, format: 'money' },
      ];
    }
    case 'accountant': {
      const toPay = d.claims.filter((c) => c.status === 'to_pay' || c.status === 'approved');
      const paidMonth = d.claims.filter(
        (c) => c.status === 'paid' && now - parseIso(c.updatedAt) <= 30 * DAY,
      );
      const overdueInv = d.invoices.filter((i) => i.status === 'overdue');
      const receivable = d.invoices.filter((i) => i.status !== 'paid').reduce((s, i) => s + i.amount, 0);
      return [
        {
          key: 'to_pay',
          label: 'К оплате',
          value: toPay.reduce((s, c) => s + (c.amountApproved ?? c.amountClaimed), 0),
          format: 'money',
          hint: `${toPay.length} убытков`,
          to: '/staff/claims?status=to_pay',
        },
        { key: 'paid', label: 'Оплачено за месяц', value: paidMonth.reduce((s, c) => s + (c.amountApproved ?? 0), 0), format: 'money', hint: `${paidMonth.length} выплат` },
        { key: 'overdue_inv', label: 'Просроченные счета клиентов', value: overdueInv.length, format: 'number', tone: overdueInv.length ? 'danger' : 'default' },
        { key: 'receivable', label: 'Дебиторка', value: receivable, format: 'money' },
      ];
    }
    case 'doctor_expert': {
      const med = d.claims.filter((c) => c.status === 'medical_review');
      const grants = d.audit.filter((e) => e.action === 'open_medical' && e.actorId === user.id && now - parseIso(e.at) <= 7 * DAY);
      return [
        { key: 'med', label: 'На экспертизе', value: med.length, format: 'number', to: '/staff/claims?status=medical_review' },
        { key: 'appts', label: 'Записи сегодня', value: apptsToday, format: 'number', to: '/staff/appointments?date=today' },
        { key: 'access', label: 'Запросы доступа за 7 дней', value: grants.length, format: 'number' },
        {
          key: 'med_overdue',
          label: 'Экспертиза с просроченным SLA',
          value: med.filter((c) => isOverdue(c, now)).length,
          format: 'number',
          tone: med.some((c) => isOverdue(c, now)) ? 'warning' : 'default',
          to: '/staff/claims?status=medical_review&overdue=1',
        },
      ];
    }
    case 'underwriter': {
      const soon = d.clients.filter((c) => c.renewalDate && parseIso(c.renewalDate) - now <= 30 * DAY && parseIso(c.renewalDate) >= startOfDay(now));
      const loss = d.clients.filter((c) => (c.lossRatio ?? 0) >= dmsParam('lossRatioWarn'));
      return [
        { key: 'policies', label: 'Активные полисы', value: activePolicies, format: 'number', to: '/staff/policies?status=active' },
        { key: 'renewals', label: 'Продления за 30 дней', value: soon.length, format: 'number', to: '/staff/clients?view=renewals' },
        { key: 'loss', label: 'Убыточность > 80%', value: loss.length, format: 'number', tone: loss.length ? 'warning' : 'default', to: '/staff/clients?view=loss' },
        { key: 'premium', label: 'Премия портфеля', value: d.policies.filter((p) => p.status === 'active').reduce((s, p) => s + p.premium, 0), format: 'money' },
      ];
    }
    case 'sales_manager': {
      const open = d.deals.filter((x) => x.stage !== 'lost' && x.stage !== 'active');
      const signing = d.contracts.filter((c) => c.status === 'sent' || c.status === 'signing');
      return [
        { key: 'deals', label: 'Открытые сделки', value: open.length, format: 'number', to: '/staff/deals' },
        { key: 'kp', label: 'КП ждут ответа', value: open.filter((x) => x.stage === 'kp_sent').length, format: 'number', to: '/staff/deals' },
        { key: 'signing', label: 'Договоры на подписании', value: signing.length, format: 'number', to: '/staff/deals' },
        { key: 'pipeline', label: 'Премия в воронке', value: open.reduce((s, x) => s + (latestQuote(d, x.id)?.total ?? 0), 0), format: 'money' },
      ];
    }
    case 'legal': {
      const review = [...d.contracts.filter((c) => c.status === 'legal_review'), ...d.endorsements.filter((e) => e.status === 'legal_review')];
      return [
        { key: 'legal', label: 'На согласовании', value: review.length, format: 'number', tone: review.length ? 'warning' : 'default' },
        { key: 'changed', label: 'Изменённых пунктов', value: review.reduce((s, x) => s + x.clauseOverrides.length, 0), format: 'number' },
      ];
    }
    case 'claims_officer': {
      const mine = d.claims.filter((c) => c.handledBy !== 'assistance');
      return [
        { key: 'new', label: 'Новые', value: mine.filter((c) => c.status === 'new').length, format: 'number', to: '/staff/claims?tab=new' },
        { key: 'review', label: 'На рассмотрении', value: mine.filter((c) => c.status === 'review').length, format: 'number', to: '/staff/claims?tab=review' },
        { key: 'above', label: 'Ждут согласования', value: d.claims.filter((c) => c.pendingDecision).length, format: 'number', tone: 'warning', to: '/staff/claims?tab=above' },
        { key: 'reserve', label: 'Резерв заявленных убытков', value: d.claims.reduce((s, c) => s + currentReserve(c), 0), format: 'money', to: '/staff/reports/reserves' },
      ];
    }
    case 'admin':
    default: {
      const dayAgo = now - DAY;
      return [
        { key: 'users', label: 'Активные сотрудники', value: d.staff.filter((s) => s.active).length, format: 'number', to: '/staff/admin/users' },
        { key: 'logins', label: 'Входы за сутки', value: d.audit.filter((e) => e.action === 'login' && parseIso(e.at) >= dayAgo).length, format: 'number' },
        {
          key: 'failed',
          label: 'Неудачные входы за сутки',
          value: d.audit.filter((e) => e.action === 'login_failed' && parseIso(e.at) >= dayAgo).length,
          format: 'number',
          tone: 'warning',
          to: '/staff/audit?action=login_failed',
        },
        {
          key: 'pii',
          label: 'Просмотры ПДн за 7 дней',
          value: d.audit.filter((e) => e.action === 'reveal_pii' && now - parseIso(e.at) <= 7 * DAY).length,
          format: 'number',
          to: '/staff/audit?action=reveal_pii',
        },
      ];
    }
  }
}

function attentionFor(d: Db, user: SessionUser, now: number): AttentionItem[] {
  const out: AttentionItem[] = [];
  if (can(user, 'clients.read')) {
    out.push({ key: 'renewals_no_offer', label: 'Продления < 30 дн без КП', count: renewalsWithoutOffer(d, now).length, to: '/staff/clients?view=renewals' });
    out.push({ key: 'high_loss_ratio', label: `Убыточность от ${formatPercent(dmsParam('lossRatioWarn'))}`, count: d.clients.filter((c) => (c.lossRatio ?? 0) >= dmsParam('lossRatioWarn')).length, to: '/staff/clients?view=loss' });
  }
  if (can(user, 'claims.read')) {
    out.push({ key: 'sla_overdue', label: 'Убытки с просроченным SLA', count: d.claims.filter((c) => isOverdue(c, now)).length, to: '/staff/claims?overdue=1' });
  }
  return out;
}

export function queueFor(d: Db, user: SessionUser, type: QueueType | 'all' | 'assistance', now: number): QueueItem[] {
  const items: QueueItem[] = [];
  if ((type === 'all' || type === 'appointment' || type === 'clinic_no_response') && can(user, 'appointments.read')) {
    // Requests of people served by an assistance go to that assistance (ASSISTANCE_SPEC §5.1, §9.3).
    const served = new Set(d.insured.filter((i) => currentAssistance(d, i.policyId)).map((i) => i.id));
    for (const a of d.appointments) {
      if (a.status !== 'requested' || parseIso(a.startsAt) < now - 3600_000 || served.has(a.insuredId)) continue;
      // A clinic that did not answer in time hands the request to the MIG operator (CLINIC_SPEC §4.3).
      const noResponse = isOverdueRequest(d, a, now);
      if (type === 'clinic_no_response' && !noResponse) continue;
      items.push({
        id: a.id,
        type: noResponse ? 'clinic_no_response' : 'appointment',
        entityId: a.id,
        who: a.insuredName,
        details: `${SPECIALTY_LABEL[a.specialty]} · ${a.clinicName}${a.proposedStartsAt ? ' · клиника предложила другое время' : ''}`,
        status: noResponse ? 'Клиника не ответила' : a.proposedStartsAt ? 'Ждём ответа пациента' : 'Ожидает подтверждения',
        statusTone: noResponse ? 'danger' : 'warning',
        dueAt: a.startsAt,
        action: can(user, 'appointments.manage') ? 'confirm' : 'open',
      });
    }
  }
  if ((type === 'all' || type === 'claim') && can(user, 'claims.read')) {
    const relevant: Record<string, string[]> = {
      operator: ['new', 'review'],
      doctor_expert: ['medical_review'],
      accountant: ['approved', 'to_pay'],
      claims_officer: ['new', 'review'],
    };
    const statuses = relevant[user.role] ?? [];
    for (const c of d.claims) {
      if (!statuses.includes(c.status)) continue;
      // Reimbursements handled by the assistance are not in MIG's queue (handlesReimbursements).
      if (user.role === 'claims_officer' && c.handledBy === 'assistance') continue;
      if (user.role === 'claims_officer' && c.pendingDecision) continue;
      // The doctor's queue: claims where an opinion was requested and not given yet.
      if (user.role === 'doctor_expert' && c.opinion?.text) continue;
      const overdue = isOverdue(c, now);
      items.push({
        id: c.id,
        type: 'claim',
        entityId: c.id,
        who: c.insuredName,
        details: `${c.number} · ${CLAIM_CATEGORY_LABEL[c.category]} · ${formatMoney(c.amountApproved ?? c.amountClaimed)}`,
        status: overdue ? 'Просрочен SLA' : CLAIM_STATUS_LABEL[c.status],
        statusTone: overdue ? 'danger' : c.status === 'new' ? 'info' : 'default',
        dueAt: c.slaDueAt,
        action: 'open',
      });
    }
  }
  if ((type === 'all' || type === 'renewal') && can(user, 'clients.read') && user.role !== 'accountant' && user.role !== 'admin') {
    for (const c of d.clients) {
      if (!c.renewalDate || !c.activePolicyId) continue;
      const until = parseIso(c.renewalDate) - now;
      if (until > 45 * DAY || until < -DAY) continue;
      const hasOffer = hasLiveKp(d, c.id);
      items.push({
        id: c.id,
        type: 'renewal',
        entityId: c.id,
        policyId: c.activePolicyId,
        who: c.name,
        details: `Полис до ${isoDay(parseIso(c.renewalDate)).split('-').reverse().join('.')} · ${formatMoney(c.premium)}`,
        status: hasOffer ? 'КП готово' : 'Нет КП',
        statusTone: hasOffer ? 'success' : until <= 30 * DAY ? 'warning' : 'default',
        dueAt: tzIso(parseIso(c.renewalDate)),
        action: can(user, 'kp.create') && !hasOffer ? 'prepare_offer' : 'open',
      });
    }
  }
  if ((type === 'all' || type === 'guarantee' || type === 'escalation') && can(user, 'guarantees.decide')) {
    for (const g of d.guarantees) {
      if (g.status !== 'requested' || g.approvals.some((x) => x.byId === user.id)) continue;
      // MIG decides only escalations and letters of clients without an assistance (§9.1).
      if (g.assistanceId && !g.escalated) continue;
      const second = g.approvals.length > 0;
      items.push({
        id: g.id,
        type: g.escalated ? 'escalation' : 'guarantee',
        entityId: g.id,
        who: g.insuredName,
        details: `${g.number} · ${g.serviceName} · ${formatMoney(g.approvedAmount ?? g.estimatedCost)}`,
        status: second ? 'Нужно второе одобрение' : g.escalated ? `Эскалация: ${g.assistanceName ?? 'ассистанс'}` : 'Нужно решение',
        statusTone: second ? 'warning' : 'info',
        dueAt: tzIso(parseIso(g.createdAt) + DAY),
        action: 'open',
      });
    }
  }
  if (type === 'all' || type === 'registry') {
    const review = can(user, 'registries.review');
    const pay = can(user, 'registries.pay');
    for (const r of d.registries) {
      // MIG handles only its own sub-registry: lines of clients without an assistance (§9.2).
      const mine = linesOf(r, 'mig');
      if (!mine.length || r.status === 'draft') continue;
      const pending = mine.filter((l) => l.status === 'pending').length;
      const disputed = mine.filter((l) => l.status === 'disputed').length;
      const unpaid = mine.filter((l) => l.status === 'accepted' && !l.payment).length;
      const toReview = review && (pending > 0 || disputed > 0);
      const toPay = pay && r.status !== 'paid' && pending === 0 && disputed === 0 && unpaid > 0;
      if (!toReview && !toPay) continue;
      const clinic = d.clinics.find((c) => c.id === r.clinicId);
      items.push({
        id: r.id,
        type: 'registry',
        entityId: r.id,
        who: clinic?.name ?? 'Клиника',
        details: `Реестр за ${r.period} · ${formatMoney(toPay ? subTotals(mine).accepted : subTotals(mine).claimed)}`,
        status: toPay ? 'К оплате' : disputed && !pending ? `Оспорено строк: ${disputed}` : `На проверке: ${pending + disputed}`,
        statusTone: toPay ? 'success' : 'warning',
        dueAt: tzIso(parseIso(r.submittedAt ?? tzIso(now)) + 5 * DAY),
        action: 'open',
      });
    }
  }
  if ((type === 'all' || type === 'policy_change') && can(user, 'policy_changes.decide')) {
    // One row per client with pending changes of the insured list (POLICY_SPEC §5.2).
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
    for (const [clientId, g] of byClient) {
      items.push({
        id: g.firstId,
        type: 'policy_change',
        entityId: clientId,
        who: g.name,
        details: `Изменения состава: ${g.count} · ${g.delta >= 0 ? 'доплата' : 'возврат'} ${formatMoney(Math.abs(g.delta))}`,
        status: 'Ждёт решения',
        statusTone: 'warning',
        dueAt: tzIso(parseIso(g.oldest) + 2 * DAY),
        action: 'open',
      });
    }
  }
  const assistanceTab = type === 'all' || type === 'assistance';
  if ((assistanceTab || type === 'rebill') && (can(user, 'rebills.review') || can(user, 'rebills.pay'))) {
    for (const b of d.rebills) {
      const toReview = can(user, 'rebills.review') && (b.status === 'submitted' || b.status === 'in_review');
      const toPay = can(user, 'rebills.pay') && (b.status === 'accepted' || b.status === 'partially_accepted') && b.acceptedById !== user.id;
      if (!toReview && !toPay) continue;
      const flagged = b.lines.filter((l) => l.checks.length && l.status !== 'accepted' && l.status !== 'rejected').length;
      items.push({
        id: b.id,
        type: 'rebill',
        entityId: b.id,
        who: assistanceName(d, b.assistanceId) ?? 'Ассистанс',
        details: `${b.number} · ${formatMoney(toPay ? b.totals.accepted + b.totals.fee : b.totals.total)}`,
        status: toPay ? 'К оплате' : flagged ? `Флагов проверки: ${flagged}` : 'На проверке',
        statusTone: toPay ? 'success' : flagged ? 'warning' : 'info',
        dueAt: tzIso(parseIso(b.submittedAt ?? tzIso(now)) + 14 * DAY),
        action: 'open',
      });
    }
  }
  // ---- contract lifecycle and settlement (LIFECYCLE_SPEC) ----
  if ((type === 'all' || type === 'claim' || type === 'appeal') && can(user, 'claims.decide')) {
    const me = d.staff.find((s) => s.id === user.id);
    for (const c of d.claims) {
      if (c.pendingDecision && me && canApproveDecision(me, c.pendingDecision) && type !== 'appeal') {
        items.push({ id: `${c.id}:approve`, type: 'claim', entityId: c.id, who: c.insuredName, details: `${c.number} · решение ${c.pendingDecision.byName} · ${formatMoney(c.pendingDecision.required)}`, status: 'Нужно согласование', statusTone: 'warning', dueAt: c.slaDueAt, action: 'open' });
      }
      if (c.appeal?.status === 'open' && type !== 'claim') {
        items.push({ id: `${c.id}:appeal`, type: 'appeal', entityId: c.id, who: c.insuredName, details: `${c.number} · ${c.appeal.text.slice(0, 60)}`, status: 'Апелляция', statusTone: 'danger', dueAt: tzIso(parseIso(c.appeal.at) + 5 * DAY), action: 'open' });
      }
    }
  }
  if (type === 'all' || type === 'deal' || type === 'quote' || type === 'contract' || type === 'invoice' || type === 'endorsement') {
    const me = d.staff.find((s) => s.id === user.id);
    if (can(user, 'quotes.approve') && me && (type === 'all' || type === 'quote')) {
      for (const q of d.quotes.filter((x) => x.status === 'pending_approval' && canApproveQuote(me, x))) {
        const deal = d.deals.find((x) => x.id === q.dealId);
        items.push({ id: q.id, type: 'quote', entityId: q.id, who: deal ? toDealView(d, deal).clientName : 'Котировка', details: `${deal?.number ?? ''} · премия ${formatMoney(q.total)} · скидка ${formatPercent(q.discountFromTariffPct)}`, status: 'Нужно утверждение', statusTone: 'warning', dueAt: q.updatedAt ?? tzIso(now), action: 'open' });
      }
      for (const c of d.contracts.filter((x) => x.financeDiffers && !x.financeApprovedByName && x.status === 'draft')) {
        items.push({ id: `${c.id}:finance`, type: 'contract', entityId: c.id, who: c.clientName, details: `${c.number} · финансовые условия отличаются от котировки`, status: 'Утвердить условия', statusTone: 'warning', dueAt: c.createdAt, action: 'open' });
      }
    }
    if (can(user, 'contracts.legal_approve') && (type === 'all' || type === 'contract' || type === 'endorsement')) {
      for (const c of d.contracts.filter((x) => x.status === 'legal_review')) {
        items.push({ id: c.id, type: 'contract', entityId: c.id, who: c.clientName, details: `${c.number} · изменено пунктов: ${c.clauseOverrides.length}`, status: 'На согласовании', statusTone: 'warning', dueAt: c.createdAt, action: 'open' });
      }
      for (const e of d.endorsements.filter((x) => x.status === 'legal_review')) {
        items.push({ id: e.id, type: 'endorsement', entityId: e.id, who: e.number, details: `изменено пунктов: ${e.clauseOverrides.length}`, status: 'На согласовании', statusTone: 'warning', dueAt: e.createdAt ?? tzIso(now), action: 'open' });
      }
    }
    if (can(user, 'deals.manage') && (type === 'all' || type === 'deal')) {
      const days = dmsParam('paperOriginalReminderDays');
      for (const deal of d.deals.filter((x) => x.stage !== 'lost')) {
        const c = dealContract(d, deal.id);
        const name = toDealView(d, deal).clientName;
        if (deal.stage === 'kp_accepted') items.push({ id: deal.id, type: 'deal', entityId: deal.id, who: name, details: `${deal.number} · КП принято`, status: 'Подготовить договор', statusTone: 'info', dueAt: deal.updatedAt, action: 'open' });
        if (c?.status === 'draft' && c.legalComment) items.push({ id: `${deal.id}:legal`, type: 'deal', entityId: deal.id, who: name, details: `${c.number} · ${c.legalComment.slice(0, 60)}`, status: 'Юрист вернул', statusTone: 'warning', dueAt: deal.updatedAt, action: 'open' });
        if (c && originalReminderDue(c.signing, now, days)) items.push({ id: `${deal.id}:orig`, type: 'deal', entityId: deal.id, who: name, details: `${c.number} · оригинал не получен дольше ${days} дн.`, status: 'Нет оригинала', statusTone: 'warning', dueAt: c.signing.client?.signedAt ?? deal.updatedAt, action: 'open' });
        const overdue = c ? d.invoices.filter((i) => i.contractId === c.id && i.status === 'overdue') : [];
        if (overdue.length) items.push({ id: `${deal.id}:pay`, type: 'deal', entityId: deal.id, who: name, details: `${c!.number} · просрочено взносов: ${overdue.length}`, status: 'Просрочка оплаты', statusTone: 'danger', dueAt: overdue[0]!.dueDate, action: 'open' });
      }
    }
    if (can(user, 'payments.record') && (type === 'all' || type === 'invoice')) {
      for (const i of d.invoices.filter((x) => x.contractId && x.status !== 'paid' && parseIso(x.dueDate) - now <= 7 * DAY)) {
        items.push({ id: i.id, type: 'invoice', entityId: i.id, who: d.clients.find((c) => c.id === i.clientId)?.name ?? 'Клиент', details: `${i.number} · ${formatMoney(i.amount - (i.paid ?? 0))}`, status: i.status === 'overdue' ? 'Просрочен' : 'К оплате', statusTone: i.status === 'overdue' ? 'danger' : 'info', dueAt: tzIso(parseIso(i.dueDate)), action: 'open' });
      }
    }
  }
  // The curator keeps service and KPIs of assistances: SLA breaches and complaints (LIFECYCLE_SPEC §2).
  if ((assistanceTab || type === 'assistance_sla' || type === 'complaint') && can(user, 'assist.cases.manage', { sub: 'complaint' })) {
    for (const a of d.assistances) {
      const breached = d.cases.filter((c) => c.assistanceId === a.id && c.status !== 'resolved' && parseIso(c.slaDueAt) < now);
      if (breached.length && type !== 'complaint') {
        items.push({
          id: breached[0]!.id,
          type: 'assistance_sla',
          entityId: a.id,
          who: a.name,
          details: `Обращений с нарушенным SLA: ${breached.length}`,
          status: 'SLA нарушен',
          statusTone: 'danger',
          dueAt: breached.map((c) => c.slaDueAt).sort()[0]!,
          action: 'open',
        });
      }
    }
    if (type !== 'assistance_sla') {
      for (const c of d.cases) {
        if (c.type !== 'complaint' || c.status === 'resolved') continue;
        items.push({
          id: c.id,
          type: 'complaint',
          entityId: c.assistanceId,
          who: c.insuredName,
          details: `${c.number} · ${assistanceName(d, c.assistanceId) ?? 'Ассистанс'} · ${c.description.slice(0, 60)}`,
          status: 'Жалоба',
          statusTone: 'danger',
          dueAt: c.slaDueAt,
          action: 'open',
        });
      }
    }
  }
  return items.sort((a, b) => (a.dueAt < b.dueAt ? -1 : 1));
}

export const dashboardHandlers = [
  http.get(
    `${API}/dashboard`,
    route(({ request }) => {
      const { user } = requireSession(request);
      requireStaff(user);
      const d = db();
      const now = Date.now();
      const out: DashboardSummary = {
        firstName: user.displayName.split(' ')[0] ?? user.displayName,
        queueCount: queueFor(d, user, 'all', now).length,
        kpis: kpisFor(d, user, now),
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
      const type = (['appointment', 'claim', 'renewal', 'guarantee', 'registry', 'clinic_no_response', 'policy_change', 'escalation', 'rebill', 'assistance_sla', 'complaint', 'assistance', 'deal', 'quote', 'contract', 'endorsement', 'invoice', 'appeal'] as const).find((x) => x === t) ?? 'all';
      return queueFor(db(), user, type, Date.now()).slice(0, 50);
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
        { name: 'API клиник', status: 'degraded', lastSyncAt: tzIso(now - ((s % 17) + 12) * 60_000), queue: (s % 11) + 3 },
        { name: 'MyID', status: 'ok', lastSyncAt: tzIso(now - ((s % 4) + 1) * 60_000), queue: 0 },
        { name: 'Didox', status: 'ok', lastSyncAt: tzIso(now - ((s % 30) + 20) * 60_000), queue: 1 },
      ];
      return list;
    }),
  ),
];
