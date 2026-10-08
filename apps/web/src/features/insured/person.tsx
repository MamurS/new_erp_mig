/*
 * The person the app is showing (FAMILY_SPEC): the signed-in insured person or a member of their family picked
 * in the switcher «Я / {name}» on the home screen. Kept in memory for the session of the app layout only — never
 * in the URL or in storage; the server decides what may be seen (404 for anyone else).
 */
import {
  createContext,
  useCallback,
  useContext,
  useMemo,
  useRef,
  useState,
  type KeyboardEvent,
  type ReactNode,
} from 'react';
import { EyeOff, Plus } from 'lucide-react';
import { Link } from 'react-router-dom';
import { useI18n } from '@/i18n';
import type { FamilyProfile } from '@mig/contracts/dto';
import { useMyFamily } from '@/shared/api/queries/me';
import { RELATION_LABEL } from '@mig/domain/family';
import { cn } from '@/shared/lib/cn';
import { Empty, ScreenHeader } from './components';

export interface SelectedPerson {
  /** `undefined` — the signed-in person (hooks then ask about «me»). */
  personId: string | undefined;
  /** The picked profile (the signed-in person while the family is loading). */
  person: FamilyProfile | undefined;
  family: FamilyProfile[];
  isSelf: boolean;
  /** Limits, claims, appointments, booking and receipts may be shown for this person. */
  medical: boolean;
  select: (id: string) => void;
}

const SELF: SelectedPerson = {
  personId: undefined,
  person: undefined,
  family: [],
  isSelf: true,
  medical: true,
  select: () => undefined,
};
const Ctx = createContext<SelectedPerson>(SELF);

export function PersonProvider({ children }: { children: ReactNode }) {
  const family = useMyFamily();
  const [picked, setPicked] = useState<string | null>(null);
  const select = useCallback((id: string) => setPicked(id), []);
  const value = useMemo<SelectedPerson>(() => {
    const list = family.data ?? [];
    const self = list.find((p) => p.access === 'self');
    // A person that left the list (excluded, consent revoked to nothing) falls back to the signed-in one.
    const person = list.find((p) => p.id === picked) ?? self;
    const isSelf = !person || person.access === 'self';
    return {
      personId: isSelf ? undefined : person.id,
      person,
      family: list,
      isSelf,
      medical: !person || person.access !== 'basic',
      select,
    };
  }, [family.data, picked, select]);
  return <Ctx.Provider value={value}>{children}</Ctx.Provider>;
}

export const usePerson = (): SelectedPerson => useContext(Ctx);

/** «Я» for the signed-in person, the first name for anyone else. */
export function usePersonLabel(): (p: FamilyProfile | undefined) => string {
  const { t } = useI18n();
  return (p) => (!p || p.access === 'self' ? t('app.family.me') : p.firstName);
}

/**
 * The switcher «Я / {name}»: a radio group (arrow keys move and pick). `addTo` (the employee only): the last chip
 * «+ Добавить» opens the request to add a family member. Hidden for a person without family and without it.
 */
export function ProfileSwitcher({ className, addTo }: { className?: string; addTo?: string }) {
  const { t } = useI18n();
  const { family, person, select } = usePerson();
  const label = usePersonLabel();
  const refs = useRef<(HTMLButtonElement | null)[]>([]);
  const add = addTo ? (
    <Link
      to={addTo}
      aria-label={t('app.family.addAria')}
      data-testid="profile-add"
      className="flex min-h-[44px] shrink-0 items-center gap-1 rounded-full border border-dashed border-accent px-4 text-[15px] font-semibold text-accent-text hover:bg-accent-soft"
    >
      <Plus className="h-4 w-4" aria-hidden />
      {t('app.family.addShort')}
    </Link>
  ) : null;
  if (family.length < 2) return add ? <div className={cn('-mx-4 flex gap-2 overflow-x-auto px-4 pb-1', className)}>{add}</div> : null;
  const current = Math.max(
    0,
    family.findIndex((p) => p.id === person?.id),
  );
  const onKey = (e: KeyboardEvent, i: number) => {
    const step =
      e.key === 'ArrowRight' || e.key === 'ArrowDown'
        ? 1
        : e.key === 'ArrowLeft' || e.key === 'ArrowUp'
          ? -1
          : 0;
    if (!step) return;
    e.preventDefault();
    const next = (i + step + family.length) % family.length;
    const p = family[next];
    if (!p) return;
    select(p.id);
    refs.current[next]?.focus();
  };
  return (
    <div data-testid="profile-switcher" className={cn('-mx-4 flex gap-2 overflow-x-auto px-4 pb-1', className)}>
      <div role="radiogroup" aria-label={t('app.family.switcher')} className="flex gap-2">
      {family.map((p, i) => {
        const on = i === current;
        return (
          <button
            key={p.id}
            ref={(el) => {
              refs.current[i] = el;
            }}
            type="button"
            role="radio"
            aria-checked={on}
            tabIndex={on ? 0 : -1}
            data-person-relation={p.relation}
            onClick={() => select(p.id)}
            onKeyDown={(e) => onKey(e, i)}
            className={cn(
              'min-h-[44px] shrink-0 rounded-full border px-4 text-[15px] font-semibold transition-colors',
              on
                ? 'border-accent bg-accent text-white'
                : 'border-border bg-surface text-text hover:border-accent',
            )}
          >
            {label(p)}
          </button>
        );
      })}
      </div>
      {add}
    </div>
  );
}

/** «Для кого»: shown on per-person screens while a family member is picked. */
export function PersonNote() {
  const { t } = useI18n();
  const { person, isSelf } = usePerson();
  if (isSelf || !person) return null;
  return (
    <p
      className="mb-4 rounded-card bg-accent-soft px-4 py-2.5 text-[14px] font-semibold text-accent-text"
      data-testid="person-note"
    >
      {t('app.family.for', { name: person.fullName, relation: RELATION_LABEL[person.relation] })}
    </p>
  );
}

/** Why claims and appointments of an adult family member are not shown (no consent). */
export function MedicalHidden({ person }: { person: FamilyProfile | undefined }) {
  const { t } = useI18n();
  return (
    <div data-testid="medical-hidden">
      <Empty
        icon={<EyeOff className="h-8 w-8" aria-hidden />}
        title={t('app.family.hidden', { name: person?.firstName ?? '' })}
      />
    </div>
  );
}

/** Children render only when the picked person's medical data may be shown; otherwise the explanation. */
export function MedicalGate({ children }: { children: ReactNode }) {
  const { medical, person } = usePerson();
  return medical ? <>{children}</> : <MedicalHidden person={person} />;
}

/** A care screen (booking, receipt, coverage check) opened for an adult family member without consent. */
export function NoMedical() {
  const { person } = usePerson();
  return (
    <div>
      <ScreenHeader title={person?.fullName ?? ''} back="/app" />
      <MedicalHidden person={person} />
    </div>
  );
}
