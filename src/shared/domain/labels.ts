import { defineLabels } from '@/i18n';
import type {
  AppointmentStatus,
  AuditAction,
  ClientStatus,
  LimitCategory,
  PolicyStatus,
  ProgramCode,
  Role,
  Specialty,
} from '@/shared/types';

export const ROLE_LABEL = defineLabels<Role>('labels.role', ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer', 'hr', 'insured', 'clinic_registrar', 'clinic_admin', 'asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin']);

export const PROGRAM_LABEL = defineLabels<ProgramCode>('labels.program', ['basic', 'standard', 'standard_plus', 'premium']);

export const CLIENT_STATUS_LABEL = defineLabels<ClientStatus>('labels.clientStatus', ['lead', 'draft', 'negotiation', 'active', 'renewal', 'expired']);

export const POLICY_STATUS_LABEL = defineLabels<PolicyStatus>('labels.policyStatus', ['draft', 'active', 'expired', 'cancelled']);

export const LIMIT_CATEGORY_LABEL = defineLabels<LimitCategory>('labels.limitCategory', ['outpatient', 'dental', 'medicines', 'inpatient']);

export const SPECIALTY_LABEL = defineLabels<Specialty>('labels.specialty', ['therapist', 'pediatrician', 'dentist', 'cardiologist', 'gynecologist', 'ent', 'neurologist', 'ophthalmologist']);

export const APPOINTMENT_STATUS_LABEL = defineLabels<AppointmentStatus>('labels.apptStatus', ['requested', 'confirmed', 'declined', 'completed', 'cancelled']);

export const AUDIT_ACTION_LABEL = defineLabels<AuditAction>('labels.audit', ['login', 'logout', 'login_failed', 'reveal_pii', 'open_medical', 'limit_change_request', 'limit_change_approve', 'limit_change_reject', 'claim_transition', 'export', 'role_change', 'user_deactivate', 'hr_add_employee', 'hr_exclude_employee', 'hr_import', 'kp_created', 'kp_sent', 'kp_revoked', 'kp_downloaded', 'clinic_check_patient', 'clinic_check_failed', 'guarantee_requested', 'guarantee_decided', 'registry_submitted', 'registry_line_decided', 'registry_paid', 'integration_key_created', 'integration_key_revoked', 'webhook_created', 'policy_issued', 'policy_change_requested', 'policy_change_decided', 'assistance_assigned', 'case_created', 'guarantee_escalated', 'clinic_payment_recorded', 'rebill_submitted', 'rebill_line_decided', 'rebill_paid', 'qa_reviewed', 'complaint_resolved', 'dms_param_proposed', 'dms_param_changed', 'dms_param_rejected', 'authority_proposed', 'authority_changed', 'authority_rejected', 'lead_created', 'deal_stage_changed', 'deal_lost', 'census_uploaded', 'quote_saved', 'quote_submitted', 'quote_approved', 'quote_rejected', 'kp_accepted', 'kp_declined', 'contract_created', 'contract_updated', 'contract_legal_submitted', 'contract_legal_approved', 'contract_legal_returned', 'contract_finance_approved', 'contract_sent', 'contract_signed', 'contract_scan_uploaded', 'contract_scan_verified', 'contract_original', 'contract_activated', 'contract_terminated', 'payment_recorded', 'payments_imported', 'payment_allocated', 'change_request_created', 'endorsement_created', 'endorsement_signed', 'claim_opinion_requested', 'claim_opinion_given', 'claim_decided', 'claim_decision_escalated', 'claim_decision_rejected', 'claim_reserve_changed', 'claim_flag_dismissed', 'claim_appealed', 'claim_appeal_resolved', 'ai_settings_proposed', 'ai_settings_changed', 'ai_settings_rejected', 'ai_kill_switch', 'ai_feedback', 'migration_validated', 'migration_submitted', 'migration_applied', 'migration_rejected', 'migration_rolled_back', 'migration_scan_attached']);

export const STAFF_ROLES = ['operator', 'underwriter', 'doctor_expert', 'accountant', 'admin', 'sales_manager', 'legal', 'claims_officer'] as const;
export const CLINIC_ROLES = ['clinic_registrar', 'clinic_admin'] as const;
export const ASSISTANCE_ROLES = ['asst_operator', 'asst_doctor', 'asst_billing', 'asst_admin'] as const;
export function isAssistRole(role: Role): role is (typeof ASSISTANCE_ROLES)[number] {
  return (ASSISTANCE_ROLES as readonly string[]).includes(role);
}
export function isClinicRole(role: Role): role is (typeof CLINIC_ROLES)[number] {
  return (CLINIC_ROLES as readonly string[]).includes(role);
}

export function isStaffRole(role: Role): role is (typeof STAFF_ROLES)[number] {
  return (STAFF_ROLES as readonly string[]).includes(role);
}
