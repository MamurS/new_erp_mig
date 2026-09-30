/*
 * Outbound integration (MIG → clinic MIS), CLINIC_SPEC §6.5. Declared only: the backend implements
 * one adapter per MIS vendor that exposes its own schedule and booking API.
 */
import type { ISODate, ISODateTime, Slot, Specialty, UUID } from '@/shared/types';

export interface AdapterAppointmentInput {
  clinicId: UUID;
  specialty: Specialty;
  startsAt: ISODateTime;
  /** Pseudonymous patient reference; the MIS receives personal data only through a visit. */
  visitId: UUID;
  doctorRef?: string;
}

export interface ClinicAdapter {
  fetchSlots(clinicId: UUID, from: ISODate, to: ISODate): Promise<Slot[]>;
  createAppointment(input: AdapterAppointmentInput): Promise<{ externalId: string }>;
  cancelAppointment(externalId: string): Promise<void>;
}
