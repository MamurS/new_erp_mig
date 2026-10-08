/*
 * Demo module. Loaded only when VITE_DEMO_MODE === 'true'; absent from other builds.
 * «Войти как…» performs a real login through the mock API, it never changes the role client-side.
 */
import './messages';
import { defineLabels, t } from '@/i18n';
import { useEffect, useRef, useState } from 'react';
import * as Popover from '@radix-ui/react-popover';
import { flushSync } from 'react-dom';
import { matchesSearch } from '@/shared/lib/searchNormalize';
import { formatPhone, normalizePhone } from '@mig/domain/lib/masks';
import { useNavigate } from 'react-router-dom';
import { useQueryClient } from '@tanstack/react-query';
import { ChevronDown, FlaskConical, RotateCcw, Search } from 'lucide-react';
import type { Role } from '@mig/contracts';
import type { DemoModule } from '@/shared/demo';
import { request, errorMessage } from '@/shared/api/client';
import * as S from '@mig/contracts/schemas';
import { getSession, setSession } from '@/shared/auth/session';
import { homeFor } from '@mig/domain/auth/home';
import { ROLE_LABEL } from '@mig/domain/labels';
import { toast } from '@/shared/ui/toast';
import { ConfirmDialog } from '@/shared/ui/confirm-dialog';
import { MisSimulator } from './MisSimulator';
import { AssistSimulator } from './AssistSimulator';
import { MigrationSamples } from './MigrationSamples';
import { DEMO_ASSIST_USERS, DEMO_CLINIC_USERS, DEMO_CODE, DEMO_HR, DEMO_INSURED_PHONE, DEMO_PASSWORD, DEMO_SPOUSE_PHONE, DEMO_STAFF } from '@mig/seed/credentials';

type Account = { role: Role; login: string; label?: string };

/** One entry per demo account, grouped by portal: a role may have several (a claims officer and their head). */
const GROUPS: { id: 'mig' | 'assist' | 'clinic' | 'hr' | 'insured'; accounts: Account[] }[] = [
  { id: 'mig', accounts: DEMO_STAFF.map((s) => ({ role: s.role as Role, login: s.email, label: s.label })) },
  { id: 'assist', accounts: DEMO_ASSIST_USERS.map((c) => ({ role: c.role as Role, login: c.email })) },
  { id: 'clinic', accounts: DEMO_CLINIC_USERS.map((c) => ({ role: c.role as Role, login: c.email })) },
  { id: 'hr', accounts: [{ role: 'hr', login: DEMO_HR.email }] },
  {
    id: 'insured',
    accounts: [
      { role: 'insured', login: formatPhone(DEMO_INSURED_PHONE) },
      // The employee's spouse: an adult family member with an own login (FAMILY_SPEC).
      {
        role: 'insured',
        login: formatPhone(DEMO_SPOUSE_PHONE),
        get label() {
          return t('demo.acc.spouse');
        },
      },
    ],
  },
];
const GROUP_TITLE = defineLabels('demo.group', ['mig', 'assist', 'clinic', 'hr', 'insured'] as const);

const accountLabel = (a: Account) => a.label ?? ROLE_LABEL[a.role];

async function loginAs(acc: Account): Promise<Role> {
  const current = getSession();
  if (current) await request('/auth/logout', { method: 'POST' }).catch(() => undefined);
  let challengeId: string;
  if (acc.role === 'insured') {
    challengeId = (await request('/auth/phone', { method: 'POST', body: { phone: normalizePhone(acc.login) }, schema: S.challenge })).challengeId;
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
      className="sticky top-0 z-45 flex h-9 items-center justify-between gap-2 border-b border-warning/40 bg-warning-soft px-3 text-[12px] text-warning-text"
      role="region"
      aria-label={t('demo.banner.label')}
    >
      <span className="flex min-w-0 items-center gap-1.5 truncate font-semibold">
        <FlaskConical className="h-3.5 w-3.5 shrink-0" aria-hidden />
        {t('demo.banner.text')}
      </span>
      <div className="flex shrink-0 items-center gap-1">
        <LoginAsMenu
          busy={busy}
          onPick={async (a) => {
            setBusy(true);
            try {
              qc.clear();
              const role = await loginAs(a);
              // An insured person without the consent goes straight to the consent screen: the guard sends there
              // anyway, and a second navigation to the app home would race it (an app → app switch keeps the layout).
              const consentMissing = role === 'insured' && !getSession()?.user.consentGivenAt;
              navigate(consentMissing ? '/app/consent' : homeFor(role));
              toast.success(t('demo.loginAs.done', { label: a.label ?? ROLE_LABEL[role] }));
            } catch (e) {
              toast.error(errorMessage(e));
            } finally {
              setBusy(false);
            }
          }}
        />
        <button
          type="button"
          className="hidden h-7 items-center gap-1 rounded-btn px-2 font-medium hover:bg-warning/10 sm:inline-flex"
          onClick={() => setConfirmReset(true)}
        >
          <RotateCcw className="h-3 w-3" aria-hidden /> {t('demo.reset.action')}
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
                toast.info(enabled ? t('demo.failures.on') : t('demo.failures.off'));
              } catch (err) {
                setFailures(!enabled);
                toast.error(errorMessage(err));
              }
            }}
          />
          {t('demo.failures.label')}
        </label>
      </div>
      <ConfirmDialog
        open={confirmReset}
        onOpenChange={setConfirmReset}
        title={t('demo.reset.title')}
        description={t('demo.reset.description')}
        confirmLabel={t('demo.reset.action')}
        danger
        loading={busy}
        onConfirm={async () => {
          setBusy(true);
          try {
            await request('/__demo/reset', { method: 'POST' });
            await qc.invalidateQueries();
            toast.success(t('demo.reset.done'));
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

/** «Войти как…»: accounts grouped by portal, «Роль — email», with a search on top. */
function LoginAsMenu({ busy, onPick }: { busy: boolean; onPick: (a: Account) => void }) {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const list = useRef<HTMLDivElement>(null);
  const q = query.trim();
  const groups = GROUPS.map((g) => ({ ...g, title: GROUP_TITLE[g.id] }))
    .map((g) => ({ ...g, accounts: g.accounts.filter((a) => matchesSearch(q, g.title, accountLabel(a), a.login)) }))
    .filter((g) => g.accounts.length > 0);
  const items = () => Array.from(list.current?.querySelectorAll<HTMLButtonElement>('[role="menuitem"]') ?? []);
  const move = (from: HTMLElement | null, step: number) => {
    const all = items();
    const i = from ? all.indexOf(from as HTMLButtonElement) : -1;
    all[Math.max(0, Math.min(all.length - 1, i + step))]?.focus();
  };
  return (
    <Popover.Root
      open={open}
      onOpenChange={(o) => {
        setOpen(o);
        if (!o) setQuery('');
      }}
    >
      <Popover.Trigger asChild>
        <button type="button" className="inline-flex h-7 items-center gap-1 rounded-btn px-2 font-medium hover:bg-warning/10" disabled={busy}>
          {t('demo.loginAs.button')} <ChevronDown className="h-3 w-3" aria-hidden />
        </button>
      </Popover.Trigger>
      <Popover.Portal>
        <Popover.Content
          data-theme="staff"
          align="end"
          sideOffset={4}
          className="z-50 flex max-h-[calc(100vh-56px)] w-[360px] max-w-[calc(100vw-16px)] flex-col rounded-card border border-border bg-surface text-[13px] text-text shadow-lg"
        >
          <div className="flex items-center gap-2 border-b border-border px-3">
            <Search className="h-3.5 w-3.5 shrink-0 text-muted" aria-hidden />
            <input
              autoFocus
              aria-label={t('demo.loginAs.search')}
              placeholder={t('demo.loginAs.placeholder')}
              className="h-10 w-full bg-transparent outline-hidden placeholder:text-muted"
              value={query}
              onChange={(e) => setQuery(e.target.value)}
              onKeyDown={(e) => {
                if (e.key === 'ArrowDown') {
                  e.preventDefault();
                  move(null, 1);
                } else if (e.key === 'Enter' && groups.length) {
                  e.preventDefault();
                  items()[0]?.click();
                }
              }}
            />
          </div>
          <div ref={list} role="menu" aria-label={t('demo.loginAs.menu')} className="min-h-0 flex-1 overflow-y-auto p-1">
            {groups.length === 0 && <p className="px-2 py-3 text-muted">{t('common.notFound')}</p>}
            {groups.map((g) => (
              <div key={g.title} role="group" aria-label={g.title} className="mb-1">
                <p aria-hidden className="px-2 pb-0.5 pt-2 text-[11px] text-muted">
                  {g.title}
                </p>
                {g.accounts.map((a) => (
                  <button
                    key={a.login}
                    type="button"
                    role="menuitem"
                    className="block w-full rounded-btn px-2 py-1.5 text-left outline-hidden hover:bg-rail focus-visible:bg-rail"
                    onKeyDown={(e) => {
                      if (e.key === 'ArrowDown' || e.key === 'ArrowUp') {
                        e.preventDefault();
                        move(e.currentTarget, e.key === 'ArrowDown' ? 1 : -1);
                      }
                    }}
                    onClick={() => {
                      setOpen(false);
                      setQuery('');
                      onPick(a);
                    }}
                  >
                    <span className="font-medium">{accountLabel(a)}</span>{' '}
                    <span className="text-muted">— {a.login}</span>
                  </button>
                ))}
              </div>
            ))}
          </div>
        </Popover.Content>
      </Popover.Portal>
    </Popover.Root>
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
        {t('demo.hints.staff', { password: DEMO_PASSWORD, code: DEMO_CODE })}
      </p>
      <ul className="flex flex-col gap-1">
        {list.map((a) => (
          <li key={a.email} className="flex items-center justify-between gap-2 rounded-btn px-2 py-1 hover:bg-rail">
            <span className="min-w-0">
              <span className="block text-[12px] font-medium">{('label' in a && a.label) || ROLE_LABEL[a.role]}</span>
              <span className="block truncate text-[12px] text-muted">{a.email}</span>
            </span>
            <button type="button" className="text-[12px] font-medium text-accent-text hover:underline" onClick={() => onPick(a.email, DEMO_PASSWORD)}>
              {t('demo.hints.fill')}
            </button>
          </li>
        ))}
      </ul>
    </div>
  );
}

function PhoneLoginHint({ onPick }: { onPick: (phone: string) => void }) {
  const employee = formatPhone(DEMO_INSURED_PHONE);
  const spouse = formatPhone(DEMO_SPOUSE_PHONE);
  return (
    <div className="mt-4 flex flex-col gap-1 text-center text-[13px] text-muted">
      <p>
        {t('demo.hints.phone', { phone: employee, code: DEMO_CODE })} ·{' '}
        <button type="button" className="font-semibold text-accent underline" onClick={() => onPick(employee)}>
          {t('demo.hints.fill')}
        </button>
      </p>
      <p>
        {t('demo.hints.phoneSpouse', { phone: spouse })} ·{' '}
        <button type="button" className="font-semibold text-accent underline" aria-label={`${t('demo.hints.fill')}: ${t('demo.acc.spouse')}`} onClick={() => onPick(spouse)}>
          {t('demo.hints.fill')}
        </button>
      </p>
    </div>
  );
}

function CodeHint() {
  return (
    <p className="mt-4 text-center text-[12px] text-muted">
      {t('demo.hints.demoCode')} <span className="num">{DEMO_CODE}</span>
    </p>
  );
}

export const demoModule: DemoModule = { DemoBanner, StaffLoginHints, PhoneLoginHint, CodeHint, MisSimulator, AssistSimulator, MigrationSamples };
