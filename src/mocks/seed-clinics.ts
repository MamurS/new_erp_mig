/*
 * Seed of the clinic cabinet and integration (CLINIC_SPEC §10). Runs after the main seed with its
 * own RNG stream, so the rest of the demo data stays exactly as before.
 */
import { DMS_DEFAULTS } from '@/shared/config/dmsParameters';
import type { Appointment, Clinic, GuaranteeStatus, PriceListItem, Registry, RegistryLine, ServiceCategory, Visit } from '@/shared/types';
import { registryTotals, VISIT_TTL_MS } from '@/shared/domain/clinics';
import { docNumber } from '@/shared/domain/numbering';
import type {
  ApiCallLogRow,
  ClinicEventRow,
  ClinicUserRow,
  Db,
  GuaranteeRow,
  IntegrationClientRow,
  InsuredRow,
  StaffRow,
  WebhookDeliveryRow,
  WebhookEndpointRow,
} from './db';
import { DEMO_CLINIC_USERS, DEMO_PASSWORD } from './credentials';
import { chance, int, mulberry32, pick, SEED, uuidFrom, type Rng } from './rng';
import { at, DAY, isoDay, parseIso, tzIso } from './time';

type Catalogue = [code: string, name: string, category: ServiceCategory, price: number, gp?: true][];

/** 42 services; the 10 marked `true` need a guarantee letter. The last two are excluded by the coverage rules (AI_COVERAGE_SPEC). */
const CATALOGUE: Catalogue = [
  ['TH-101', 'Приём терапевта', 'outpatient', 180_000],
  ['TH-102', 'Повторный приём терапевта', 'outpatient', 120_000],
  ['PD-101', 'Приём педиатра', 'outpatient', 180_000],
  ['CR-101', 'Приём кардиолога', 'outpatient', 250_000],
  ['CR-110', 'ЭКГ с расшифровкой', 'outpatient', 90_000],
  ['CR-120', 'Эхокардиография', 'outpatient', 350_000],
  ['GY-101', 'Приём гинеколога', 'outpatient', 220_000],
  ['GY-110', 'УЗИ органов малого таза', 'outpatient', 200_000],
  ['EN-101', 'Приём ЛОР-врача', 'outpatient', 200_000],
  ['EN-110', 'Промывание миндалин', 'outpatient', 120_000],
  ['NE-101', 'Приём невролога', 'outpatient', 250_000],
  ['OP-101', 'Приём офтальмолога', 'outpatient', 200_000],
  ['OP-110', 'Проверка остроты зрения', 'outpatient', 60_000],
  ['LB-201', 'Общий анализ крови', 'outpatient', 60_000],
  ['LB-202', 'Биохимический анализ крови', 'outpatient', 180_000],
  ['LB-203', 'Общий анализ мочи', 'outpatient', 45_000],
  ['LB-204', 'Гормоны щитовидной железы', 'outpatient', 220_000],
  ['LB-205', 'Коагулограмма', 'outpatient', 150_000],
  ['DG-301', 'УЗИ органов брюшной полости', 'outpatient', 220_000],
  ['DG-302', 'УЗИ щитовидной железы', 'outpatient', 150_000],
  ['DG-303', 'Рентген грудной клетки', 'outpatient', 160_000],
  ['DG-304', 'Флюорография', 'outpatient', 70_000],
  ['DG-310', 'МРТ головного мозга', 'diagnostics_advanced', 1_800_000, true],
  ['DG-311', 'МРТ позвоночника', 'diagnostics_advanced', 2_200_000, true],
  ['DG-312', 'КТ органов грудной клетки', 'diagnostics_advanced', 1_500_000, true],
  ['DG-313', 'КТ брюшной полости с контрастом', 'diagnostics_advanced', 2_600_000, true],
  ['DT-401', 'Осмотр стоматолога', 'dental', 120_000],
  ['DT-402', 'Лечение кариеса', 'dental', 450_000],
  ['DT-403', 'Профессиональная чистка зубов', 'dental', 400_000],
  ['DT-404', 'Удаление зуба', 'dental', 300_000],
  ['DT-405', 'Прицельный рентген зуба', 'dental', 60_000],
  ['MD-501', 'Внутримышечная инъекция', 'medicines', 40_000],
  ['MD-502', 'Капельница', 'medicines', 150_000],
  ['MD-503', 'Вакцинация от гриппа', 'medicines', 180_000],
  ['IP-601', 'Госпитализация, сутки в палате', 'inpatient', 1_200_000, true],
  ['IP-602', 'Аппендэктомия', 'inpatient', 9_500_000, true],
  ['IP-603', 'Лапароскопическая холецистэктомия', 'inpatient', 14_000_000, true],
  ['IP-604', 'Операция на коленном суставе', 'inpatient', 26_000_000, true],
  ['IP-605', 'Реанимация, сутки', 'inpatient', 4_500_000, true],
  ['IP-606', 'Родоразрешение', 'inpatient', 12_000_000, true],
  ['CL-102', 'Чистка лица', 'outpatient', 300_000],
  ['DP-101', 'Коронка металлокерамическая', 'dental', 2_500_000],
];
/** Services the seeded registries never use (they are excluded by the program). */
const NOT_IN_SEED = new Set(['CL-102', 'DP-101']);

const ICD = ['J06.9', 'J20.9', 'I10', 'K29.7', 'M54.5', 'E11.9', 'N39.0', 'H10.9', 'K80.2', 'S83.2', 'G43.9', 'K35.8', 'O80', 'K02.1', 'R51'];

function hex(rng: Rng, n: number): string {
  let s = '';
  for (let i = 0; i < n; i++) s += Math.floor(rng() * 16).toString(16);
  return s;
}

function priceListFor(rng: Rng, xss: boolean, demo: boolean): PriceListItem[] {
  const factor = 0.9 + rng() * 0.3;
  return CATALOGUE.map(([code, name, category, price, gp], i) => ({
    code,
    name: xss && demo && i === 3 ? '<img src=x onerror=alert(1)>' : name,
    category,
    price: Math.round((price * factor) / 1000) * 1000,
    requiresGuarantee: !!gp,
  }));
}

export interface ClinicSeed
  extends Pick<
    Db,
    | 'clinicUsers'
    | 'priceLists'
    | 'visits'
    | 'guarantees'
    | 'guaranteeSeq'
    | 'registries'
    | 'integrationClients'
    | 'webhooks'
    | 'webhookDeliveries'
    | 'apiLogs'
    | 'clinicEvents'
    | 'misSlots'
  > {
  demoClinicId: string;
}

export function seedClinics(
  base: { clinics: Clinic[]; insured: InsuredRow[]; policies: Db['policies']; staff: StaffRow[]; appointments: Appointment[] },
  opts: { xss?: boolean; now: number },
): ClinicSeed {
  const rng = mulberry32(SEED ^ 0x0c11e1c5);
  const id = () => uuidFrom(rng);
  const { now } = opts;
  const today = parseIso(isoDay(now));
  const year = new Date(now).getFullYear();

  // «[Клиника 1]» is the clinic the demo insured person already visits.
  const demoClinic = base.clinics.find((c) => c.specialties.includes('therapist'))!;
  const apiClinics = base.clinics.filter((c) => c.id !== demoClinic.id && c.specialties.length >= 3).slice(0, 2);
  demoClinic.integrationMode = 'hybrid';
  for (const c of apiClinics) c.integrationMode = 'api';

  // ---- users ----
  const clinicUsers: ClinicUserRow[] = DEMO_CLINIC_USERS.map((u) => ({
    id: id(),
    email: u.email,
    password: DEMO_PASSWORD,
    fullName: u.fullName,
    clinicId: demoClinic.id,
    role: u.role,
    active: true,
    createdAt: tzIso(now - 200 * DAY),
    lastLoginAt: tzIso(now - int(rng, 1, 30) * 3600_000),
  }));
  clinicUsers.push({
    id: id(),
    email: 'reception2@demo-clinic.uz',
    password: DEMO_PASSWORD,
    fullName: 'Nazarova Sevara Akmalovna',
    clinicId: demoClinic.id,
    role: 'clinic_registrar',
    active: true,
    createdAt: tzIso(now - 90 * DAY),
  });
  for (const [i, c] of apiClinics.entries()) {
    clinicUsers.push({
      id: id(),
      email: `admin@api-clinic${i + 1}.example.uz`,
      password: DEMO_PASSWORD,
      fullName: pick(rng, ['Hakimov Aziz Rustamovich', 'Rashidova Lola Anvarovna', 'Yoʻldoshev Ilhom Temurovich']),
      clinicId: c.id,
      role: 'clinic_admin',
      active: true,
      createdAt: tzIso(now - 120 * DAY),
    });
  }

  // ---- price lists ----
  const priceLists = base.clinics.map((c) => ({ clinicId: c.id, items: priceListFor(rng, !!opts.xss, c.id === demoClinic.id) }));
  const demoPrices = priceLists.find((p) => p.clinicId === demoClinic.id)!.items;
  const item = (code: string) => demoPrices.find((p) => p.code === code)!;

  // ---- appointments of the demo clinic: 25 requests, 5 unanswered (2 overdue) ----
  for (const a of base.appointments) {
    if (a.clinicId === demoClinic.id && a.status === 'requested') {
      a.status = 'confirmed';
      a.respondedBy = 'clinic';
      a.respondedAt = tzIso(parseIso(a.createdAt) + 40 * 60_000);
    }
  }
  const people = base.insured.filter((i) => i.status === 'active');
  const clinicAppointments: Appointment[] = [];
  for (let k = 0; k < 25; k++) {
    const who = pick(rng, people);
    const unanswered = k < 5;
    const overdue = k < 2;
    const startsMs = at(today + int(rng, 1, 10) * DAY, int(rng, 9, 17), pick(rng, [0, 30]));
    const createdMs = unanswered ? now - (overdue ? int(rng, 3, 6) * 3600_000 : int(rng, 10, 50) * 60_000) : now - int(rng, 1, 8) * DAY;
    const declined = !unanswered && k % 6 === 0;
    clinicAppointments.push({
      id: id(),
      insuredId: who.id,
      insuredName: who.fullName,
      clientName: who.clientName,
      clinicId: demoClinic.id,
      clinicName: demoClinic.name,
      specialty: pick(rng, demoClinic.specialties),
      startsAt: tzIso(startsMs),
      status: unanswered ? 'requested' : declined ? 'declined' : 'confirmed',
      createdAt: tzIso(createdMs),
      ...(unanswered ? {} : { respondedBy: 'clinic' as const, respondedAt: tzIso(createdMs + int(rng, 10, 90) * 60_000) }),
      ...(declined ? { declineReason: 'Врач в отпуске, предложим другое время по телефону' } : {}),
    });
  }
  base.appointments.push(...clinicAppointments);

  // ---- visits: three months back for registries, a few today ----
  const policyOf = (i: InsuredRow) => base.policies.find((p) => p.id === i.policyId);
  const monthStart = (offset: number) => {
    const d = new Date(now);
    d.setDate(1);
    d.setMonth(d.getMonth() - offset);
    return parseIso(isoDay(d.getTime()));
  };
  const eligible = people.filter((i) => {
    const p = policyOf(i);
    return p && p.status === 'active' && parseIso(p.startDate) <= monthStart(2);
  });
  const visits: Visit[] = [];
  const registrar = clinicUsers[0]!;
  const openVisit = (who: InsuredRow, openedMs: number, method: Visit['method'] = 'policy') => {
    const v: Visit = {
      id: id(),
      clinicId: demoClinic.id,
      insuredId: who.id,
      openedById: registrar.id,
      method,
      openedAt: tzIso(openedMs),
      expiresAt: tzIso(openedMs + VISIT_TTL_MS),
    };
    visits.push(v);
    return v;
  };
  const visitsByMonth: Visit[][] = [[], [], []];
  for (let m = 2; m >= 0; m--) {
    const start = monthStart(m);
    const lastDay = m === 0 ? today - DAY : monthStart(m - 1) - DAY;
    const count = m === 0 ? 8 : 18;
    for (let k = 0; k < count; k++) {
      const day = start + int(rng, 0, Math.max(0, Math.round((lastDay - start) / DAY))) * DAY;
      visitsByMonth[m]!.push(openVisit(pick(rng, eligible), at(Math.min(day, lastDay), int(rng, 9, 16), pick(rng, [0, 15, 30, 45]))));
    }
  }
  for (let k = 0; k < 3; k++) openVisit(pick(rng, eligible), now - int(rng, 1, 5) * 3600_000, k === 0 ? 'qr' : 'policy');

  // ---- guarantee letters: 12 in every status ----
  const doctors = base.staff.filter((s) => s.role === 'doctor_expert');
  const guarantees: GuaranteeRow[] = [];
  let guaranteeSeq = 320;
  const gpServices = demoPrices.filter((p) => p.requiresGuarantee);
  const statuses: GuaranteeStatus[] = ['requested', 'requested', 'requested', 'info_requested', 'info_requested', 'approved', 'approved', 'approved', 'rejected', 'rejected', 'used', 'expired'];
  const recentVisits = visits.slice(-6);
  statuses.forEach((status, k) => {
    // A «used» letter is billed in last month's registry, so its visit must be in that month.
    const v = k < 6 ? pick(rng, recentVisits) : pick(rng, status === 'used' ? visitsByMonth[1]! : [...visitsByMonth[1]!, ...visitsByMonth[0]!]);
    const who = base.insured.find((i) => i.id === v.insuredId)!;
    const svc = k === 0 ? item('IP-604') : pick(rng, gpServices);
    const created = parseIso(v.openedAt) + 30 * 60_000;
    const decided = status === 'approved' || status === 'used' || status === 'expired';
    const bigFirst = k === 0; // above the threshold, one approval already in
    guarantees.push({
      id: id(),
      number: docNumber('guarantee', { year, n: ++guaranteeSeq }),
      clinicId: demoClinic.id,
      visitId: v.id,
      insuredId: who.id,
      insuredName: who.fullName,
      serviceCode: svc.code,
      serviceName: svc.name,
      icd10: pick(rng, ICD),
      estimatedCost: svc.price,
      approvedAmount: decided ? svc.price : undefined,
      validUntil: decided ? isoDay(status === 'expired' ? now - 3 * DAY : created + DMS_DEFAULTS.guaranteeValidityDays * DAY) : undefined,
      status,
      approvals:
        decided || bigFirst
          ? [{ byId: doctors[0]!.id, byName: doctors[0]!.fullName, at: tzIso(created + 3600_000) }, ...(decided && svc.price > DMS_DEFAULTS.guaranteeDualApprovalThreshold && doctors[1] ? [{ byId: doctors[1].id, byName: doctors[1].fullName, at: tzIso(created + 2 * 3600_000) }] : [])]
          : [],
      reason:
        status === 'rejected'
          ? 'Показания к операции не подтверждены: приложите заключение специалиста'
          : status === 'info_requested'
            ? 'Приложите направление и результаты обследования'
            : undefined,
        comment: opts.xss && k === 1 ? '"><script>alert(1)</script>' : 'Плановое обследование по направлению лечащего врача',
      attachments: [],
      createdAt: tzIso(created),
    });
  });

  // ---- registries: paid, partially accepted (4 rejected, 1 disputed), current draft ----
  const lineFor = (v: Visit, code: string, guarantee?: GuaranteeRow): RegistryLine => {
    const svc = item(code);
    const who = base.insured.find((i) => i.id === v.insuredId)!;
    const quantity = code.startsWith('LB') ? int(rng, 1, 2) : 1;
    return {
      id: id(),
      visitId: v.id,
      insuredName: who.fullName,
      serviceDate: isoDay(parseIso(v.openedAt)),
      serviceCode: svc.code,
      serviceName: svc.name,
      icd10: pick(rng, ICD),
      quantity,
      price: svc.price,
      amount: svc.price * quantity,
      guaranteeNumber: guarantee?.number,
      status: 'pending',
    };
  };
  const simpleCodes = CATALOGUE.filter((c) => !c[4] && !NOT_IN_SEED.has(c[0])).map((c) => c[0]);
  const periodOf = (m: number) => isoDay(monthStart(m)).slice(0, 7);
  const registries: Registry[] = [];
  const usedGuarantee = guarantees.find((g) => g.status === 'used')!;
  for (const m of [2, 1]) {
    const lines = visitsByMonth[m]!.flatMap((v) => [lineFor(v, 'TH-101'), ...(chance(rng, 0.5) ? [lineFor(v, pick(rng, simpleCodes))] : [])]);
    if (m === 1) {
      const gv = visits.find((v) => v.id === usedGuarantee.visitId)!;
      if (gv) lines.push({ ...lineFor(gv, usedGuarantee.serviceCode, usedGuarantee), serviceDate: isoDay(parseIso(gv.openedAt)) });
    }
    lines.forEach((l, k) => {
      l.status = 'accepted';
      if (m === 1 && k < 4) {
        l.status = k === 0 ? 'disputed' : 'rejected';
        l.rejectionReason = ['Услуга не соответствует диагнозу', 'Дублирует строку за тот же день', 'Нет направления врача', 'Цена выше прайса договора'][k];
        if (k === 0) l.disputeComment = 'Направление было, прикладываем скан к реестру';
      }
    });
    const paid = m === 2;
    const submitted = monthStart(m - 1) + 3 * DAY;
    registries.push({
      id: id(),
      clinicId: demoClinic.id,
      period: periodOf(m),
      status: paid ? 'paid' : 'partially_accepted',
      source: 'portal',
      lines,
      totals: registryTotals(lines, paid),
      submittedAt: tzIso(submitted),
      paidAt: paid ? tzIso(submitted + 12 * DAY) : undefined,
    });
  }
  const draftLines = visitsByMonth[0]!.slice(0, 5).map((v) => lineFor(v, 'TH-101'));
  registries.push({ id: id(), clinicId: demoClinic.id, period: periodOf(0), status: 'draft', source: 'portal', lines: draftLines, totals: registryTotals(draftLines, false) });

  // ---- integration: one key, one webhook with a retrying and a failed delivery ----
  const key: IntegrationClientRow = {
    id: id(),
    clinicId: demoClinic.id,
    name: 'МИС «Medialog»',
    clientId: `mig_${hex(rng, 20)}`,
    secretLast4: hex(rng, 4),
    secretHash: hex(rng, 64), // the secret was shown once at creation and is unknown now
    scopes: ['coverage:check', 'appointments:read', 'appointments:write', 'slots:write', 'guarantees:read', 'guarantees:write', 'registries:read', 'registries:write', 'payments:read'],
    ipAllowlist: [],
    createdAt: tzIso(now - 60 * DAY),
    lastUsedAt: tzIso(now - 25 * 60_000),
  };
  const webhook: WebhookEndpointRow = {
    id: id(),
    clinicId: demoClinic.id,
    url: 'https://mis.demo-clinic.uz/mig/webhook',
    events: ['appointment.requested', 'appointment.cancelled', 'guarantee.decided', 'guarantee.documents_requested', 'registry.reviewed', 'registry.paid'],
    secretLast4: hex(rng, 4),
    signingSecret: hex(rng, 64),
    active: true,
    createdAt: tzIso(now - 60 * DAY),
  };
  const deliveries: WebhookDeliveryRow[] = [];
  const events = ['appointment.requested', 'guarantee.decided', 'registry.reviewed', 'appointment.cancelled', 'registry.paid'] as const;
  for (let k = 0; k < 8; k++) {
    const status: WebhookDeliveryRow['status'] = k === 0 ? 'retrying' : k === 1 ? 'failed' : 'delivered';
    const atMs = now - (k + 1) * 3 * 3600_000;
    const objectId = id();
    deliveries.push({
      id: id(),
      endpointId: webhook.id,
      clinicId: demoClinic.id,
      event: events[k % events.length]!,
      status,
      attempts: status === 'failed' ? 6 : status === 'retrying' ? 2 : 1,
      lastAttemptAt: tzIso(atMs),
      responseCode: status === 'delivered' ? 200 : k === 0 ? 503 : 500,
      objectId,
      body: '{}',
      signature: '',
      nextAttemptAt: status === 'retrying' ? tzIso(atMs + 5 * 60_000) : undefined,
    });
  }
  const templates = ['/coverage/check', '/appointments', '/appointments/{id}/confirm', '/slots', '/guarantees/{id}', '/registries/{id}', '/payments'];
  const apiLogs: ApiCallLogRow[] = [];
  for (let k = 0; k < 40; k++) {
    const path = pick(rng, templates);
    const status = k % 13 === 0 ? 404 : k % 17 === 0 ? 422 : 200;
    apiLogs.push({
      id: id(),
      clinicId: demoClinic.id,
      clientId: key.clientId,
      at: tzIso(now - k * 37 * 60_000 - int(rng, 0, 600) * 1000),
      method: path === '/slots' ? 'PUT' : path.includes('confirm') || path === '/coverage/check' ? 'POST' : 'GET',
      pathTemplate: path,
      status,
      latencyMs: int(rng, 40, 380),
    });
  }

  const clinicEvents: ClinicEventRow[] = [
    { id: id(), clinicId: demoClinic.id, at: tzIso(now - 20 * 60_000), text: 'Новая заявка на запись к терапевту' },
    { id: id(), clinicId: demoClinic.id, at: tzIso(now - 2 * 3600_000), text: `Гарантийное письмо ${guarantees[5]!.number} одобрено` },
    { id: id(), clinicId: demoClinic.id, at: tzIso(now - 5 * 3600_000), text: `По гарантийному письму ${guarantees[3]!.number} нужны документы` },
    { id: id(), clinicId: demoClinic.id, at: tzIso(now - 2 * DAY), text: `Реестр за ${periodOf(1)} проверен: принят частично` },
    { id: id(), clinicId: demoClinic.id, at: tzIso(now - 20 * DAY), text: `Реестр за ${periodOf(2)} оплачен` },
  ];

  // One letter of another clinic: clinic isolation (CLINIC_SPEC §9.9) has something to hide.
  const foreignClinic = apiClinics[0];
  const foreignAdmin = clinicUsers.find((u) => u.clinicId === foreignClinic?.id);
  const firstVisit = visits[0];
  if (foreignClinic && foreignAdmin && firstVisit) {
    const who = base.insured.find((i) => i.id === firstVisit.insuredId)!;
    const fv: Visit = { ...firstVisit, id: id(), clinicId: foreignClinic.id, openedById: foreignAdmin.id };
    visits.push(fv);
    const svc = item('DG-310');
    guarantees.push({
      id: id(),
      number: docNumber('guarantee', { year, n: ++guaranteeSeq }),
      clinicId: foreignClinic.id,
      visitId: fv.id,
      insuredId: who.id,
      insuredName: who.fullName,
      serviceCode: svc.code,
      serviceName: svc.name,
      icd10: 'G43.9',
      estimatedCost: svc.price,
      status: 'requested',
      approvals: [],
      comment: 'Плановое обследование',
      attachments: [],
      createdAt: fv.openedAt,
    });
  }

  return {
    demoClinicId: demoClinic.id,
    clinicUsers,
    priceLists,
    visits,
    guarantees,
    guaranteeSeq,
    registries,
    integrationClients: [key],
    webhooks: [webhook],
    webhookDeliveries: deliveries,
    apiLogs,
    clinicEvents,
    misSlots: [],
  };
}
