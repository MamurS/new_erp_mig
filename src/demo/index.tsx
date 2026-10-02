/*
 * Demo module. Loaded only when VITE_DEMO_MODE === 'true'; absent from other builds.
 * «Войти как…» performs a real login through the mock API, it never changes the role client-side.
 */
import { useEffect, useState } from 'react';
import { flushSync } from 'react-dom';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FlaskConical, RotateCcw } from 'lucide-react';
import type { Role } from '@/shared/types';
import type { DemoModule } from '@/shared/demo';
import { request, errorMessage } from '@/shared/api/client';
import * as S from '@/shared/api/schemas';
import { getSession, setSession } from '@/shared/auth/session';
import { homeFor } from '@/shared/auth/home';
import { ROLE_LABEL } from '@/shared/domain/labels';
import { Menu, MenuContent, MenuItem, MenuTrigger } from '@/shared/ui/dropdown';
import { toast } from '@/shared/ui/toast';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { MisSimulator } from './MisSimulator';
import { AssistSimulator } from './AssistSimulator';
import { DEMO_ASSIST_USERS, DEMO_CLINIC_USERS, DEMO_CODE, DEMO_HR, DEMO_INSURED_PHONE, DEMO_PASSWORD, DEMO_STAFF } from '@/mocks/credentials';

/** One entry per demo account: a role may have several (e.g. a claims officer and their head). */
const ACCOUNTS: { role: Role; login: string; label?: string }[] = [
  ...DEMO_STAFF.map((s) => ({ role: s.role as Role, login: s.email, label: s.label })),
  { role: 'hr', login: DEMO_HR.email },
  ...DEMO_CLINIC_USERS.map((c) => ({ role: c.role as Role, login: c.email })),
  ...DEMO_ASSIST_USERS.map((c) => ({ role: c.role as Role, login: c.email })),
  { role: 'insured', login: '+998 90 000 00 01' },
];

async function loginAs(acc: (typeof ACCOUNTS)[number]): Promise<Role> {
  const current = getSession();
  if (current) await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
  let challengeId: string;
  if (acc.role === 'insured') {
    challengeId = (await request('/auth/phone', { method: 'POST', body: { phone: DEMO_INSURED_PHONE }, schema: S.challenge })).challengeId;
    const res = await request('/auth/phone/verify', { method: 'POST', body: { challengeId, code: DEMO_CODE }, schema: S.sessionResponse });
    // Commit the new session (and any guard redirect it causes) before the caller navigates home.
    flushSync(() => setSession(res));
    return res.user.role;
  }
  challengeId = (await request('/auth/login', { method: 'POST', body: { email: acc.login, password: DEMO_PASSWORD }, schema: S.challenge })).challengeId;
  const res = await request('/auth/otp', { method: 'POST', body: { challengeId, code: DEMO_CODE }, schema: S.sessionResponse });
  flushSync(() => setSession(res));
  return res.user.role;
}

function DemoBanner() {
  const navigate = useNavigate();
  const qc = useQueryClient();
  const [failures, setFailures] = useState(false);
  const [confirmReset, setConfirmReset] = useState(false);
  const [busy, setBusy] = useState(false);

  useEffect(() => {
    document.documentElement.style.setProperty('--banner-h', '36px');
    request('/__demo/failures')
      .then((r) => setFailures(!!(r as { enabled?: boolean }).enabled))
      .catch(() => undefined);
    return () => {
      document.documentElement.style.removeProperty('--banner-h');
    };
  }, []);

  return (
    <div
      data-theme="staff"
      className="sticky top-0 z-[45] flex h-9 items-center justify-between gap-2 border-b border-warning/40 bg-warning-soft px-3 text-[12px] text-warning-text"
      role="region"
      aria-label="Демо-режим"
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
        Демо-версия · все данные вымышленные
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <Menu>
          <MenuTrigger asChild>
            <button type="button" className="inline-flex h-7 items-center gap-1 rounded-btn px-2 font-medium hover:bg-warning/10" disabled={busy}>
              Войти как… <ChevronDown className="h-3 w-3" aria-hidden />
            </button>
          </MenuTrigger>
          <MenuContent className="max-h-[calc(100vh-56px)] overflow-y-auto">
            {ACCOUNTS.map((a) => (
              <MenuItem
                key={a.login}
                onSelect={async () => {
                  setBusy(true);
                  try {
                    qc.clear();
                    const role = await loginAs(a);
                    navigate(homeFor(role));
                    toast.success(`Вы вошли как «${a.label ?? ROLE_LABEL[role]}»`);
                  } catch (e) {
                    toast.error(errorMessage(e));
                  } finally {
                    setBusy(false);
                  }
                }}
              >
                <span className="flex flex-col">
                  <span>{a.label ?? ROLE_LABEL[a.role]}</span>
                  <span className="text-[11px] text-muted">{a.login}</span>
                </span>
              </MenuItem>
            ))}
          </MenuContent>
        </Menu>
        <button
          type="button"
          className="hidden h-7 items-center gap-1 rounded-btn px-2 font-medium hover:bg-warning/10 sm:inline-flex"
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw className="h-3 w-3" aria-hidden /> Сбросить данные
        </button>
        <label className="hidden cursor-pointer items-center gap-1.5 px-2 font-medium md:flex">
          <input
            type="checkbox"
            checked={failures}
            onChange={async (e) => {
              const enabled = e.target.checked;
              setFailures(enabled);
              try {
                await request('/__demo/failures', { method: 'POST', body: { enabled } });
                toast.info(enabled ? 'Сбои сети включены: 10% запросов завершатся ошибкой' : 'Сбои сети выключены');
              } catch (err) {
                setFailures(!enabled);
                toast.error(errorMessage(err));
              }
            }}
          />
          Имитировать сбои сети
        </label>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title="Сбросить данные?"
        description="Все изменения в демо (записи, убытки, сотрудники, журнал) будут удалены, данные вернутся к исходным."
        confirmLabel="Сбросить данные"
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await request('/__demo/reset', { method: 'POST' });
            await qc.invalidateQueries();
            toast.success('Данные сброшены');
            setConfirmReset(false);
          } catch (e) {
            toast.error(errorMessage(e));
          } finally {
            setBusy(false);
          }
        }}
      />
    </div>
  );
}

function StaffLoginHints({ onPick }: { onPick: (email: string, password: string) => void }) {
  const list = [
    ...DEMO_STAFF.map((s) => ({ role: s.role as Role, email: s.email, label: s.label })),
    { role: 'hr' as Role, email: DEMO_HR.email },
    ...DEMO_CLINIC_USERS.map((c) => ({ role: c.role as Role, email: c.email })),
    ...DEMO_ASSIST_USERS.map((c) => ({ role: c.role as Role, email: c.email })),
  ];
  return (
    <div className="mt-6 border-t border-border pt-4">
      <p className="mb-2 text-[12px] text-muted">
        Демо-аккаунты · пароль <span className="num">{DEMO_PASSWORD}</span> · код <span className="num">{DEMO_CODE}</span>
      </p>
      <ul className="flex flex-col gap-1">
        {list.map((a) => (
          <li key={a.email} className="flex items-center justify-between gap-2 rounded-btn px-2 py-1 hover:bg-rail">
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">{('label' in a && a.label) || ROLE_LABEL[a.role]}</span>
              <span className="block truncate text-[12px] text-muted">{a.email}</span>
            </span>
            <button type="button" className="text-[12px] font-medium text-accent-text hover:underline" onClick={() => onPick(a.email, DEMO_PASSWORD)}>
              Подставить
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneLoginHint({ onPick }: { onPick: (phone: string) => void }) {
  return (
    <p className="mt-4 text-center text-[13px] text-muted">
      Демо: <span className="num">+998 90 000 00 01</span>, код <span className="num">{DEMO_CODE}</span> ·{' '}
      <button type="button" className="font-semibold text-accent underline" onClick={() => onPick('+998 90 000 00 01')}>
        Подставить
      </button>
    </p>
  );
}

function CodeHint() {
  return (
    <p className="mt-4 text-center text-[12px] text-muted">
      Демо-код: <span className="num">{DEMO_CODE}</span>
    </p>
  );
}

export const demoModule: DemoModule = { DemoBanner, StaffLoginHints, PhoneLoginHint, CodeHint, MisSimulator, AssistSimulator };
