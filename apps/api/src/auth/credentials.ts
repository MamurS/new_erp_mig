/*
 * The credentials of e-mail accounts in Supabase Auth (stage 1.5 invitations): an accepted invitation sets the
 * password and removes the second factors, so the first sign-in enrols a TOTP authenticator (auth/bff.ts). An
 * account whose identity the worker has not synced yet is synced first.
 */
import type { ServiceEnv } from '@mig/domain/services/kernel';
import type { GoTrue } from './gotrue';
import type { IdentitySync } from '../jobs/identity';

export function gotrueCredentials(gotrue: GoTrue, identity: Pick<IdentitySync, 'syncOne'>): NonNullable<ServiceEnv['credentials']> {
  return {
    async setPassword(userId, password) {
      if (!(await gotrue.adminGetUser(userId))) await identity.syncOne(userId);
      const user = await gotrue.adminUpdateUser(userId, { password });
      for (const f of user.factors ?? []) await gotrue.adminDeleteFactor(userId, f.id);
    },
  };
}
