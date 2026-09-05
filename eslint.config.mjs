import nextCoreWebVitals from 'eslint-config-next/core-web-vitals';
import nextTypeScript from 'eslint-config-next/typescript';
import prettier from 'eslint-config-prettier';

/**
 * Flat config, composed by importing the shared configs directly.
 *
 * Not routed through `FlatCompat`: `eslint-config-next` already exports flat
 * config arrays, so wrapping them in the eslintrc compatibility layer re-runs
 * them through legacy schema validation, which fails on the plugin object
 * graph and surfaces as "Converting circular structure to JSON" — an error
 * that names neither the config nor the rule responsible.
 */
const config = [
  {
    ignores: [
      'node_modules/**',
      '.next/**',
      'out/**',
      'coverage/**',
      'playwright-report/**',
      'test-results/**',
      'screenshots/**',
      'next-env.d.ts',
    ],
  },

  ...nextCoreWebVitals,
  ...nextTypeScript,
  prettier,

  {
    rules: {
      '@typescript-eslint/no-explicit-any': 'error',
      '@typescript-eslint/no-unused-vars': [
        'error',
        { argsIgnorePattern: '^_', varsIgnorePattern: '^_', caughtErrorsIgnorePattern: '^_' },
      ],
      '@typescript-eslint/consistent-type-imports': ['error', { prefer: 'type-imports' }],
      'no-console': 'error',
      eqeqeq: ['error', 'always', { null: 'ignore' }],
    },
  },

  {
    // Tests may log; a failing assertion is often clearer with context.
    files: ['tests/**/*.ts', 'tests/**/*.tsx'],
    rules: { 'no-console': 'off' },
  },
];

export default config;
