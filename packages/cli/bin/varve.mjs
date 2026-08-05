#!/usr/bin/env node
import { spawnSync } from 'node:child_process';
import { mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
/**
 * Self-bundling launcher for the headless Varve CLI.
 *
 * The workspace packages are TypeScript with bundler-style resolution, so
 * the CLI is bundled on first run with esbuild and executed as a single
 * self-contained ESM file. Deterministic, no build step, no network.
 */
import { buildSync } from 'esbuild';

const entry = fileURLToPath(new URL('../src/cli.ts', import.meta.url));
const dir = mkdtempSync(join(tmpdir(), 'varve-cli-'));
const outfile = join(dir, 'cli.mjs');

let buildResult;
try {
  buildResult = buildSync({
    entryPoints: [entry],
    bundle: true,
    platform: 'node',
    format: 'esm',
    target: 'node20',
    outfile,
    logLevel: 'error',
    legalComments: 'none',
  });
} catch (err) {
  process.stderr.write(
    `varve: bundle failed: ${err instanceof Error ? err.message : String(err)}\n`,
  );
  process.exit(2);
}
if (buildResult.errors.length > 0) {
  for (const error of buildResult.errors) process.stderr.write(`${error.text}\n`);
  process.exit(2);
}

const run = spawnSync(process.execPath, [outfile, ...process.argv.slice(2)], {
  stdio: 'inherit',
});
try {
  rmSync(dir, { recursive: true, force: true });
} catch {
  // best effort cleanup
}
process.exit(run.status ?? 1);
