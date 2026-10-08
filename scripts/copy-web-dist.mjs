/*
 * The demo site on Cloudflare publishes `dist/` at the repository root (wrangler.jsonc, Pages settings).
 * The web app builds into apps/web/dist; this copies it so the deploy settings did not have to change.
 */
import { cpSync, rmSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const root = resolve(dirname(fileURLToPath(import.meta.url)), '..');
rmSync(resolve(root, 'dist'), { recursive: true, force: true });
cpSync(resolve(root, 'apps/web/dist'), resolve(root, 'dist'), { recursive: true });
