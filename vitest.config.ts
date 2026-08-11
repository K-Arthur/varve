import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { defineConfig } from 'vitest/config';

const __dirname = dirname(fileURLToPath(import.meta.url));

// Root Vitest config. Per-file environment override via:
//   // @vitest-environment jsdom
// at the top of a test file when DOM is needed.
//
// Vitest 4 removed `environmentMatchGlobs`; the same routing is expressed
// with `projects`. NOTE: `extends: true` merges project arrays with the root
// config (include concatenates), so the jsdom project is defined WITHOUT
// extends and re-declares everything it needs explicitly; the node project
// uses extends because its include/exclude are the root ones plus the jsdom
// scoping. Coverage stays root-only.
const JS_DOM_INCLUDE = [
  'packages/ui/src/components/**/*.{test,spec}.{ts,tsx}',
  'packages/editor/src/**/*.{test,spec}.{ts,tsx}',
  'packages/home/src/**/*.{test,spec}.{ts,tsx}',
];

const INCLUDE = [
  'packages/**/src/**/*.{test,spec}.{ts,tsx}',
  'apps/**/src/**/*.{test,spec}.{ts,tsx}',
  'tests/**/*.{test,spec}.{ts,tsx}',
];

const EXCLUDE = [
  'tests/e2e/**',
  '**/node_modules/**',
  '**/.worktrees/**',
  '**/__tests__/parity.test.ts',
  '**/*.bench.ts',
];

export default defineConfig({
  optimizeDeps: {
    exclude: ['fast-check'],
  },
  plugins: [
    {
      name: 'mock-optional-deps',
      resolveId(source) {
        if (source === 'onnxruntime-web' || source === '@tauri-apps/api/core') {
          return join(__dirname, 'vitest.mocks.ts');
        }
      },
    },
  ],
  resolve: {
    alias: {},
  },
  test: {
    server: {
      deps: {
        inline: ['@varve/engine'],
      },
    },
    setupFiles: ['./vitest.setup.ts'],
    include: INCLUDE,
    exclude: EXCLUDE,
    // `vitest bench` does NOT read `test.include`/`test.exclude` — it reads
    // `test.benchmark.*`, whose defaults exclude only node_modules/dist/.git.
    // Without this block a `pnpm bench` run discovers every `.bench.ts` inside
    // `.worktrees/`, so another agent's checkout both contaminates the numbers
    // and multiplies the forked workers (measured 2026-08-07: 90 files
    // discovered, 81 of them under `.worktrees`). Keep in sync with the
    // `test.exclude` worktree guard above. Guarded by
    // `tests/unit/benchDiscovery.test.ts`.
    benchmark: {
      include: ['packages/**/src/**/*.bench.{ts,tsx}'],
      exclude: ['**/node_modules/**', '**/dist/**', '**/.worktrees/**'],
    },
    environment: 'node',
    // Vitest 4 replaces `environmentMatchGlobs` with projects. The jsdom
    // project scopes the DOM-heavy packages; the node project excludes them
    // so every test file runs in exactly one project (per-file
    // `@vitest-environment` annotations keep working within both).
    projects: [
      {
        // Standalone (no extends): with `extends: true` the root `include`
        // concatenates into this project, which would route every package's
        // tests through jsdom. Re-declare the shared options explicitly.
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: ['./vitest.setup.ts'],
          server: {
            deps: {
              inline: ['@varve/engine'],
            },
          },
          include: JS_DOM_INCLUDE,
          exclude: EXCLUDE,
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: INCLUDE,
          exclude: [...EXCLUDE, ...JS_DOM_INCLUDE],
        },
      },
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
