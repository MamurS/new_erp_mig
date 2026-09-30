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
// HTML strings may be rendered only by src/features/kp/KpFrame.tsx (sandboxed iframe, see DECISIONS.md).
const srcDocSink = {
  selector: "JSXAttribute[name.name='srcDoc'], Property[key.name='srcdoc'], AssignmentExpression[left.property.name='srcdoc']",
  message: 'srcDoc is allowed only in src/features/kp/KpFrame.tsx (sandboxed KP frame).',
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
    // The single place allowed to render an HTML string: a sandboxed iframe without scripts.
    files: ['src/features/kp/KpFrame.tsx'],
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
