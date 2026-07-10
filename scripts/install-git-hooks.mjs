#!/usr/bin/env node
/**
 * Install Strata git hooks from .github/hooks into .git/hooks.
 *
 * Runs automatically during pnpm install via the `prepare` script.
 * Skips installation in CI environments.
 */
import { chmodSync, copyFileSync, mkdirSync, readdirSync, statSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));
const repoRoot = join(__dirname, '..');
const sourceDir = join(repoRoot, '.github', 'hooks');
const targetDir = join(repoRoot, '.git', 'hooks');

if (process.env.CI || process.env.NODE_ENV === 'ci') {
  console.log('install-git-hooks: skipping in CI');
  process.exit(0);
}

function install(name) {
  const source = join(sourceDir, name);
  const target = join(targetDir, name);

  try {
    statSync(source);
  } catch {
    return;
  }

  mkdirSync(targetDir, { recursive: true });
  copyFileSync(source, target);
  chmodSync(target, 0o755);
  console.log(`install-git-hooks: installed ${target}`);
}

const hooks = readdirSync(sourceDir);
for (const hook of hooks) {
  if (!hook.includes('.')) {
    install(hook);
  }
}
