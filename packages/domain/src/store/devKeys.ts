/*
 * DEV/CI ONLY: published keys of the generated development seed and of local and CI deployments. They are not
 * secrets; production refuses to start with them (apps/api/src/env.ts).
 */

/** Development HMAC key of the search hashes (`*_hmac`) of the seed. */
export const DEV_HMAC_KEY = 'dev-only-hmac-key-not-a-secret';

/** Derives the TOTP secrets of the demo accounts (test MFA mode, never production). */
export const DEV_TOTP_KEY = 'dev-only-totp-key-not-a-secret';
