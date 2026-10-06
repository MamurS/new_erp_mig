/* Commercial offer (KP) business rules shared by the UI and the mock server. */
import { defineLabels } from '@/i18n';
import type { KpParams, KpStatus, Money } from '@/shared/types';
import { DEFAULT_NUMBERING, docNumber, type NumberingTemplates } from './numbering';

/** Current version of each brochure (kept equal to templates/*.ts by a unit test). */
export const KP_TEMPLATE_VERSION = { gold: 'GOLD 09/26' } as const;

export const KP_PAGE_COUNT = 17; // brochure cover, offer letter, brochure pages 2–16

export function kpTotalPremium(p: Pick<KpParams, 'employees' | 'premiumEmployee' | 'familyMembers' | 'premiumFamily'>): Money {
  return p.employees * p.premiumEmployee + p.familyMembers * p.premiumFamily;
}

/**
 * Premium per person for a renewal offer: a person transferred from the previous system counts with
 * the own premium stored at the transfer (`migratedPremium`), any other person with an even share of the
 * policy premium; the offer takes their average. Without transferred persons it is the even share.
 */
export function renewalPremiumPerPerson(policyPremium: Money, insuredCount: number, persons: readonly { migratedPremium?: { amount: Money } }[]): Money {
  const share = policyPremium / Math.max(1, insuredCount || persons.length);
  if (!persons.some((p) => p.migratedPremium)) return share;
  return persons.reduce((s, p) => s + (p.migratedPremium ? p.migratedPremium.amount : share), 0) / persons.length;
}

/** 'KP-2026-000123' with the default template. */
export function kpNumber(year: number, seq: number, templates: Partial<NumberingTemplates> = DEFAULT_NUMBERING): string {
  return docNumber('kp', { year, n: seq }, templates);
}

/**
 * Document title (iframe `<title>` and default PDF name): `KP-2026-000123 — {client}`.
 * File-system special and control characters are removed.
 */
export function kpDocumentTitle(number: string, clientName: string): string {
  const clean = (s: string) =>
    s
      // eslint-disable-next-line no-control-regex -- stripping control characters on purpose
      .replace(/[\u0000-\u001f\u007f<>:"/\\|?*]/g, '')
      .replace(/\s+/g, ' ')
      .trim();
  return `${clean(number)} — ${clean(clientName)}`.slice(0, 150).trim();
}

export const KP_STATUS_LABEL = defineLabels<KpStatus>('labels.kpStatus', ['draft', 'sent', 'revoked', 'accepted', 'declined']);
/** Chip kind per status (see src/shared/ui/chips.tsx). */
export const KP_STATUS_CHIP = { draft: 'neutral', sent: 'success', revoked: 'danger', accepted: 'success', declined: 'warning' } as const;
export const KP_TEMPLATE_NAME = { gold: 'GOLD' } as const;
