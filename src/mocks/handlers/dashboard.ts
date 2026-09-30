import { http } from 'msw';
import type { AuditEntry, SessionUser } from '@/shared/types';
import type { AttentionItem, DashboardSummary, IntegrationStatus, Kpi, QueueItem, QueueType } from '@/shared/types/dto';
import { can } from '@/shared/auth/permissions';
import { isStaffRole, SPECIALTY_LABEL } from '@/shared/domain/labels';
import { CLAIM_CATEGORY_LABEL, CLAIM_STATUS_LABEL } from '@/shared/domain/claims';
import { formatMoney } from '@/shared/lib/format';
import { db, hasLiveKp, type Db } from '../db';
import { isOverdueRequest } from '../clinic-core';
import { API, forbidden, requireSession, route } from '../http';
import { DAY, isoDay, parseIso, startOfDay, tzIso } from '../time';

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
      const loss = d.clients.filter((c) => (c.lossRatio ?? 0) >= 0.8);
      return [
        { key: 'policies', label: 'Активные полисы', value: activePolicies, format: 'number', to: '/staff/policies?status=active' },
        { key: 'renewals', label: 'Продления за 30 дней', value: soon.length, format: 'number', to: '/staff/clients?view=renewals' },
        { key: 'loss', label: 'Убыточность > 80%', value: loss.length, format: 'number', tone: loss.length ? 'warning' : 'default', to: '/staff/clients?view=loss' },
        { key: 'premium', label: 'Премия портфеля', value: d.policies.filter((p) => p.status === 'active').reduce((s, p) => s + p.premium, 0), format: 'money' },
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
    out.push({ key: 'high_loss_ratio', label: 'Убыточность выше 80%', count: d.clients.filter((c) => (c.lossRatio ?? 0) >= 0.8).length, to: '/staff/clients?view=loss' });
  }
  if (can(user, 'claims.read')) {
    out.push({ key: 'sla_overdue', label: 'Убытки с просроченным SLA', count: d.claims.filter((c) => isOverdue(c, now)).length, to: '/staff/claims?overdue=1' });
  }
  return out;
}

export function queueFor(d: Db, user: SessionUser, type: QueueType | 'all', now: number): QueueItem[] {
  const items: QueueItem[] = [];
  if ((type === 'all' || type === 'appointment' || type === 'clinic_no_response') && can(user, 'appointments.read')) {
    for (const a of d.appointments) {
      if (a.status !== 'requested' || parseIso(a.startsAt) < now - 3600_000) continue;
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
    };
    const statuses = relevant[user.role] ?? [];
    for (const c of d.claims) {
      if (!statuses.includes(c.status)) continue;
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
  if ((type === 'all' || type === 'guarantee') && can(user, 'guarantees.decide')) {
    for (const g of d.guarantees) {
      if (g.status !== 'requested' || g.approvals.some((x) => x.byId === user.id)) continue;
      const second = g.approvals.length > 0;
      items.push({
        id: g.id,
        type: 'guarantee',
        entityId: g.id,
        who: g.insuredName,
        details: `${g.number} · ${g.serviceName} · ${formatMoney(g.approvedAmount ?? g.estimatedCost)}`,
        status: second ? 'Нужно второе одобрение' : 'Нужно решение',
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
      const pending = r.lines.filter((l) => l.status === 'pending').length;
      const disputed = r.lines.filter((l) => l.status === 'disputed').length;
      const toReview = review && (r.status === 'submitted' || r.status === 'in_review' || disputed > 0);
      const toPay = pay && (r.status === 'accepted' || r.status === 'partially_accepted') && disputed === 0;
      if (!toReview && !toPay) continue;
      const clinic = d.clinics.find((c) => c.id === r.clinicId);
      items.push({
        id: r.id,
        type: 'registry',
        entityId: r.id,
        who: clinic?.name ?? 'Клиника',
        details: `Реестр за ${r.period} · ${formatMoney(toPay ? r.totals.accepted : r.totals.claimed)}`,
        status: toPay ? 'К оплате' : disputed && !pending ? `Оспорено строк: ${disputed}` : `На проверке: ${pending + disputed}`,
        statusTone: toPay ? 'success' : 'warning',
        dueAt: tzIso(parseIso(r.submittedAt ?? tzIso(now)) + 5 * DAY),
        action: 'open',
      });
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
      const type = (['appointment', 'claim', 'renewal', 'guarantee', 'registry', 'clinic_no_response'] as const).find((x) => x === t) ?? 'all';
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
