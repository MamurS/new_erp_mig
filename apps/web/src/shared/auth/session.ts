/*
 * Client session: kept in memory and mirrored to sessionStorage so a tab reload keeps the user
 * signed in. The only module allowed to touch sessionStorage for auth. Never localStorage/cookies.
 */
import { msg } from '@/i18n';
import { useSyncExternalStore } from 'react';
import type { SessionUser } from '@mig/contracts';

const KEY = 'mig.session';
const CHANNEL = 'mig-auth';

export interface ClientSession {
  sessionId: string;
  user: SessionUser;
}

type Listener = () => void;
const listeners = new Set<Listener>();
let current: ClientSession | null = load();
let logoutNotice: string | null = null;
let channel: BroadcastChannel | null = null;

function load(): ClientSession | null {
  try {
    const raw = typeof sessionStorage === 'undefined' ? null : sessionStorage.getItem(KEY);
    if (!raw) return null;
    const parsed = JSON.parse(raw) as Partial<ClientSession>;
    if (typeof parsed.sessionId !== 'string' || !parsed.user || typeof parsed.user.role !== 'string') return null;
    return parsed as ClientSession;
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

export function getSessionId(): string | null {
  return current?.sessionId ?? null;
}

export function getUser(): SessionUser | null {
  return current?.user ?? null;
}

export function setSession(session: ClientSession): void {
  current = session;
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
