/*
 * Who is signed in, as the UI needs it: the public info of the signed-in person (role, name, scope), kept in memory
 * and mirrored to sessionStorage so a tab reload keeps the screens. The session itself is the API's HttpOnly cookie
 * (BACKEND_SPEC §7): no token and no session id ever reach this module or the page (CLAUDE.md rule 3). The only
 * module allowed to touch sessionStorage for auth. Never localStorage.
 */
import { msg } from '@/i18n';
import { useSyncExternalStore } from 'react';
import type { SessionUser } from '@mig/contracts';

const KEY = 'mig.session';
const CHANNEL = 'mig-auth';

export interface ClientSession {
  user: SessionUser;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let current: ClientSession | null = load();
/** Bumped by every sign-in and sign-out: a request remembers it to know which sign-in it belonged to. */
let epoch = 0;
let logoutNotice: string | null = null;
let channel: BroadcastChannel | null = null;

function load(): ClientSession | null {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientSession>;
    if (!parsed.user || typeof parsed.user.role !== 'string') return null;
    return { user: parsed.user };
  } catch {
    return null;
  }
}

function persist(): void {
  try {
    if (current) sessionStorage.setItem(KEY, JSON.stringify(current));
    else sessionStorage.removeItem(KEY);
  } catch {
    /* sessionStorage unavailable: in-memory session still works */
  }
}

function emit(): void {
  for (const l of listeners) l();
}

function getChannel(): BroadcastChannel | null {
  if (channel || typeof BroadcastChannel === 'undefined') return channel;
  channel = new BroadcastChannel(CHANNEL);
  channel.onmessage = (ev: MessageEvent<unknown>) => {
    const data = ev.data as { type?: string } | null;
    if (data?.type === 'logout' && current) {
      logoutNotice = msg('auth.notice.otherTab');
      current = null;
      epoch += 1;
      persist();
      emit();
    }
  };
  return channel;
}

export function initSessionSync(): void {
  getChannel();
}

export function getSession(): ClientSession | null {
  return current;
}

/** Changes with every sign-in and sign-out (the API client drops a 401 of a request from an earlier one). */
export function sessionEpoch(): number {
  return epoch;
}

export function getUser(): SessionUser | null {
  return current?.user ?? null;
}

/** A completed sign-in: only the person (the answer of /auth/*); the session cookie is the API's. */
export function setSession(session: ClientSession): void {
  current = { user: session.user };
  epoch += 1;
  logoutNotice = null;
  persist();
  getChannel();
  emit();
}

export function updateUser(patch: Partial<SessionUser>): void {
  if (!current) return;
  current = { ...current, user: { ...current.user, ...patch } };
  persist();
  emit();
}

/** Clears the local session. `broadcast` notifies other tabs. */
export function clearSession(options: { notice?: string; broadcast?: boolean } = {}): void {
  const had = current !== null;
  current = null;
  if (had) epoch += 1;
  if (options.notice) logoutNotice = options.notice;
  persist();
  if (options.broadcast) getChannel()?.postMessage({ type: 'logout' });
  if (had) emit();
}

/** One-shot message for the login screen («Сессия завершена, войдите снова»). */
export function takeLogoutNotice(): string | null {
  const n = logoutNotice;
  logoutNotice = null;
  return n;
}

export function peekLogoutNotice(): string | null {
  return logoutNotice;
}

export function subscribeSession(listener: Listener): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

export function useSession(): ClientSession | null {
  return useSyncExternalStore(subscribeSession, getSession, getSession);
}

export function useUser(): SessionUser | null {
  return useSession()?.user ?? null;
}
