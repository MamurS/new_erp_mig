/*
 * The identity of an account in Supabase Auth (BACKEND_SPEC §7): how the person signs in (e-mail or phone) and
 * the roles and bindings the API keeps in `app_metadata` (never `user_metadata`). The Custom Access Token Hook
 * copies exactly these keys into the JWT claims; the API builds the database claims of a request from them.
 *
 * One source for the seed provisioning (store/sql/authSeed.ts) and the API's identity sync (apps/api).
 */
import type { Role, SessionUser } from '@mig/contracts';
import type { Db } from '../store/db';
import type { Repos } from '../store/repo';

/** The roles and bindings of `app_metadata` (snake_case, as the SQL helpers app.role(), app.company_id()… read them). */
export interface AppMetadata {
  role: Role;
  company_id?: string;
  clinic_id?: string;
  assistance_id?: string;
  insured_id?: string;
}

/** The keys the Custom Access Token Hook keeps in `app_metadata` (plus Supabase's own `provider(s)`). */
export const APP_METADATA_KEYS = ['role', 'company_id', 'clinic_id', 'assistance_id', 'insured_id'] as const;

export function appMetadataOf(
  user: Pick<SessionUser, 'role' | 'companyId' | 'clinicId' | 'assistanceId' | 'insuredId'>,
): AppMetadata {
  return {
    role: user.role,
    ...(user.companyId ? { company_id: user.companyId } : {}),
    ...(user.clinicId ? { clinic_id: user.clinicId } : {}),
    ...(user.assistanceId ? { assistance_id: user.assistanceId } : {}),
    ...(user.insuredId ? { insured_id: user.insuredId } : {}),
  };
}

/** Equal roles and bindings (the token's claims against the server-side record). */
export function sameAppMetadata(a: Partial<Record<string, unknown>> | undefined, b: AppMetadata): boolean {
  if (!a) return false;
  return APP_METADATA_KEYS.every((k) => (a[k] ?? undefined) === (b[k] ?? undefined));
}

export interface IdentitySpec {
  userId: string;
  /** E-mail accounts: staff, HR, clinics, assistance companies (password + TOTP). */
  email?: string;
  /** Phone accounts: the insured (one-time code). Digits only, as Supabase Auth stores phones. */
  phone?: string;
  appMetadata: AppMetadata;
  /** Deactivated accounts are banned in Supabase Auth. */
  active: boolean;
}

/** Supabase Auth keeps phone numbers as digits (`+998 90 …` → `99890…`). */
export const authPhone = (phone: string): string => phone.replace(/\D/g, '');

/** Every account of a database (the seed provisioning): one identity per phone number (the first active person). */
export function identitiesOfDb(db: Db): IdentitySpec[] {
  const out: IdentitySpec[] = [];
  for (const s of db.staff)
    out.push({ userId: s.id, email: s.email, appMetadata: { role: s.role }, active: s.active });
  for (const h of db.hrUsers)
    out.push({
      userId: h.id,
      email: h.email,
      appMetadata: { role: 'hr', company_id: h.companyId },
      active: true,
    });
  for (const u of db.clinicUsers)
    out.push({
      userId: u.id,
      email: u.email,
      appMetadata: { role: u.role, clinic_id: u.clinicId },
      active: u.active,
    });
  for (const u of db.assistUsers)
    out.push({
      userId: u.id,
      email: u.email,
      appMetadata: { role: u.role, assistance_id: u.assistanceId },
      active: u.active,
    });
  const phones = new Set<string>();
  const people = [
    ...db.insured.filter((i) => i.status === 'active'),
    ...db.insured.filter((i) => i.status !== 'active'),
  ];
  for (const i of people) {
    if (!i.userId) continue;
    const phone = i.phone ? authPhone(i.phone) : '';
    const free = phone && !phones.has(phone);
    if (free) phones.add(phone);
    out.push({
      userId: i.userId,
      ...(free ? { phone } : {}),
      appMetadata: { role: 'insured', insured_id: i.id },
      active: i.status === 'active',
    });
  }
  return out;
}

/** The identity of one account from the repositories (the API's identity sync); null when the account is gone. */
export async function identityOf(repos: Repos, userId: string): Promise<IdentitySpec | null> {
  const s = await repos.staff.get(userId);
  if (s) return { userId, email: s.email, appMetadata: { role: s.role }, active: s.active };
  const h = await repos.hrUsers.get(userId);
  if (h)
    return { userId, email: h.email, appMetadata: { role: 'hr', company_id: h.companyId }, active: true };
  const c = await repos.clinicUsers.get(userId);
  if (c)
    return { userId, email: c.email, appMetadata: { role: c.role, clinic_id: c.clinicId }, active: c.active };
  const a = await repos.assistUsers.get(userId);
  if (a)
    return {
      userId,
      email: a.email,
      appMetadata: { role: a.role, assistance_id: a.assistanceId },
      active: a.active,
    };
  const people = await repos.insured.list({ where: { userId } });
  const i = people.find((p) => p.status === 'active') ?? people[0];
  if (i) {
    const phone = i.phone ? authPhone(i.phone) : '';
    // A number another active account already signs in with stays with that account (as the seed decides).
    const holders = phone ? await repos.insured.list({ where: { phone: i.phone, status: 'active' } }) : [];
    const free = phone && (holders.length === 0 || holders[0]!.userId === userId);
    return {
      userId,
      ...(free ? { phone } : {}),
      appMetadata: { role: 'insured', insured_id: i.id },
      active: i.status === 'active',
    };
  }
  return null;
}
