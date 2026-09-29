/*
 * In-memory "server" database. Rows hold full (unmasked) values; handlers mask on output.
 */
import type {
  Appointment,
  AuditEntry,
  ChatMessage,
  Claim,
  Client,
  ClientDocument,
  Clinic,
  Insured,
  Invoice,
  LimitChangeRequest,
  Policy,
  Role,
  StaffUser,
  UUID,
} from '@/shared/types';

export interface StaffRow extends StaffUser {
  password: string;
}
export interface HrUserRow {
  id: UUID;
  email: string;
  password: string;
  fullName: string;
  companyId: UUID;
  lastLoginAt?: string;
}
export interface ClientRow extends Omit<Client, 'hrContact' | 'insuredCount'> {
  hrContact: { name: string; phone: string; email: string };
}
export interface InsuredRow extends Omit<Insured, 'birthDateMasked' | 'pinflMasked' | 'phoneMasked'> {
  birthDate: string;
  pinfl: string;
  phone: string;
  email: string;
  payoutCard: string;
  consentGivenAt?: string;
  addedAt: string;
  excludedFrom?: string;
  userId: UUID;
}
export interface ClaimRow extends Claim {
  /** Plain-language reason for the insured person (no internal comments). */
  publicRejectionReason?: string;
}
export interface FileRow {
  id: UUID;
  mime: 'image/jpeg' | 'image/png' | 'image/webp' | 'application/pdf';
  claimId?: UUID;
  insuredId?: UUID;
  /** Uploaded bytes (kept in memory only). Seeded receipts are rendered on demand. */
  bytes?: Uint8Array;
  seedText?: string[];
}
export interface ChatRow extends ChatMessage {
  insuredId: UUID;
  visibleAt: string;
}
export interface SessionRow {
  id: string;
  userId: UUID;
  role: Role;
  createdAt: number;
  lastActivity: number;
}
export interface ChallengeRow {
  id: string;
  userId: UUID;
  kind: 'staff' | 'hr' | 'insured';
  expiresAt: number;
  attempts: number;
}
export interface GrantRow {
  id: string;
  userId: UUID;
  insuredId: UUID;
  expiresAt: number;
}
export interface InsuredDocRow {
  id: UUID;
  insuredId: UUID;
  title: string;
  createdAt: string;
}

export interface Db {
  staff: StaffRow[];
  hrUsers: HrUserRow[];
  clients: ClientRow[];
  policies: Policy[];
  insured: InsuredRow[];
  claims: ClaimRow[];
  appointments: Appointment[];
  clinics: Clinic[];
  audit: AuditEntry[];
  limitRequests: LimitChangeRequest[];
  invoices: Invoice[];
  documents: ClientDocument[];
  insuredDocuments: InsuredDocRow[];
  chat: ChatRow[];
  files: FileRow[];
  sessions: SessionRow[];
  challenges: ChallengeRow[];
  grants: GrantRow[];
  loginFailures: { key: string; at: number }[];
  lockouts: { key: string; until: number }[];
  renewalOffers: UUID[]; // client ids with a prepared renewal offer
  integrationsSeed: number;
}

let current: Db | null = null;
let factory: (() => Db) | null = null;

export function registerSeed(fn: () => Db): void {
  factory = fn;
}

export function db(): Db {
  if (!current) {
    if (!factory) throw new Error('seed not registered');
    current = factory();
  }
  return current;
}

export function replaceDb(next: Db): void {
  current = next;
}

export function resetDb(): Db {
  if (!factory) throw new Error('seed not registered');
  current = factory();
  return current;
}
