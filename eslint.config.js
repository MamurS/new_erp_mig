import js from '@eslint/js';
import globals from 'globals';
import tseslint from 'typescript-eslint';
import react from 'eslint-plugin-react';
import reactHooks from 'eslint-plugin-react-hooks';

const htmlSinks = [
  {
    selector: "AssignmentExpression[left.property.name=/^(innerHTML|outerHTML)$/]",
    message: 'Assigning innerHTML/outerHTML is forbidden (XSS).',
  },
  {
    selector: "CallExpression[callee.property.name='insertAdjacentHTML']",
    message: 'insertAdjacentHTML is forbidden (XSS).',
  },
  {
    selector: "CallExpression[callee.object.name='document'][callee.property.name=/^(write|writeln)$/]",
    message: 'document.write is forbidden.',
  },
  {
    selector: "CallExpression[callee.name=/^(setTimeout|setInterval)$/] > Literal:first-child",
    message: 'String-based timers are forbidden.',
  },
];
// HTML strings may be rendered only by src/features/documents/DocFrame.tsx (sandboxed iframe, see DECISIONS.md).
const srcDocSink = {
  selector: "JSXAttribute[name.name='srcDoc'], Property[key.name='srcdoc'], AssignmentExpression[left.property.name='srcdoc']",
  message: 'srcDoc is allowed only in src/features/documents/DocFrame.tsx (sandboxed document frame).',
};

const storageLocal = [
  { object: 'window', property: 'localStorage', message: 'Use src/shared/lib/storage.ts' },
  { object: 'globalThis', property: 'localStorage', message: 'Use src/shared/lib/storage.ts' },
];
const storageSession = [
  { object: 'window', property: 'sessionStorage', message: 'Use src/shared/auth/session.ts' },
  { object: 'globalThis', property: 'sessionStorage', message: 'Use src/shared/auth/session.ts' },
];
const localGlobal = { name: 'localStorage', message: 'Use src/shared/lib/storage.ts' };
const sessionGlobal = { name: 'sessionStorage', message: 'Use src/shared/auth/session.ts' };

// Interface strings live in src/i18n. Cyrillic in a string or JSX text anywhere else in the app is
// an untranslated string. Documents, mock data and reference catalogues are not interface strings.
const CYRILLIC = /[А-Яа-яЁё]/;
const noCyrillicUi = {
  meta: {
    type: 'problem',
    messages: { ui: 'Interface strings belong in src/i18n (t(), msg(), defineLabels()); no Cyrillic outside the dictionaries.' },
    schema: [],
  },
  create(context) {
    const check = (node, text) => {
      if (CYRILLIC.test(text)) context.report({ node, messageId: 'ui' });
    };
    return {
      Literal: (n) => typeof n.value === 'string' && check(n, n.value),
      TemplateElement: (n) => check(n, n.value.raw),
      JSXText: (n) => check(n, n.value),
    };
  },
};
const migPlugin = { rules: { 'no-cyrillic-ui': noCyrillicUi } };

export default tseslint.config(
  {
    ignores: [
      'dist',
      'dist-*',
      'node_modules',
      'public/mockServiceWorker.js',
      'playwright-report',
      'test-results',
      'coverage',
      // Approved third-party brochure generator, kept verbatim as the reference copy.
      'vendor',
    ],
  },
  js.configs.recommended,
  ...tseslint.configs.recommended,
  {
    files: ['**/*.{ts,tsx}'],
    languageOptions: {
      ecmaVersion: 2022,
      globals: { ...globals.browser, ...globals.node },
    },
    plugins: { react, 'react-hooks': reactHooks },
    settings: { react: { version: '19' } },
    rules: {
      ...reactHooks.configs.recommended.rules,
      'react/no-danger': 'error',
      'react/jsx-no-script-url': 'error',
      'react/jsx-no-target-blank': 'error',
      'no-eval': 'error',
      'no-implied-eval': 'error',
      'no-new-func': 'error',
      'no-script-url': 'error',
      'no-restricted-syntax': ['error', ...htmlSinks, srcDocSink],
      'no-restricted-properties': ['error', ...storageLocal, ...storageSession],
      'no-restricted-globals': ['error', localGlobal, sessionGlobal],
      'no-console': 'error',
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': ['error', { argsIgnorePattern: '^_', varsIgnorePattern: '^_' }],
    },
  },
  {
    files: ['src/**/*.{ts,tsx}'],
    ignores: [
      'src/i18n/**',
      // The mock server: seed data and server-side texts that are data (audit, chat, activity).
      'src/mocks/**',
      'src/test/**',
      '**/*.test.{ts,tsx}',
      // Documents keep their own language (the approved KP template, contracts, endorsements, certificates).
      'src/features/kp/templates/**',
      'src/features/kp/format.ts',
      'src/features/kp/render.ts',
      'src/features/documents/templates/**',
      'src/features/documents/builders.ts',
      'src/features/documents/render.ts',
      'src/features/documents/html.ts',
      'src/features/documents/mig.ts',
      'src/features/documents/templatesDoc.ts',
      // Developer documentation and sample payloads of the clinic integration API.
      'src/shared/integration/openapi.ts',
      'src/shared/integration/sandbox.ts',
      // Reference data: the medical services catalogue, legal forms with their labels in three languages.
      'src/features/coverage/catalog.ts',
      'src/shared/config/legalForms.ts',
    ],
    plugins: { mig: migPlugin },
    rules: { 'mig/no-cyrillic-ui': 'error' },
  },
  {
    // The single place allowed to render an HTML string: a sandboxed iframe without scripts.
    files: ['src/features/documents/DocFrame.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...htmlSinks] },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['src/shared/lib/storage.ts'],
    rules: {
      'no-restricted-properties': ['error', ...storageSession],
      'no-restricted-globals': ['error', sessionGlobal],
    },
  },
  {
    files: ['src/shared/auth/session.ts'],
    rules: {
      'no-restricted-properties': ['error', ...storageLocal],
      'no-restricted-globals': ['error', localGlobal],
    },
  },
  {
    // Mock *server* persistence (emulates the backend DB, not the client session).
    files: ['src/mocks/persist.ts'],
    rules: {
      'no-restricted-properties': ['error', ...storageLocal],
      'no-restricted-globals': ['error', localGlobal],
    },
  },
  {
    files: ['src/shared/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests feed malicious inputs (javascript: URLs) on purpose.
    files: ['**/*.test.{ts,tsx}', 'e2e/**/*.ts'],
    rules: { 'no-script-url': 'off' },
  },
  {
    // Node-side tooling and tests may print to stdout and inspect storage.
    files: ['e2e/**/*.ts', 'tests/**/*.ts', '*.config.{js,ts}'],
    rules: { 'no-console': 'off', 'no-restricted-properties': 'off', 'no-restricted-globals': 'off' },
  },
);
