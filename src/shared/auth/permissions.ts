/*
 * Single source of truth for access rights (SPEC §4). Used by UI guards and by the mock server.
 */
import type { ClaimStatus, Role, SessionUser, UUID } from '@/shared/types';
import { isAssistRole } from '@/shared/domain/labels';

/** Scoped rule: allowed only for records that belong to the session's company / insured person. */
type Own = 'own';
/** Allowed, data arrives masked. */
type Masked = 'masked';
/** Allowed, name-level fields only. */
type NameOnly = 'name_only';
/** Allowed except on records the user created (four-eyes). */
type ExceptOwn = 'except_own';
type Transitions = { transitions: readonly (readonly [ClaimStatus, ClaimStatus])[] };
/** Own clinic, and only for a patient with an open visit of that clinic (checked by the data layer). */
type ViaVisit = 'via_visit';
/** Allowed; above the dual-approval threshold a second, different person must approve (four-eyes). */
type FourEyesAboveThreshold = 'four_eyes_above_threshold';
/** Allowed only for narrow sub-actions (ctx.sub), e.g. revoking keys during an incident. */
type Only = { only: string | readonly string[] };
/** Allowed only for records of clients without an assistance company (ASSISTANCE_SPEC §10). */
type NoAssistance = 'no_assistance';
/** Allowed for escalations from an assistance company and for records without one. */
type EscalatedOrNoAssistance = 'escalated_or_no_assistance';
/** Allowed; the data layer routes it to someone with more authority when it is above the user's (LIFECYCLE_SPEC §2). */
type WithinAuthority = 'within_authority';
/** Only an employee who is a signatory of MIG (StaffUser.signatory). */
type Signatory = 'signatory';
export type Rule =
  | boolean
  | Own
  | Masked
  | NameOnly
  | ExceptOwn
  | Transitions
  | ViaVisit
  | FourEyesAboveThreshold
  | Only
  | NoAssistance
  | EscalatedOrNoAssistance
  | WithinAuthority
  | Signatory;

type Row = Record<Role, Rule>;

const no = false;
const yes = true;

export const PERMISSIONS = {
  'clients.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: yes, claims_officer: no },
  'clients.write': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'policies.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: 'own', clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: yes },
  'policies.write': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'insured.read': {
    operator: 'masked',
    underwriter: 'masked',
    doctor_expert: 'masked',
    accountant: 'name_only',
    admin: no,
    hr: 'own',
    insured: 'own',
    clinic_registrar: no,
    clinic_admin: no,
    asst_operator: no,
    asst_doctor: no,
    asst_billing: no,
    asst_admin: no,
    sales_manager: no,
    legal: no,
    claims_officer: 'masked',
  },
  'insured.reveal_pii': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'medical.read': { operator: no, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'claims.read': { operator: yes, underwriter: no, doctor_expert: yes, accountant: yes, admin: no, hr: no, insured: 'own', clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'claims.transition': {
    operator: {
      transitions: [
        ['new', 'review'],
        ['review', 'medical_review'],
        ['review', 'approved'],
        ['review', 'rejected'],
      ],
    },
    underwriter: no,
    doctor_expert: {
      transitions: [
        ['medical_review', 'approved'],
        ['medical_review', 'rejected'],
      ],
    },
    accountant: {
      transitions: [
        ['approved', 'to_pay'],
        ['to_pay', 'paid'],
      ],
    },
    admin: no,
    hr: no,
    insured: no,
    clinic_registrar: no,
    clinic_admin: no,
    asst_operator: no,
    asst_doctor: no,
    asst_billing: no,
    asst_admin: no,
    sales_manager: no,
    legal: no,
    // Decisions (approve, reject) go through /claims/:id/decide with a clause reference (LIFECYCLE_SPEC §13).
    claims_officer: {
      transitions: [
        ['new', 'review'],
        ['review', 'medical_review'],
        ['medical_review', 'review'],
      ],
    },
  },
  'claims.create': { operator: yes, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: 'own', clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'appointments.read': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: 'own', clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'appointments.manage': { operator: yes, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: 'own', clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'clinics.read': { operator: yes, underwriter: yes, doctor_expert: yes, accountant: no, admin: yes, hr: no, insured: yes, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'limits.request_change': { operator: yes, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'limits.approve_change': {
    operator: no,
    underwriter: 'except_own',
    doctor_expert: no,
    accountant: no,
    admin: no,
    hr: no,
    insured: no,
    clinic_registrar: no,
    clinic_admin: no,
    asst_operator: no,
    asst_doctor: no,
    asst_billing: no,
    asst_admin: no,
    sales_manager: no,
    legal: no,
    claims_officer: no,
  },
  'reports.read': { operator: no, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'exports.create': { operator: no, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'audit.read': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'users.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'kp.create': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'kp.send': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'kp.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: yes, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: yes, claims_officer: no },
  'hr.employees.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'policy_changes.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'policy_changes.request': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'policy_changes.decide': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  // ---- clinics (CLINIC_SPEC §8) ----
  'clinic.check_patient': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: 'own', clinic_admin: 'own', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'clinic.appointments.manage': { operator: yes, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: 'own', clinic_admin: 'own', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'guarantees.request': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: 'via_visit', clinic_admin: 'via_visit', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'guarantees.read': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: 'own', clinic_admin: 'own', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'guarantees.decide': { operator: no, underwriter: no, doctor_expert: 'four_eyes_above_threshold', accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'registries.submit': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: 'own', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'registries.review': { operator: yes, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'registries.pay': { operator: no, underwriter: no, doctor_expert: no, accountant: yes, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'clinic.integration.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: { only: 'revoke_keys' }, hr: no, insured: no, clinic_registrar: no, clinic_admin: 'own', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'clinic.users.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: { only: 'first_admin' }, hr: no, insured: no, clinic_registrar: no, clinic_admin: 'own', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'clinics.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  // ---- assistance companies (ASSISTANCE_SPEC §10) ----
  'assist.insured.search': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: 'own', asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.insured.reveal_pii': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: 'own', asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.medical.read': { operator: no, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.cases.manage': { operator: { only: ['read', 'complaint'] }, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: 'own', asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.appointments.manage': { operator: 'no_assistance', underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: 'own', asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.guarantees.decide': { operator: no, underwriter: no, doctor_expert: 'escalated_or_no_assistance', accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.registries.review': { operator: 'no_assistance', underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: 'own', asst_billing: 'own', asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.clinic_payments.record': { operator: no, underwriter: no, doctor_expert: no, accountant: 'no_assistance', admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: 'own', asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.rebills.submit': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: 'own', asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'rebills.review': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'rebills.pay': { operator: no, underwriter: no, doctor_expert: no, accountant: 'except_own', admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'qa.review': { operator: no, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assistance.assign': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assistance.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'assist.users.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: { only: 'revoke_keys' }, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: 'own', sales_manager: no, legal: no, claims_officer: no },
  'assist.integration.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: { only: 'revoke_keys' }, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: 'own', sales_manager: no, legal: no, claims_officer: no },
  // ---- DMS business parameters (/staff/admin/parameters): an admin proposes, a second admin or underwriter confirms ----
  'dms_params.read': { operator: yes, underwriter: yes, doctor_expert: yes, accountant: yes, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: yes, claims_officer: yes },
  'dms_params.propose': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: yes, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'dms_params.approve': { operator: no, underwriter: 'except_own', doctor_expert: no, accountant: no, admin: 'except_own', hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  // ---- contract lifecycle and claims settlement (LIFECYCLE_SPEC §14) ----
  'leads.manage': { operator: no, underwriter: { only: 'read' }, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'deals.manage': { operator: no, underwriter: { only: 'read' }, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'census.upload': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'quotes.calculate': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'quotes.approve': { operator: no, underwriter: 'within_authority', doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'kp.respond': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: { only: 'manual' }, legal: no, claims_officer: no },
  'contracts.read': { operator: yes, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: yes, claims_officer: no },
  'contracts.draft': { operator: no, underwriter: yes, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'contracts.legal_approve': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: yes, claims_officer: no },
  'contracts.sign_mig': { operator: no, underwriter: 'signatory', doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: 'signatory', legal: no, claims_officer: no },
  'contracts.sign_client': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'contracts.verify_scan': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: yes, claims_officer: no },
  'contracts.originals': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: yes, claims_officer: no },
  'payments.record': { operator: no, underwriter: no, doctor_expert: no, accountant: yes, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'invoices.read': { operator: no, underwriter: yes, doctor_expert: no, accountant: yes, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'endorsements.manage': { operator: no, underwriter: { only: 'approve_amounts' }, doctor_expert: no, accountant: no, admin: no, hr: 'own', insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: yes, legal: no, claims_officer: no },
  'claims.decide': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: 'within_authority' },
  'claims.medical_opinion': { operator: no, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'claims.reserves': { operator: no, underwriter: { only: 'read' }, doctor_expert: no, accountant: { only: 'read' }, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'staff.authority.manage': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: 'except_own', hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  // ---- AI coverage check (AI_COVERAGE_SPEC §5) ----
  'ai.coverage.self': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: 'own', clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'ai.coverage.clinic': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: 'via_visit', clinic_admin: 'via_visit', asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'ai.coverage.assist': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: 'own', asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
  'ai.coverage.mig': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'ai.feedback': { operator: yes, underwriter: no, doctor_expert: yes, accountant: no, admin: no, hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: 'own', asst_doctor: 'own', asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: yes },
  'ai.admin': { operator: no, underwriter: no, doctor_expert: no, accountant: no, admin: 'except_own', hr: no, insured: no, clinic_registrar: no, clinic_admin: no, asst_operator: no, asst_doctor: no, asst_billing: no, asst_admin: no, sales_manager: no, legal: no, claims_officer: no },
} as const satisfies Record<string, Row>;

export type Action = keyof typeof PERMISSIONS;
export const ACTIONS = Object.keys(PERMISSIONS) as Action[];

export interface PermissionContext {
  /** Company that owns the record (hr scope). */
  companyId?: UUID;
  /** Insured person that owns the record (insured scope). */
  insuredId?: UUID;
  /** Clinic that owns the record (clinic scope). */
  clinicId?: UUID;
  /** Assistance company the record belongs to on the date of the event; null — a client without one. */
  assistanceId?: UUID | null;
  /** The record was escalated by an assistance company to MIG. */
  escalated?: boolean;
  /** Narrow sub-action for `{ only }` rules. */
  sub?: string;
  /** Creator of the record (four-eyes). */
  createdById?: UUID;
  /** Claim transition being attempted. */
  from?: ClaimStatus;
  to?: ClaimStatus;
}

export type MinimalUser = Pick<SessionUser, 'id' | 'role' | 'companyId' | 'insuredId' | 'clinicId' | 'assistanceId' | 'canSign'>;

export function ruleFor(role: Role, action: Action): Rule {
  return (PERMISSIONS[action] as Row)[role];
}

function ownMatches(user: MinimalUser, ctx: PermissionContext | undefined): boolean {
  if (!ctx) return true; // scope is applied by the data layer
  if (user.role === 'hr') {
    if (ctx.companyId === undefined) return ctx.insuredId === undefined;
    return !!user.companyId && ctx.companyId === user.companyId;
  }
  if (user.role === 'clinic_registrar' || user.role === 'clinic_admin') {
    if (ctx.clinicId === undefined) return ctx.insuredId === undefined && ctx.companyId === undefined;
    return !!user.clinicId && ctx.clinicId === user.clinicId;
  }
  if (isAssistRole(user.role)) {
    if (ctx.assistanceId === undefined) return ctx.insuredId === undefined && ctx.companyId === undefined && ctx.clinicId === undefined;
    return !!user.assistanceId && ctx.assistanceId === user.assistanceId;
  }
  if (user.role === 'insured') {
    if (ctx.insuredId === undefined) return ctx.companyId === undefined;
    return !!user.insuredId && ctx.insuredId === user.insuredId;
  }
  return false;
}

export function can(user: MinimalUser | null | undefined, action: Action, ctx?: PermissionContext): boolean {
  if (!user) return false;
  const rule = ruleFor(user.role, action);
  if (rule === false) return false;
  if (rule === true || rule === 'masked' || rule === 'name_only') return true;
  if (rule === 'own' || rule === 'via_visit') return ownMatches(user, ctx);
  if (rule === 'four_eyes_above_threshold' || rule === 'within_authority') return true;
  if (rule === 'signatory') return user.canSign === true;
  if (typeof rule === 'object' && 'only' in rule) return ctx?.sub !== undefined && (typeof rule.only === 'string' ? ctx.sub === rule.only : rule.only.includes(ctx.sub));
  // Scope rules without a record are checked by the data layer.
  if (rule === 'no_assistance') return ctx?.assistanceId === undefined || ctx.assistanceId === null;
  if (rule === 'escalated_or_no_assistance') return ctx?.assistanceId === undefined || ctx.assistanceId === null || ctx.escalated === true;
  if (rule === 'except_own') return !(ctx?.createdById && ctx.createdById === user.id);
  // transitions
  if (ctx?.from === undefined || ctx.to === undefined) return rule.transitions.length > 0;
  return rule.transitions.some(([f, t]) => f === ctx.from && t === ctx.to);
}

/** How personal data of insured persons is exposed to the role. */
export function insuredVisibility(role: Role): 'masked' | 'name_only' | 'none' {
  const r = ruleFor(role, 'insured.read');
  if (r === 'name_only') return 'name_only';
  if (r === false) return 'none';
  return 'masked';
}

/** Claim transitions the role may perform from a status (before business rules). */
export function roleTransitionsFrom(role: Role, from: ClaimStatus): ClaimStatus[] {
  const rule = ruleFor(role, 'claims.transition');
  if (typeof rule !== 'object' || !('transitions' in rule)) return [];
  return rule.transitions.filter(([f]) => f === from).map(([, t]) => t);
}
