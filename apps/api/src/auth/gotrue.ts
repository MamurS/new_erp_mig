/*
 * Supabase Auth (GoTrue) over its REST API with `fetch` (no supabase-js): the API is the only client
 * (BACKEND_SPEC §2.1 — Supabase is not reachable from the browser). User calls carry the person's access token;
 * admin calls the service role key. The client's IP goes in `X-Mig-Client-Ip` (Supabase Auth's rate limits per
 * client when the deployment sets GOTRUE_RATE_LIMIT_HEADER=X-Mig-Client-Ip; README «API (бэкенд)»).
 */

export interface AuthFactor {
  id: string;
  factor_type: string;
  status: 'verified' | 'unverified';
}

export interface AuthUser {
  id: string;
  email?: string;
  phone?: string;
  app_metadata?: Record<string, unknown>;
  factors?: AuthFactor[] | null;
  banned_until?: string | null;
}

export interface TokenSet {
  access_token: string;
  refresh_token: string;
  expires_at?: number;
  expires_in: number;
  user: AuthUser;
}

/** An error answer of Supabase Auth (status and its error code; never shown to the person as is). */
export class AuthApiError extends Error {
  constructor(
    readonly status: number,
    readonly code: string,
    message: string,
  ) {
    super(`Supabase Auth ${status} ${code}: ${message}`);
    this.name = 'AuthApiError';
  }
}

export interface GoTrueOptions {
  /** SUPABASE_URL: Kong (`…/auth/v1` is appended). */
  url: string;
  serviceKey: string;
  fetch?: typeof fetch;
}

export interface AdminUserParams {
  id?: string;
  email?: string;
  phone?: string;
  password?: string;
  email_confirm?: boolean;
  phone_confirm?: boolean;
  app_metadata?: Record<string, unknown>;
  ban_duration?: string;
}

export class GoTrue {
  readonly base: string;
  constructor(private readonly o: GoTrueOptions) {
    this.base = `${o.url.replace(/\/+$/, '')}/auth/v1`;
  }

  private async call<T>(
    method: string,
    path: string,
    o: { token?: string; body?: unknown; ip?: string } = {},
  ): Promise<T> {
    const headers: Record<string, string> = {
      apikey: this.o.serviceKey,
      Authorization: `Bearer ${o.token ?? this.o.serviceKey}`,
    };
    if (o.body !== undefined) headers['content-type'] = 'application/json';
    if (o.ip) headers['X-Mig-Client-Ip'] = o.ip;
    const r = await (this.o.fetch ?? fetch)(`${this.base}${path}`, {
      method,
      headers,
      ...(o.body !== undefined ? { body: JSON.stringify(o.body) } : {}),
    });
    const text = await r.text();
    let json: Record<string, unknown> = {};
    try {
      json = text ? (JSON.parse(text) as Record<string, unknown>) : {};
    } catch {
      json = { msg: text.slice(0, 200) };
    }
    if (!r.ok)
      throw new AuthApiError(
        r.status,
        String(json.error_code ?? json.error ?? r.status),
        String(json.msg ?? json.message ?? json.error_description ?? ''),
      );
    return json as T;
  }

  // ------------------------------------------------------------------ the person

  passwordGrant(email: string, password: string, ip?: string): Promise<TokenSet> {
    return this.call('POST', '/token?grant_type=password', { body: { email, password }, ip });
  }

  refresh(refreshToken: string, ip?: string): Promise<TokenSet> {
    return this.call('POST', '/token?grant_type=refresh_token', {
      body: { refresh_token: refreshToken },
      ip,
    });
  }

  /** Sends the one-time code to a phone of an existing user (no sign-ups). */
  async sendPhoneOtp(phone: string, ip?: string): Promise<void> {
    await this.call('POST', '/otp', { body: { phone, create_user: false }, ip });
  }

  verifyPhoneOtp(phone: string, token: string, ip?: string): Promise<TokenSet> {
    return this.call('POST', '/verify', { body: { type: 'sms', phone, token }, ip });
  }

  getUser(accessToken: string): Promise<AuthUser> {
    return this.call('GET', '/user', { token: accessToken });
  }

  challenge(accessToken: string, factorId: string, ip?: string): Promise<{ id: string; expires_at: number }> {
    return this.call('POST', `/factors/${factorId}/challenge`, { token: accessToken, body: {}, ip });
  }

  verifyFactor(
    accessToken: string,
    factorId: string,
    challengeId: string,
    code: string,
    ip?: string,
  ): Promise<TokenSet> {
    return this.call('POST', `/factors/${factorId}/verify`, {
      token: accessToken,
      body: { challenge_id: challengeId, code },
      ip,
    });
  }

  enrollTotp(
    accessToken: string,
    friendlyName: string,
    ip?: string,
  ): Promise<{ id: string; totp: { qr_code: string; secret: string; uri: string } }> {
    return this.call('POST', '/factors', {
      token: accessToken,
      body: { factor_type: 'totp', friendly_name: friendlyName, issuer: 'MIG DMS' },
      ip,
    });
  }

  async unenroll(accessToken: string, factorId: string): Promise<void> {
    await this.call('DELETE', `/factors/${factorId}`, { token: accessToken });
  }

  /** Ends this Supabase session (`local`) or every session of the user (`global`). */
  async logout(accessToken: string, scope: 'local' | 'global'): Promise<void> {
    await this.call('POST', `/logout?scope=${scope}`, { token: accessToken });
  }

  // ------------------------------------------------------------------ admin (service role)

  async adminGetUser(id: string): Promise<AuthUser | null> {
    try {
      return await this.call<AuthUser>('GET', `/admin/users/${id}`);
    } catch (e) {
      if (e instanceof AuthApiError && e.status === 404) return null;
      throw e;
    }
  }

  adminCreateUser(p: AdminUserParams): Promise<AuthUser> {
    return this.call('POST', '/admin/users', { body: p });
  }

  adminUpdateUser(id: string, p: AdminUserParams): Promise<AuthUser> {
    return this.call('PUT', `/admin/users/${id}`, { body: p });
  }

  /** The invitation e-mail (Supabase Auth sends it through the SMTP of its deployment). */
  async inviteUserByEmail(email: string, redirectTo?: string): Promise<void> {
    await this.call('POST', `/invite${redirectTo ? `?redirect_to=${encodeURIComponent(redirectTo)}` : ''}`, {
      body: { email },
    });
  }
}
