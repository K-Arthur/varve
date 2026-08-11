import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Dedicated bench config. The main config excludes `**/*.bench.ts` so bench
// files never run inside `pnpm test` (AGENTS.md: "excludes .bench.ts — run
// separately"). But some repo bench files use `it()`/`describe()` (they run
// as ordinary tests and write .render-perf-results.json), so `vitest run`
// with the main config matches zero files ("No test files found"). This
// config re-includes bench files so the perf gate and `pnpm bench:canvas`
// actually run them. Workspace checkouts remain excluded through the base
// config so a local worktree cannot contaminate benchmark discovery/results.
//
// The base config routes jsdom-heavy packages through the `jsdom` project;
// this config re-adds the bench globs to that project's include (editor
// benches previously ran under jsdom via environmentMatchGlobs) and keeps
// the node project's exclude aligned (the jsdom scoping applies
// unconstrained by the `{test,spec}` suffix so bench files under those
// packages stay out of the node project too).
const base = baseConfig;
const baseTest = base.test ?? {};

const benchInclude = [
  'packages/**/src/**/*.bench.{ts,tsx}',
  'packages/**/src/**/__benchmarks__/**/*.{ts,tsx}',
  'packages/**/bench/**/*.{ts,tsx}',
  'packages/engine/src/bench/**/*.{ts,tsx}',
];

const jsDomProject = baseTest.projects?.find(
  (p) => typeof p === 'object' && p?.test?.name === 'jsdom',
);
const jsDomInclude = Array.isArray(jsDomProject) ? [] : (jsDomProject?.test?.include ?? []);
const jsDomExclude = Array.isArray(jsDomProject) ? [] : (jsDomProject?.test?.exclude ?? []);
const jsDomSetupFiles = Array.isArray(jsDomProject) ? [] : (jsDomProject?.test?.setupFiles ?? []);
const jsDomServer = Array.isArray(jsDomProject) ? {} : (jsDomProject?.test?.server ?? {});

const nodeProject = baseTest.projects?.find(
  (p) => typeof p === 'object' && p?.test?.name === 'node',
);
const nodeExclude = Array.isArray(nodeProject) ? [] : (nodeProject?.test?.exclude ?? []);
const nodeInclude = Array.isArray(nodeProject) ? [] : (nodeProject?.test?.include ?? []);

// jsdom-scoped packages, unconstrained by `{test,spec}` so bench files under
// them are also excluded from the node project.
const JS_DOM_SCOPES_UNCONSTRAINED = [
  'packages/ui/src/components/**',
  'packages/editor/**',
  'packages/home/**',
];

export default defineConfig({
  ...base,
  test: {
    ...baseTest,
    include: [...(baseTest.include ?? []), ...benchInclude],
    exclude: [
      ...(baseTest.exclude ?? []).filter((p) => p !== '**/*.bench.ts'),
      'tests/e2e/**',
      '**/node_modules/**',
      '**/__tests__/parity.test.ts',
    ],
    projects: [
      {
        // Standalone, mirroring the main config's jsdom project (see
        // vitest.config.ts for why `extends` is avoided there).
        test: {
          name: 'jsdom',
          environment: 'jsdom',
          setupFiles: jsDomSetupFiles,
          server: jsDomServer,
          include: [...jsDomInclude, ...benchInclude],
          exclude: jsDomExclude.filter((p) => p !== '**/*.bench.ts'),
        },
      },
      {
        extends: true,
        test: {
          name: 'node',
          environment: 'node',
          include: [...nodeInclude, ...benchInclude],
          exclude: [
            ...nodeExclude.filter(
              (p) => !JS_DOM_SCOPES_UNCONSTRAINED.includes(p) && p !== '**/*.bench.ts',
            ),
            ...JS_DOM_SCOPES_UNCONSTRAINED,
          ],
        },
      },
    ],
  },
});
