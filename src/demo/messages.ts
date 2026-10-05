/* The demo module's strings: registered only when the demo module is loaded (VITE_DEMO_MODE). */
import { registerMessages } from '@/i18n/core';
import { demo as ru } from '@/i18n/dict/ru/demo';
import { demo as uzLatn } from '@/i18n/dict/uz-Latn/demo';
import { demo as en } from '@/i18n/dict/en/demo';

registerMessages({ ru, 'uz-Latn': uzLatn, en });
