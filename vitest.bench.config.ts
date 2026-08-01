import { defineConfig } from 'vitest/config';
import baseConfig from './vitest.config';

// Dedicated bench config. The main config excludes `**/*.bench.ts` so bench
// files never run inside `pnpm test` (AGENTS.md: "excludes .bench.ts — run
// separately"). But the repo's bench files use `it()`/`describe()` (they run
// as ordinary tests and write .render-perf-results.json), so `vitest run`
// with the main config matches zero files ("No test files found"). This
// config re-includes bench files so the perf gate and `pnpm bench:canvas`
// actually run them.
export default defineConfig({
  ...baseConfig,
  test: {
    ...baseConfig.test,
    include: [
      ...(baseConfig.test?.include ?? []),
      'packages/**/src/**/*.bench.{ts,tsx}',
      'packages/**/src/**/__benchmarks__/**/*.{ts,tsx}',
      'packages/**/bench/**/*.{ts,tsx}',
      'packages/engine/src/bench/**/*.{ts,tsx}',
    ],
    exclude: [
      ...(baseConfig.test?.exclude ?? []).filter((p) => p !== '**/*.bench.ts'),
      'tests/e2e/**',
      '**/node_modules/**',
      '**/__tests__/parity.test.ts',
    ],
  },
});
