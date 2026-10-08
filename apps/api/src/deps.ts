/* What the server provides to the routes (the mock provides its own, see apps/web/src/mocks/handlers/index.ts). */
import { createMockProvider } from '@mig/domain/lib/aiProvider';
import { randomToken } from '@mig/domain/lib/random';
import type { RouteDeps } from '@mig/domain/http/routes';
import { receiptPng } from './files/receiptImage';
import { createHelpProvider, helpDir } from './help';

export function serverDeps(o: { helpDir?: string; demo: boolean }): RouteDeps {
  return {
    // Stage 1: the AI provider is the deterministic mock (BACKEND_SPEC §1, «настоящая модель ИИ» is stage 2).
    aiProvider: () => createMockProvider({ latency: false }),
    help: createHelpProvider(helpDir(o.helpDir), o.demo) as RouteDeps['help'],
    // Seeded receipts have lines, not a photo: a drawn slip (files/receiptImage.ts).
    receiptPng: async (lines) => receiptPng(lines),
    // Passwords live in Supabase Auth (an invitation, or the demo password in development: jobs/identity.ts);
    // the services' virtual password field gets an unusable random value.
    invitePassword: randomToken(24),
  };
}
