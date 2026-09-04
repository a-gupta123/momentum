import { defineConfig } from 'vitest/config';

/**
 * Unit tests target framework-independent domain code, so the default
 * environment is plain Node. `resolve.tsconfigPaths` picks up the `@/*` alias
 * straight from `tsconfig.json`, keeping one source of truth for module paths.
 */
export default defineConfig({
  resolve: {
    tsconfigPaths: true,
  },
  test: {
    environment: 'node',
    include: ['tests/unit/**/*.test.ts'],
    globals: true,
    coverage: {
      provider: 'v8',
      include: [
        'lib/domain/**',
        'lib/dates/**',
        'lib/validation/**',
        'lib/repositories/local.ts',
        'lib/ai/fallback-parser.ts',
      ],
      reporter: ['text', 'lcov'],
    },
  },
});
