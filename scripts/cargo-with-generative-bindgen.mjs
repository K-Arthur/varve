#!/usr/bin/env node

/**
 * Run Cargo with the bindgen compatibility flags required by the optional
 * native generative helper.
 *
 * diffusion-rs-sys binds glibc's private FILE layout. On current Linux
 * toolchains that layout is intentionally opaque, so bindgen must see the
 * repository-owned stdio shim. The desktop helper build already supplies
 * these flags; keeping them here makes local validation and CI use the same
 * reproducible configuration without changing Cargo's global environment.
 */
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const repositoryRoot = fileURLToPath(new URL('..', import.meta.url));
const bindgenShim = path.join(
  repositoryRoot,
  'crates',
  'varve-generative-helper',
  'bindgen-stdio-shim.h',
);
const existingBindgenArgs = process.env.BINDGEN_EXTRA_CLANG_ARGS?.trim();
const linuxBindgenArgs =
  process.platform === 'linux' ? ['-D_STDIO_H', `-include${bindgenShim}`] : [];
const cargoEnv = {
  ...process.env,
  BINDGEN_EXTRA_CLANG_ARGS: [existingBindgenArgs, ...linuxBindgenArgs].filter(Boolean).join(' '),
};
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
