#!/usr/bin/env node

/** Execute only the fast, exact-SHA preflight lanes selected by ci-plan. */

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync } from 'node:fs';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { loadPackages } from './affected-plan.mjs';
import { laneArgv, packageDirs } from './validation-lanes.mjs';

const ROOT = process.cwd();
for (const [name, packageInfo] of Object.entries(loadPackages()))
  packageDirs[name] = packageInfo.dir;

function chunks(values, size) {
  const output = [];
  for (let index = 0; index < values.length; index += size)
    output.push(values.slice(index, index + size));
  return output;
}

function run(argv) {
  console.log(`$ ${argv.map((part) => JSON.stringify(part)).join(' ')}`);
  const envPath = [join(ROOT, 'node_modules', '.bin'), process.env.PATH ?? ''].join(delimiter);
  const result = spawnSync(argv[0], argv.slice(1), {
    cwd: ROOT,
    env: { ...process.env, PATH: envPath },
    shell: false,
    stdio: 'inherit',
  });
  if (result.error) throw result.error;
  if (result.status !== 0) process.exit(result.status ?? 1);
}

export function preflightCommands(plan, { root = ROOT } = {}) {
  const files = (plan?.files ?? []).filter(
    (file) => existsSync(join(root, file)) && /\.(ts|tsx|js|jsx|mjs|cjs|json|css)$/.test(file),
  );
  const commands = [];
  for (const group of chunks(files, 80)) {
    commands.push([
      'pnpm',
      'exec',
      'biome',
      'format',
      '--check',
      '--no-errors-on-unmatched',
      ...group,
    ]);
    commands.push(['pnpm', 'exec', 'biome', 'check', '--no-errors-on-unmatched', ...group]);
  }

  const lanes = [...(plan?.plan?.tiers?.[1] ?? []), ...(plan?.plan?.tiers?.[2] ?? [])].filter(
    (lane) => (lane === 'typecheck:e2e' || lane.startsWith('typecheck:')) && !lane.endsWith(':all'),
  );
  for (const lane of [...new Set(lanes)].sort()) {
    const argv = laneArgv(lane, { files: plan.files ?? [] });
    if (!argv) throw new Error(`no executable preflight command for ${lane}`);
    commands.push(argv);
  }
  return commands;
}

function main() {
  const args = process.argv.slice(2);
  const index = args.indexOf('--plan');
  if (index === -1 || !args[index + 1])
    throw new Error('usage: ci-preflight.mjs --plan <ci-plan.json>');
  const plan = JSON.parse(readFileSync(args[index + 1], 'utf8'));
  const commands = preflightCommands(plan);
  if (commands.length === 0) {
    console.log('CI fast preflight: no changed processable files or affected typechecks.');
    return;
  }
  for (const command of commands) run(command);
  console.log(`CI fast preflight passed (${commands.length} command(s)).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`CI fast preflight failed: ${error.message}`);
    process.exitCode = 1;
  }
}
