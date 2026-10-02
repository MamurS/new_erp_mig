/* AI settings (AI_COVERAGE_SPEC §4.5): four scenarios, the provider of each, the confidence threshold and the kill switch. */
import type { AiProviderId, AiScenario, AiSettings } from '@/shared/types';

export const AI_SCENARIOS: readonly AiScenario[] = ['insured', 'clinic', 'decision', 'rebill'];

export const AI_SCENARIO_LABEL: Record<AiScenario, string> = {
  insured: 'Застрахованный в приложении',
  clinic: 'Клиника: ГП и реестр',
  decision: 'Подсказки при решениях (МИГ и ассистанс)',
  rebill: 'Предпроверка счёта ассистанса',
};

export const AI_PROVIDER_LABEL: Record<AiProviderId, string> = {
  mock: 'Мок (словарь синонимов)',
  local: 'Локальная модель на сервере МИГ',
  external: 'Внешний облачный провайдер',
};

/** Only the mock exists in the prototype; the others come with the backend. */
export const AI_PROVIDERS_AVAILABLE: readonly AiProviderId[] = ['mock'];

/** Below this confidence the answer is «Нужна проверка специалиста». */
export const DEFAULT_AI_THRESHOLD = 0.6;

export function defaultAiSettings(): AiSettings {
  return {
    scenarios: { insured: { enabled: true, provider: 'mock' }, clinic: { enabled: true, provider: 'mock' }, decision: { enabled: true, provider: 'mock' }, rebill: { enabled: true, provider: 'mock' } },
    confidenceThreshold: DEFAULT_AI_THRESHOLD,
    killSwitch: false,
  };
}

/** A scenario works only if it is on and the kill switch is off. */
export function aiEnabled(s: AiSettings, scenario: AiScenario): boolean {
  return !s.killSwitch && s.scenarios[scenario].enabled;
}
