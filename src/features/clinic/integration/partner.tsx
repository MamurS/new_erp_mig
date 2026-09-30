/*
 * Which partner the integration screens belong to (ASSISTANCE_SPEC §8): the clinic cabinet or an
 * assistance company. Keys, webhooks and logs belong to the partner; scopes, events, sandbox
 * methods and the docs section follow its type.
 */
import { createContext, useContext, type ReactNode } from 'react';
import type { PartnerType } from '@/shared/types';
import { ASSIST_SCOPES, ASSIST_WEBHOOK_EVENTS, INTEGRATION_SCOPES, WEBHOOK_EVENTS } from '@/shared/integration/schemas';
import { ASSIST_SANDBOX_METHODS, SANDBOX_METHODS, type SandboxMethod } from '@/shared/integration/sandbox';

export interface PartnerInfo {
  type: PartnerType;
  /** API prefix of the settings endpoints, e.g. `/clinic/integration`. */
  base: string;
  scopes: readonly string[];
  events: readonly string[];
  sandbox: SandboxMethod[];
  /** Docs sections (OpenAPI tags) shown to this partner. */
  docsTag: (tag: string) => boolean;
  defaultScope: string;
  systemName: string;
}

const isAssistTag = (t: string) => t.startsWith('Ассистанс');

export const CLINIC_PARTNER: PartnerInfo = {
  type: 'clinic',
  base: '/clinic/integration',
  scopes: INTEGRATION_SCOPES,
  events: WEBHOOK_EVENTS,
  sandbox: SANDBOX_METHODS,
  docsTag: (t) => !isAssistTag(t),
  defaultScope: 'coverage:check',
  systemName: 'медицинской информационной системы клиники',
};

export const ASSIST_PARTNER: PartnerInfo = {
  type: 'assistance',
  base: '/assist/integration',
  scopes: ASSIST_SCOPES,
  events: ASSIST_WEBHOOK_EVENTS,
  sandbox: ASSIST_SANDBOX_METHODS,
  docsTag: (t) => t === 'Авторизация' || isAssistTag(t),
  defaultScope: 'roster:read',
  systemName: 'системы ассистанса',
};

const PartnerContext = createContext<PartnerInfo>(CLINIC_PARTNER);

export function PartnerProvider({ partner, children }: { partner: PartnerInfo; children: ReactNode }) {
  return <PartnerContext.Provider value={partner}>{children}</PartnerContext.Provider>;
}

export const usePartner = () => useContext(PartnerContext);
