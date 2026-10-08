/*
 * Registry for the optional demo module. Nothing in the app imports src/demo directly:
 * main.tsx loads it dynamically only when VITE_DEMO_MODE === 'true'.
 */
import type { ComponentType } from 'react';
import type { MigrationStep } from '@mig/contracts/migration';

export interface DemoModule {
  DemoBanner: ComponentType;
  StaffLoginHints: ComponentType<{ onPick: (email: string, password: string) => void }>;
  PhoneLoginHint: ComponentType<{ onPick: (phone: string) => void }>;
  CodeHint: ComponentType;
  /** Clinic cabinet: buttons that make real integration API calls as a clinic MIS would. */
  MisSimulator: ComponentType;
  /** Assistance portal: buttons that make real integration API calls as the assistance's system would. */
  AssistSimulator: ComponentType;
  /** Portfolio transfer: downloads of the demo files of the previous system. */
  MigrationSamples: ComponentType<{ stepLabel: (step: MigrationStep) => string }>;
}

let current: DemoModule | null = null;

export function registerDemo(m: DemoModule): void {
  current = m;
}

export function getDemo(): DemoModule | null {
  return current;
}
