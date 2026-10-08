/*
 * The screen map of the portals, shared by the web app and the API (the API's help answers carry the same
 * «Открыть раздел» links as the mock): which part of the guide explains each screen («?» opens it), who may open
 * a route, and which screens the guide mentions by name («Ручная разноска», «Параметры ДМС»…).
 *
 * Every route of apps/web/src/app/router.tsx must be listed in ROUTE_HELP (checked by the web's routeMap.test.ts)
 * and every screen name of SCREENS must appear in docs/help/USER_GUIDE.ru.md. A new screen therefore needs a
 * line here and a mention in the guide (see CLAUDE.md, «Справка»). The navigation of the portals takes its
 * section roles from here (STAFF_SECTION_ROLES, ASSIST_SECTION_ROLES).
 */
import type { AssistanceRole, Role, StaffRole } from '@mig/contracts';
import { translate, type I18nKey } from '@mig/i18n';
import { ruleFor, type Action } from '../auth/permissions';
import { ASSISTANCE_ROLES, CLINIC_ROLES, STAFF_ROLES } from '../labels';

/** Every role (the audience «all» of the guide). */
export const ALL_ROLES: readonly Role[] = [
  ...STAFF_ROLES,
  'hr',
  'insured',
  ...CLINIC_ROLES,
  ...ASSISTANCE_ROLES,
];

const STAFF_ALL: StaffRole[] = [
  'operator',
  'underwriter',
  'doctor_expert',
  'accountant',
  'admin',
  'sales_manager',
  'legal',
  'claims_officer',
];

/** Route access matrix of the MIG portal (SPEC §3): section path → roles (the navigation uses it too). */
export const STAFF_SECTION_ROLES: Readonly<Record<string, StaffRole[]>> = {
  '/staff': STAFF_ALL,
  '/staff/deals': ['sales_manager', 'underwriter'],
  '/staff/quotes': ['sales_manager', 'underwriter'],
  '/staff/clients': ['operator', 'underwriter', 'accountant', 'admin', 'sales_manager', 'legal'],
  '/staff/contracts': ['operator', 'underwriter', 'accountant', 'sales_manager', 'legal'],
  '/staff/endorsements': ['underwriter', 'sales_manager', 'legal', 'accountant'],
  '/staff/invoices': ['underwriter', 'accountant', 'sales_manager'],
  '/staff/invoices/queue': ['accountant'],
  '/staff/policies': ['operator', 'underwriter', 'accountant', 'sales_manager'],
  '/staff/claims': ['operator', 'doctor_expert', 'accountant', 'claims_officer'],
  '/staff/appointments': ['operator', 'doctor_expert'],
  '/staff/clinics': ['operator', 'underwriter', 'doctor_expert', 'admin'],
  '/staff/guarantees': ['operator', 'doctor_expert'],
  '/staff/registries': ['operator', 'accountant'],
  '/staff/assistance': STAFF_ALL,
  '/staff/rebills': ['claims_officer', 'accountant'],
  '/staff/qa': ['doctor_expert'],
  '/staff/policy-changes': ['operator', 'underwriter', 'accountant'],
  '/staff/limit-requests': ['operator', 'underwriter'],
  '/staff/reports': ['underwriter', 'accountant'],
  '/staff/reports/reserves': ['claims_officer', 'underwriter', 'accountant'],
  '/staff/audit': ['admin'],
  '/staff/admin/users': ['admin'],
  '/staff/admin/parameters': STAFF_ALL,
  '/staff/admin/ai': ['admin'],
  '/staff/admin/migration': ['admin'],
};

/** Roles that open the card of an insured person in the MIG portal. */
export const INSURED_CARD_ROLES: StaffRole[] = ['operator', 'underwriter', 'doctor_expert', 'claims_officer'];

const ASSIST_ALL: AssistanceRole[] = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'];

/** Sections of the assistance portal and who sees them (ASSISTANCE_SPEC §6). */
export const ASSIST_SECTION_ROLES: Readonly<Record<string, AssistanceRole[]>> = {
  '/assist': ASSIST_ALL,
  '/assist/insured': ['asst_operator', 'asst_doctor'],
  '/assist/cases': ['asst_operator', 'asst_doctor'],
  '/assist/appointments': ['asst_operator'],
  '/assist/chat': ['asst_operator'],
  '/assist/guarantees': ['asst_doctor', 'asst_operator'],
  '/assist/registries': ['asst_doctor', 'asst_billing'],
  '/assist/rebills': ['asst_billing'],
  '/assist/clinics': ASSIST_ALL,
  '/assist/users': ['asst_admin'],
  '/assist/integration': ['asst_admin'],
};

const sections = <R extends Role>(m: Readonly<Record<string, R[]>>) =>
  Object.entries(m).map(([path, roles]) => ({ path, roles }));
const STAFF_SECTIONS = sections(STAFF_SECTION_ROLES);
const ASSIST_SECTIONS = sections(ASSIST_SECTION_ROLES);

/** Route pattern (as in the router, full path) → anchor of the guide. */
export const ROUTE_HELP: Readonly<Record<string, string>> = {
  // public pages
  '/login': 'login',
  '/login/otp': 'login',
  '/app/login': 'login',
  '/app/login/code': 'login',
  '/app/consent': 'login',
  // MIG portal
  '/staff': 'staff-roles',
  '/staff/clients': 'new-client',
  '/staff/clients/:clientId': 'new-client',
  '/staff/clients/:clientId/loss': 'renewal',
  '/staff/clients/:clientId/kp/new': 'kp',
  '/staff/clients/:clientId/policies/new': 'policy-issue',
  '/staff/deals': 'new-client',
  '/staff/deals/:dealId': 'new-client',
  '/staff/deals/:dealId/census': 'census',
  '/staff/quotes/:quoteId': 'quote',
  '/staff/contracts': 'contract',
  '/staff/contracts/:contractId': 'contract',
  '/staff/endorsements': 'endorsement',
  '/staff/endorsements/:endorsementId': 'endorsement',
  '/staff/invoices': 'invoices',
  '/staff/invoices/queue': 'manual-allocation',
  '/staff/reports/reserves': 'claims-reserves',
  '/staff/kp/:kpId': 'kp',
  '/staff/insured/:insuredId': 'security-pii',
  '/staff/policies': 'policy-issue',
  '/staff/policies/:policyId': 'policy-issue',
  '/staff/claims': 'claims-workplace',
  '/staff/claims/:claimId': 'claims-decision',
  '/staff/appointments': 'appointment',
  '/staff/clinics': 'admin-partners',
  '/staff/clinics/:clinicId': 'admin-partners',
  '/staff/guarantees': 'guarantee-letter',
  '/staff/registries': 'monthly-registry',
  '/staff/registries/:registryId': 'monthly-registry',
  '/staff/assistance': 'assistance-in-mig',
  '/staff/assistance/:assistanceId': 'assistance-in-mig',
  '/staff/rebills': 'assistance-rebill',
  '/staff/rebills/:rebillId': 'assistance-rebill',
  '/staff/qa': 'assistance-qa',
  '/staff/policy-changes': 'enrolment',
  '/staff/limit-requests': 'role-underwriter',
  '/staff/reports': 'claims-journal',
  '/staff/audit': 'admin-audit',
  '/staff/admin/users': 'admin-users',
  '/staff/admin/ai': 'admin-ai',
  '/staff/admin/parameters': 'admin-params',
  '/staff/admin/migration': 'portfolio-migration',
  '/staff/admin/migration/:batchId': 'migration-apply',
  '/staff/help': 'using-help',
  '/staff/help/:anchor': 'using-help',
  // HR cabinet
  '/hr': 'guide-hr',
  '/hr/employees/new': 'enrolment',
  '/hr/family': 'family',
  '/hr/family/new': 'family',
  '/hr/family/requests': 'family',
  '/hr/import': 'enrolment',
  '/hr/documents': 'guide-hr',
  '/hr/kp/:kpId': 'kp',
  '/hr/contracts': 'signing-methods',
  '/hr/contracts/:contractId': 'signing-methods',
  '/hr/endorsements/:endorsementId': 'signing-methods',
  '/hr/stats': 'guide-hr',
  '/hr/help': 'using-help',
  '/hr/help/:anchor': 'using-help',
  // clinic cabinet
  '/clinic': 'guide-clinic',
  '/clinic/check': 'patient-check',
  '/clinic/visits/:visitId': 'guarantee-letter',
  '/clinic/appointments': 'appointment',
  '/clinic/guarantees': 'guarantee-letter',
  '/clinic/documents': 'clinic-prices',
  '/clinic/registries': 'monthly-registry',
  '/clinic/registries/:registryId': 'monthly-registry',
  '/clinic/users': 'guide-clinic',
  '/clinic/integration': 'admin-integrations',
  '/clinic/help': 'using-help',
  '/clinic/help/:anchor': 'using-help',
  // assistance portal
  '/assist': 'guide-assistance',
  '/assist/insured': 'assistance-daily',
  '/assist/insured/:insuredId': 'assistance-daily',
  '/assist/cases': 'assistance-daily',
  '/assist/cases/:caseId': 'assistance-daily',
  '/assist/appointments': 'appointment',
  '/assist/chat': 'guide-assistance',
  '/assist/guarantees': 'guarantee-letter',
  '/assist/guarantees/:guaranteeId': 'guarantee-letter',
  '/assist/registries': 'monthly-registry',
  '/assist/registries/:registryId': 'monthly-registry',
  '/assist/rebills': 'assistance-rebill',
  '/assist/rebills/:rebillId': 'assistance-rebill',
  '/assist/clinics': 'guide-assistance',
  '/assist/users': 'guide-assistance',
  '/assist/integration': 'admin-integrations',
  '/assist/help': 'using-help',
  '/assist/help/:anchor': 'using-help',
  // the insured person's app
  '/app': 'guide-insured',
  '/app/card': 'guide-insured',
  '/app/booking': 'appointment',
  '/app/appointments': 'appointment',
  '/app/claims': 'receipt-refund',
  '/app/claims/new': 'receipt-refund',
  '/app/claims/:claimId': 'receipt-refund',
  '/app/clinics': 'guide-insured',
  '/app/chat': 'guide-insured',
  '/app/profile': 'guide-insured',
  '/app/certificate': 'guide-insured',
  '/app/family': 'family',
  '/app/coverage': 'coverage-check',
  '/app/help': 'using-help',
  '/app/help/:anchor': 'using-help',
};

export type Portal = 'staff' | 'hr' | 'clinic' | 'assist' | 'app';

export function portalOfRole(role: Role): Portal {
  if ((STAFF_ROLES as readonly string[]).includes(role)) return 'staff';
  if ((CLINIC_ROLES as readonly string[]).includes(role)) return 'clinic';
  if ((ASSISTANCE_ROLES as readonly string[]).includes(role)) return 'assist';
  return role === 'hr' ? 'hr' : 'app';
}

export function portalOfRoute(route: string): Portal | null {
  const head = route.split('/')[1] ?? '';
  return head === 'staff' || head === 'hr' || head === 'clinic' || head === 'assist' || head === 'app'
    ? head
    : null;
}

const segs = (p: string) => p.split('/').filter(Boolean);

/** Whether a concrete path matches a route pattern (`:param` matches one segment). */
export function matchRoute(pattern: string, path: string): boolean {
  const a = segs(pattern);
  const b = segs(path.split(/[?#]/)[0] ?? '');
  return a.length === b.length && a.every((s, i) => s.startsWith(':') || s === b[i]);
}

/** The route pattern of ROUTE_HELP for a path: the most specific match, else the nearest parent. */
export function routePatternFor(path: string): string | null {
  let p = segs(path.split(/[?#]/)[0] ?? '');
  while (p.length) {
    const cur = `/${p.join('/')}`;
    const found = Object.keys(ROUTE_HELP)
      .filter((r) => matchRoute(r, cur))
      .sort(
        (x, y) =>
          segs(y).filter((s) => !s.startsWith(':')).length - segs(x).filter((s) => !s.startsWith(':')).length,
      )[0];
    if (found) return found;
    p = p.slice(0, -1);
  }
  return null;
}

/** Anchor of the guide for the current screen (the «?» button). */
export function helpAnchorForPath(path: string): string | null {
  const r = routePatternFor(path);
  return r ? (ROUTE_HELP[r] ?? null) : null;
}

/** Extra permissions of routes guarded by RequirePermission in the router. */
const ROUTE_ACTION: Readonly<Record<string, Action>> = {
  '/staff/clients/:clientId/kp/new': 'kp.create',
  '/staff/clients/:clientId/policies/new': 'policies.write',
  '/clinic/registries': 'registries.submit',
  '/clinic/registries/:registryId': 'registries.submit',
  '/clinic/users': 'clinic.users.manage',
  '/clinic/integration': 'clinic.integration.manage',
};

function longestPrefix<T extends { path: string }>(sections: readonly T[], route: string): T | undefined {
  return sections
    .filter((s) => route === s.path || route.startsWith(`${s.path}/`))
    .sort((a, b) => b.path.length - a.path.length)[0];
}

/** Roles that may open a route (mirrors the guards of the router; the server checks again on every request). */
export function routeRoles(route: string): Role[] {
  const portal = portalOfRoute(route);
  let roles: readonly Role[];
  if (portal === 'staff') {
    if (route.startsWith('/staff/insured/')) roles = INSURED_CARD_ROLES;
    else if (route.startsWith('/staff/kp/'))
      roles = longestPrefix(STAFF_SECTIONS, '/staff/clients')?.roles ?? [];
    else roles = longestPrefix(STAFF_SECTIONS, route)?.roles ?? [];
  } else if (portal === 'assist') {
    roles = longestPrefix(ASSIST_SECTIONS, route)?.roles ?? [];
  } else if (portal === 'clinic') roles = CLINIC_ROLES;
  else if (portal === 'hr') roles = ['hr'];
  else if (portal === 'app') roles = route.startsWith('/app/login') ? ALL_ROLES : ['insured'];
  else roles = ALL_ROLES;
  const action = ROUTE_ACTION[route];
  return roles.filter((r) => !action || ruleFor(r, action) !== false);
}

export function canOpenRoute(role: Role, route: string): boolean {
  return routeRoles(route).includes(role);
}

/** A screen the guide mentions by name. `names`: the forms used in the text («Параметры ДМС», «Параметрах ДМС»). */
export interface ScreenLink {
  names: readonly string[];
  portal: Portal;
  route: string;
  labelKey?: I18nKey;
}

/* eslint-disable mig/no-cyrillic-ui -- screen names as written in docs/help/USER_GUIDE.ru.md, used to find mentions */
export const SCREENS: readonly ScreenLink[] = [
  // MIG portal
  { names: ['Клиенты'], portal: 'staff', route: '/staff/clients', labelKey: 'staff.nav.clients' },
  { names: ['Сделки'], portal: 'staff', route: '/staff/deals', labelKey: 'staff.nav.deals' },
  { names: ['Счета и оплаты'], portal: 'staff', route: '/staff/invoices', labelKey: 'staff.nav.invoices' },
  {
    names: ['Ручная разноска'],
    portal: 'staff',
    route: '/staff/invoices/queue',
    labelKey: 'staff.nav.paymentQueue',
  },
  {
    names: ['Параметры ДМС', 'Параметрах ДМС'],
    portal: 'staff',
    route: '/staff/admin/parameters',
    labelKey: 'staff.nav.parameters',
  },
  {
    names: ['Перенос портфеля'],
    portal: 'staff',
    route: '/staff/admin/migration',
    labelKey: 'staff.nav.migration',
  },
  { names: ['Журнал аудита'], portal: 'staff', route: '/staff/audit', labelKey: 'staff.nav.audit' },
  { names: ['Убытки'], portal: 'staff', route: '/staff/claims', labelKey: 'staff.nav.claims' },
  { names: ['Ассистансы'], portal: 'staff', route: '/staff/assistance', labelKey: 'staff.nav.assistance' },
  { names: ['Пользователи'], portal: 'staff', route: '/staff/admin/users', labelKey: 'staff.nav.users' },
  { names: ['ИИ'], portal: 'staff', route: '/staff/admin/ai', labelKey: 'staff.nav.ai' },
  {
    names: ['Изменения состава'],
    portal: 'staff',
    route: '/staff/policy-changes',
    labelKey: 'staff.nav.policyChanges',
  },
  {
    names: ['Доп. соглашения'],
    portal: 'staff',
    route: '/staff/endorsements',
    labelKey: 'staff.nav.endorsements',
  },
  { names: ['Резервы'], portal: 'staff', route: '/staff/reports/reserves', labelKey: 'staff.nav.reserves' },
  { names: ['Отчёты'], portal: 'staff', route: '/staff/reports', labelKey: 'staff.nav.reports' },
  { names: ['Записи'], portal: 'staff', route: '/staff/appointments', labelKey: 'staff.nav.appointments' },
  {
    names: ['Гарантийные письма'],
    portal: 'staff',
    route: '/staff/guarantees',
    labelKey: 'staff.nav.guarantees',
  },
  // HR cabinet
  { names: ['Сотрудники'], portal: 'hr', route: '/hr', labelKey: 'hr.nav.employees' },
  { names: ['Семья'], portal: 'hr', route: '/hr/family', labelKey: 'hr.nav.family' },
  {
    names: ['Заявки из приложения'],
    portal: 'hr',
    route: '/hr/family/requests',
    labelKey: 'hr.nav.familyRequests',
  },
  { names: ['Счета и документы'], portal: 'hr', route: '/hr/documents', labelKey: 'hr.nav.documents' },
  { names: ['Статистика'], portal: 'hr', route: '/hr/stats', labelKey: 'hr.nav.stats' },
  // the app
  { names: ['Записаться к врачу'], portal: 'app', route: '/app/booking', labelKey: 'app.tile.booking' },
  { names: ['Вернуть деньги за чек'], portal: 'app', route: '/app/claims/new', labelKey: 'app.tile.refund' },
  {
    names: ['Карточка для клиники', 'Карточку для клиники'],
    portal: 'app',
    route: '/app/card',
    labelKey: 'app.home.cardButton',
  },
  { names: ['Моя семья'], portal: 'app', route: '/app/family', labelKey: 'app.family.title' },
  { names: ['Покрывается ли?'], portal: 'app', route: '/app/coverage', labelKey: 'app.coverage.title' },
  {
    names: ['Мой сертификат'],
    portal: 'app',
    route: '/app/certificate',
    labelKey: 'app.profile.certificate',
  },
  { names: ['Профиль'], portal: 'app', route: '/app/profile', labelKey: 'app.nav.profile' },
  { names: ['Клиники рядом'], portal: 'app', route: '/app/clinics', labelKey: 'app.nav.clinics' },
  { names: ['Написать нам'], portal: 'app', route: '/app/chat', labelKey: 'app.tile.chat' },
  // clinic cabinet
  { names: ['Проверить пациента'], portal: 'clinic', route: '/clinic/check', labelKey: 'clinic.nav.check' },
  { names: ['Записи'], portal: 'clinic', route: '/clinic/appointments', labelKey: 'clinic.nav.appointments' },
  {
    names: ['Гарантийные письма'],
    portal: 'clinic',
    route: '/clinic/guarantees',
    labelKey: 'clinic.nav.guarantees',
  },
  { names: ['Реестры'], portal: 'clinic', route: '/clinic/registries', labelKey: 'clinic.nav.registries' },
  { names: ['Документы'], portal: 'clinic', route: '/clinic/documents', labelKey: 'common.documents' },
  { names: ['Пользователи'], portal: 'clinic', route: '/clinic/users', labelKey: 'clinic.nav.users' },
  {
    names: ['Интеграция'],
    portal: 'clinic',
    route: '/clinic/integration',
    labelKey: 'clinic.nav.integration',
  },
  // assistance portal
  { names: ['Обращения'], portal: 'assist', route: '/assist/cases', labelKey: 'assist.nav.cases' },
  { names: ['Записи'], portal: 'assist', route: '/assist/appointments', labelKey: 'assist.nav.appointments' },
  { names: ['Чат'], portal: 'assist', route: '/assist/chat', labelKey: 'assist.nav.chat' },
  {
    names: ['Гарантийные письма'],
    portal: 'assist',
    route: '/assist/guarantees',
    labelKey: 'assist.nav.guarantees',
  },
  { names: ['Реестры'], portal: 'assist', route: '/assist/registries', labelKey: 'assist.nav.registries' },
  { names: ['Счета МИГ'], portal: 'assist', route: '/assist/rebills', labelKey: 'assist.nav.rebills' },
  { names: ['Пользователи'], portal: 'assist', route: '/assist/users', labelKey: 'assist.nav.users' },
  {
    names: ['Интеграция'],
    portal: 'assist',
    route: '/assist/integration',
    labelKey: 'assist.nav.integration',
  },
];
/* eslint-enable mig/no-cyrillic-ui */

/**
 * How a screen appears in the guide: the Russian names in «…», and the screen's label in the
 * translated guides — uz-Latn in «…», en in “…” (the translations take labels from the dictionaries).
 */
function mentionForms(s: ScreenLink): string[] {
  const forms = s.names.map((n) => `«${n}»`);
  if (s.labelKey)
    forms.push(
      `«${translate('uz-Latn', s.labelKey)}»`,
      `“${translate('en', s.labelKey)}”`,
      `«${translate('en', s.labelKey)}»`,
    );
  return forms;
}

/**
 * Screens mentioned in a text as «name» that the role may open, in the order of the first mention
 * (only screens of the role's own portal). This is what «Открыть раздел» shows.
 */
export function screensMentioned(text: string, role: Role): ScreenLink[] {
  const portal = portalOfRole(role);
  const found: { s: ScreenLink; at: number }[] = [];
  for (const s of SCREENS) {
    if (s.portal !== portal || !canOpenRoute(role, s.route)) continue;
    const at = Math.min(
      ...mentionForms(s)
        .map((n) => text.indexOf(n))
        .filter((i) => i >= 0),
    );
    if (Number.isFinite(at) && !found.some((f) => f.s.route === s.route)) found.push({ s, at });
  }
  return found.sort((a, b) => a.at - b.at).map((f) => f.s);
}

/** «Открыть раздел» links of a help answer for the role (the mock and the API build answers with it). */
export function openRoutesFor(
  text: string,
  role: Role,
): { route: string; label: string; labelKey?: I18nKey }[] {
  return screensMentioned(text, role).map((s) => ({
    route: s.route,
    label: s.names[0]!,
    ...(s.labelKey ? { labelKey: s.labelKey } : {}),
  }));
}
