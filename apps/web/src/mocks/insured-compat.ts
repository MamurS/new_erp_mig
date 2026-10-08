/*
 * Synchronous helpers of the insured card for handlers not yet ported to the services (claims, assist).
 * The logic is in packages/domain/src/services/insured.ts; this file goes away with the last old handler.
 */
import { fieldLabel, medicalRecordsOf } from '@mig/domain/services/insured';
import { db, type InsuredRow } from './db';
import { notFound } from './http';

export { fieldLabel };

export function findInsured(id: string): InsuredRow {
  const i = db().insured.find((x) => x.id === id);
  if (!i) throw notFound();
  return i;
}

/** Fictional medical history, derived deterministically from the insured id (not stored). */
export function medicalRecords(i: InsuredRow) {
  return medicalRecordsOf(i, db().clinics, Date.now());
}
