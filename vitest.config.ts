import { defineConfig } from 'vitest/config';

// Root Vitest config. Per-file environment override via:
//   // @vitest-environment jsdom
// at the top of a test file when DOM is needed.
export default defineConfig({
  test: {
    setupFiles: ['./vitest.setup.ts'],
    include: [
      'packages/**/src/**/*.{test,spec}.{ts,tsx}',
      'apps/**/src/**/*.{test,spec}.{ts,tsx}',
      'tests/**/*.{test,spec}.{ts,tsx}',
    ],
    exclude: ['tests/e2e/**', '**/node_modules/**'],
    environment: 'node',
    environmentMatchGlobs: [
      ['packages/ui/src/components/**', 'jsdom'],
      ['packages/editor/**', 'jsdom'],
      ['packages/home/**', 'jsdom'],
    ],
    coverage: {
      provider: 'v8',
      reporter: ['text', 'html'],
      include: ['packages/*/src/**'],
      exclude: ['**/*.test.*', '**/*.spec.*', '**/dist/**'],
      thresholds: {
        perFile: true,
        statements: 80,
        branches: 70,
        functions: 80,
        lines: 80,
      },
    },
  },
});
