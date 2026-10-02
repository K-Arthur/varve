#!/usr/bin/env node

/**
 * Run Cargo with the desktop's non-packaging validation configuration.
 *
 * The workspace's upstream bindgen backport handles Clang compatibility with
 * genuine system headers. Preserve caller-supplied Clang flags unchanged.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const cargoEnv = { ...process.env };
if (['check', 'clippy', 'test'].includes(process.argv[2])) {
  // These commands compile the desktop crate without packaging it. Keep the
  // production bundle's release-helper requirement for `tauri build` only.
  const config = process.env.TAURI_CONFIG ? JSON.parse(process.env.TAURI_CONFIG) : {};
  cargoEnv.TAURI_CONFIG = JSON.stringify({
    ...config,
    bundle: { ...config.bundle, resources: [] },
  });
}
const result = spawnSync('cargo', process.argv.slice(2), {
  cwd: repositoryRoot,
  env: cargoEnv,
  stdio: 'inherit',
});

if (result.error) {
  console.error(`Unable to execute cargo: ${result.error.message}`);
  process.exit(1);
}
process.exit(result.status ?? 1);
