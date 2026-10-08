/* What the server provides to the routes (the mock provides its own, see apps/web/src/mocks/handlers/index.ts). */
import { createMockProvider } from '@mig/domain/lib/aiProvider';
import { randomToken } from '@mig/domain/lib/random';
import type { RouteDeps } from '@mig/domain/http/routes';
import { createHelpProvider, helpDir } from './help';

/** A 1×1 PNG: seeded receipts have no stored picture (Storage comes in part 2). */
const BLANK_PNG = Uint8Array.from(Buffer.from('iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+ip1sAAAAASUVORK5CYII=', 'base64'));

export function serverDeps(o: { helpDir?: string; demo: boolean; demoPassword?: string }): RouteDeps {
  return {
    // Stage 1: the AI provider is the deterministic mock (BACKEND_SPEC §1, «настоящая модель ИИ» is stage 2).
    aiProvider: () => createMockProvider({ latency: false }),
    help: createHelpProvider(helpDir(o.helpDir), o.demo) as RouteDeps['help'],
    receiptPng: async () => BLANK_PNG,
    // Without demo accounts an invited person gets an unusable random password (Supabase Auth invitations: part 2).
    invitePassword: o.demoPassword ?? randomToken(24),
  };
}
