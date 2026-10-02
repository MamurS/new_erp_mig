/* Commercial offer (KP) business rules shared by the UI and the mock server. */
import type { KpParams, Money } from '@/shared/types';

/** Current version of each brochure (kept equal to templates/*.ts by a unit test). */
export const KP_TEMPLATE_VERSION = { gold: 'GOLD 09/26' } as const;

export const KP_PAGE_COUNT = 17; // brochure cover, offer letter, brochure pages 2–16

export function kpTotalPremium(p: Pick<KpParams, 'employees' | 'premiumEmployee' | 'familyMembers' | 'premiumFamily'>): Money {
  return p.employees * p.premiumEmployee + p.familyMembers * p.premiumFamily;
}

export function kpNumber(year: number, seq: number): string {
  return `КП-${year}-${String(seq).padStart(6, '0')}`;
}

/**
 * Document title (iframe `<title>` and default PDF name): `КП-2026-000123 — {client}`.
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

export const KP_STATUS_LABEL = { draft: 'Черновик', sent: 'Отправлено', revoked: 'Отозвано', accepted: 'Принято клиентом', declined: 'Отклонено клиентом' } as const;
/** Chip kind per status (see src/shared/ui/chips.tsx). */
export const KP_STATUS_CHIP = { draft: 'neutral', sent: 'success', revoked: 'danger', accepted: 'success', declined: 'warning' } as const;
export const KP_TEMPLATE_NAME = { gold: 'GOLD' } as const;
