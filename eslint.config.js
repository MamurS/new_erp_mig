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

// Privileged access (RLS bypass, docs/PRIVILEGED_AUDIT.md): a request runs as its person under row-level security.
// The service role is reached only through these calls, and only from an explicit allowlist of files below:
// the lazy clocks, cross-role consequences and the webhook outbox (services/system/), the portfolio transfer, the
// demo routes, sign-in and identity provisioning, jobs, and the store/transaction plumbing itself.
const privilegedCalls = [
  {
    selector: "CallExpression[callee.name=/^(systemRepos|asSystem)$/]",
    message: 'Privileged repositories (RLS bypass) only in the allowlisted files of eslint.config.js (docs/PRIVILEGED_AUDIT.md): run as the person, add an RLS policy or a narrow fact (store/facts.ts).',
  },
  {
    selector: "CallExpression[callee.property.name='privileged']",
    message: 'privileged() (the service role) only in the allowlisted files of eslint.config.js (docs/PRIVILEGED_AUDIT.md).',
  },
];
const systemSession = [
  {
    selector: "CallExpression[callee.property.name='system']",
    message: 'The system session (the service role) only in the allowlisted files of eslint.config.js (docs/PRIVILEGED_AUDIT.md).',
  },
  {
    selector: "Property[key.name='privileged'][value.value=true]",
    message: 'System repositories (privileged: true) only in the allowlisted files of eslint.config.js (docs/PRIVILEGED_AUDIT.md).',
  },
];
const PRIVILEGED_ALLOWLIST = [
  // The definitions of the capability.
  'packages/domain/src/services/kernel.ts',
  // Lazy clocks (jobs run on read), consequences of an act across roles, the webhook outbox.
  'packages/domain/src/services/system/**',
  // The portfolio transfer (a data migration approved by two admins).
  'packages/domain/src/services/migration.ts',
  // Demo-only routes (staging and CI, never production).
  'packages/domain/src/http/demoRoutes.ts',
  // The Postgres repositories: system-only tables and secret columns of rows RLS already returned.
  'packages/domain/src/store/postgres.ts',
  // The request transaction, the jobs' database, sign-in and identity provisioning, the background jobs.
  'apps/api/src/db.ts',
  'apps/api/src/systemDb.ts',
  'apps/api/src/auth/**',
  'apps/api/src/jobs/**',
];

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
      // The fake OCR of receipts (demo data moved from the seed into the domain).
      'packages/domain/src/lib/receipts.ts',
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
  // Packages are shared with the server: no app aliases, no reaching into the web app (rule below, with systemDb).
  {
    files: ['scripts/**/*.mjs', 'apps/api/*.mjs', 'deploy/**/*.mjs'],
    languageOptions: { globals: { ...globals.node } },
  },
  {
    // BACKEND_SPEC §2.3: the service role (RLS bypass) only for jobs and system tasks. A request runs as its
    // person; the route table, the services and the request adapter never import systemDb (the narrow
    // privileged capability is `ctx.system`, see packages/domain/src/services/kernel.ts).
    files: ['packages/*/src/**/*.ts'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/systemDb', '**/systemDb.ts', '@mig/api', '@mig/api/*'], message: 'systemDb (service role) is for jobs and system tasks only, not for routes or services.' },
            { group: ['@/*', '@mig/web', '@mig/web/*', '**/apps/web/**'], message: 'Packages must not import the web app.' },
          ],
        },
      ],
    },
  },
  {
    files: ['apps/api/src/**/*.ts'],
    ignores: ['apps/api/src/systemDb.ts', 'apps/api/src/jobs/**', 'apps/api/src/**/*.test.ts', 'apps/api/src/test/**'],
    rules: {
      'no-restricted-imports': [
        'error',
        {
          patterns: [
            { group: ['**/systemDb', '**/systemDb.ts'], message: 'systemDb (service role) is for jobs and system tasks only, not for the request adapter.' },
            // The API takes from the web app only its pure help engine (DECISIONS: help on the server).
            { regex: '^@/(?!shared/help/|features/ai/redact$)', message: 'The API imports from the web app only the help engine.' },
            { group: ['**/apps/web/**', '@mig/web', '@mig/web/*'], message: 'The API imports from the web app only the help engine (by the @/ alias).' },
          ],
        },
      ],
    },
  },
  {
    // Privileged access is forbidden in route handlers, services and the request adapter (docs/PRIVILEGED_AUDIT.md).
    files: ['packages/domain/src/**/*.ts', 'apps/api/src/**/*.ts'],
    ignores: ['**/*.test.ts', 'apps/api/src/test/**', ...PRIVILEGED_ALLOWLIST],
    rules: { 'no-restricted-syntax': ['error', ...htmlSinks, srcDocSink, ...privilegedCalls, ...systemSession] },
  },
  {
    // The request adapter builds the system repositories of sign-in and of the partner API (no person of RLS); it
    // never takes privileged repositories or groups for a person's request.
    files: ['apps/api/src/app.ts'],
    rules: { 'no-restricted-syntax': ['error', ...htmlSinks, srcDocSink, ...privilegedCalls] },
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
