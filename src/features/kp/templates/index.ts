/* Registry of brochure templates a commercial offer can be built on. */
import type { KpLang, KpVariant } from '@/shared/types';
import { GOLD_TEMPLATES, GOLD_TEMPLATE_VERSION } from './gold';

export interface KpTemplate {
  id: 'gold';
  name: string;
  version: string;
  /** Brochure pages per language/variant (the offer letter is added in front). */
  pages: Readonly<Record<`${KpLang}-${KpVariant}`, readonly string[]>>;
  languages: readonly KpLang[];
  variants: readonly KpVariant[];
  /** Static files (fonts.css, assets/) relative to the site root. */
  assetBase: string;
}

export const KP_TEMPLATES = {
  gold: {
    id: 'gold',
    name: 'GOLD',
    version: GOLD_TEMPLATE_VERSION,
    pages: GOLD_TEMPLATES,
    languages: ['ru', 'en'],
    variants: ['white', 'grey', 'black'],
    assetBase: '/kp/gold/',
  },
} as const satisfies Record<string, KpTemplate>;

export type KpTemplateId = keyof typeof KP_TEMPLATES;
