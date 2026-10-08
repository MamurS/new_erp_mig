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
// HTML strings may be rendered only by apps/web/src/features/documents/DocFrame.tsx (sandboxed iframe, see DECISIONS.md).
const srcDocSink = {
  selector: "JSXAttribute[name.name='srcDoc'], Property[key.name='srcdoc'], AssignmentExpression[left.property.name='srcdoc']",
  message: 'srcDoc is allowed only in apps/web/src/features/documents/DocFrame.tsx (sandboxed document frame).',
};

const storageLocal = [
  { object: 'window', property: 'localStorage', message: 'Use apps/web/src/shared/lib/storage.ts' },
  { object: 'globalThis', property: 'localStorage', message: 'Use apps/web/src/shared/lib/storage.ts' },
];
const storageSession = [
  { object: 'window', property: 'sessionStorage', message: 'Use apps/web/src/shared/auth/session.ts' },
  { object: 'globalThis', property: 'sessionStorage', message: 'Use apps/web/src/shared/auth/session.ts' },
];
const localGlobal = { name: 'localStorage', message: 'Use apps/web/src/shared/lib/storage.ts' };
const sessionGlobal = { name: 'sessionStorage', message: 'Use apps/web/src/shared/auth/session.ts' };

// Interface strings live in packages/i18n. Cyrillic in a string or JSX text anywhere else in the app is
// an untranslated string. Documents, mock data and reference catalogues are not interface strings.
const CYRILLIC = /[А-Яа-яЁё]/;
const noCyrillicUi = {
  meta: {
    type: 'problem',
    messages: { ui: 'Interface strings belong in packages/i18n (t(), msg(), defineLabels()); no Cyrillic outside the dictionaries.' },
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
      '**/dist',
      '**/dist-*',
      '**/node_modules',
      'apps/web/public/mockServiceWorker.js',
      '**/playwright-report',
      '**/test-results',
      '**/coverage',
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
    files: ['apps/web/src/**/*.{ts,tsx}', 'packages/*/src/**/*.ts'],
    ignores: [
      'packages/i18n/**',
      // The mock server and the demo seed: seed data and server-side texts that are data (audit, chat, activity).
      'apps/web/src/mocks/**',
      'packages/seed/**',
      // The services: server-side texts that are data (audit labels, chat replies, activity), as in the mock.
      'packages/domain/src/services/**',
      'apps/web/src/test/**',
      '**/*.test.{ts,tsx}',
      // Documents keep their own language (the approved KP template, contracts, endorsements, certificates).
      'apps/web/src/features/kp/templates/**',
      'apps/web/src/features/kp/format.ts',
      'apps/web/src/features/kp/render.ts',
      'packages/domain/src/documents/templates/**',
      'apps/web/src/features/documents/builders.ts',
      'apps/web/src/features/documents/render.ts',
      'apps/web/src/features/documents/html.ts',
      'apps/web/src/features/documents/mig.ts',
      'apps/web/src/features/documents/templatesDoc.ts',
      // Developer documentation and sample payloads of the clinic integration API.
      'apps/web/src/shared/integration/openapi.ts',
      'apps/web/src/shared/integration/sandbox.ts',
      // Reference data: the medical services catalogue, legal forms with their labels in three languages.
      'apps/web/src/features/coverage/catalog.ts',
      'packages/domain/src/config/legalForms.ts',
      // Language data of the help search: stop words, synonyms and cues in the languages of the guide.
      'apps/web/src/shared/help/lang.ts',
    ],
    plugins: { mig: migPlugin },
    rules: { 'mig/no-cyrillic-ui': 'error' },
  },
  {
    // The single place allowed to render an HTML string: a sandboxed iframe without scripts.
    files: ['apps/web/src/features/documents/DocFrame.tsx'],
    rules: { 'no-restricted-syntax': ['error', ...htmlSinks] },
  },
  {
    // Packages are shared with the server: no app aliases, no reaching into the web app.
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        { patterns: [{ group: ['@/*', '@mig/web', '@mig/web/*', '**/apps/web/**'], message: 'Packages must not import the web app.' }] },
      ],
    },
  },
  {
    files: ['scripts/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    files: ['apps/web/src/shared/lib/storage.ts'],
    rules: {
      'no-restricted-properties': ['error', ...storageSession],
      'no-restricted-globals': ['error', sessionGlobal],
    },
  },
  {
    files: ['apps/web/src/shared/auth/session.ts'],
    rules: {
      'no-restricted-properties': ['error', ...storageLocal],
      'no-restricted-globals': ['error', localGlobal],
    },
  },
  {
    // Mock *server* persistence (emulates the backend DB, not the client session).
    files: ['apps/web/src/mocks/persist.ts'],
    rules: {
      'no-restricted-properties': ['error', ...storageLocal],
      'no-restricted-globals': ['error', localGlobal],
    },
  },
  {
    files: ['apps/web/src/shared/lib/logger.ts'],
    rules: { 'no-console': 'off' },
  },
  {
    // Tests feed malicious inputs (javascript: URLs) on purpose.
    files: ['**/*.test.{ts,tsx}', 'apps/web/e2e/**/*.ts'],
    rules: { 'no-script-url': 'off' },
  },
  {
    // Node-side tooling and tests may print to stdout and inspect storage.
    files: ['apps/web/e2e/**/*.ts', 'apps/web/tests/**/*.ts', 'scripts/**/*.test.ts', '**/*.config.{js,ts}'],
    rules: { 'no-console': 'off', 'no-restricted-properties': 'off', 'no-restricted-globals': 'off' },
  },
);
