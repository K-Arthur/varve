#!/usr/bin/env node

/** Execute the concrete lanes selected by the canonical CI plan. */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { delimiter, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';
import { loadPackages } from './affected-plan.mjs';
import { validateCiPlan } from './ci-plan.mjs';
import { laneArgv, packageDirs } from './validation-lanes.mjs';
import { CI_CATEGORIES, computePolicyHash } from './validation-policy.mjs';

const ROOT = process.cwd();
for (const [name, packageInfo] of Object.entries(loadPackages()))
  packageDirs[name] = packageInfo.dir;

function parseArgs(args) {
  const flags = { plan: null, category: null, profile: 'integration', dryRun: false, shard: null };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--plan') flags.plan = args[++index];
    else if (args[index] === '--category') flags.category = args[++index];
    else if (args[index] === '--profile') flags.profile = args[++index];
    else if (args[index] === '--shard') flags.shard = args[++index];
    else if (args[index] === '--dry-run') flags.dryRun = true;
  }
  return flags;
}

function commandEnvironment() {
  const pathEntries = [
    join(ROOT, 'node_modules', '.bin'),
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, 'bin') : null,
    process.env.HOME ? join(process.env.HOME, '.local', 'share', 'pnpm', 'bin') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'pnpm') : null,
    process.env.PATH ?? '',
  ].filter(Boolean);
  return { cwd: ROOT, env: { ...process.env, PATH: pathEntries.join(delimiter) }, shell: false };
}

function checkedOutHead() {
  const result = spawnSync('git', ['rev-parse', '--verify', 'HEAD^{commit}'], {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) throw new Error('cannot resolve the checked-out commit SHA');
  return result.stdout.trim();
}

function describe(argv) {
  return argv.map((part) => JSON.stringify(part)).join(' ');
}

function pathsForDomain(domain) {
  const paths = IMPACT_CONFIG.e2eDomains[domain] ?? [`tests/e2e/${domain}`];
  return paths.map((path) => path.replace(/\/\*\*$/, ''));
}

function e2eArgv(lane, shard) {
  if (lane === 'e2e:all') {
    const argv = ['pnpm', 'exec', 'playwright', 'test', '--project=chromium'];
    if (shard) argv.push('--shard', shard);
    return argv;
  }
  if (lane.startsWith('e2e:file:')) {
    return [
      'pnpm',
      'exec',
      'playwright',
      'test',
      lane.slice('e2e:file:'.length),
      '--project=chromium',
    ];
  }
  if (lane.startsWith('e2e:')) {
    return [
      'pnpm',
      'exec',
      'playwright',
      'test',
      ...pathsForDomain(lane.slice('e2e:'.length)),
      '--project=chromium',
    ];
  }
  return null;
}

function lanesForCategory(plan, category) {
  if (!CI_CATEGORIES.includes(category)) throw new Error(`unknown CI category '${category}'`);
  const selected = new Set(plan.selectedLanes ?? []);
  if (category === 'pipeline') return ['pipeline-validate'];
  if (category === 'js') {
    return [...selected].filter(
      (lane) =>
        lane.startsWith('js-unit:') ||
        (lane.startsWith('typecheck:') && lane !== 'typecheck:e2e') ||
        lane === 'typecheck:all' ||
        lane === 'lint:all' ||
        lane === 'audit:tokens',
    );
  }
  if (category === 'rust')
    return [...selected].filter(
      (lane) =>
        lane.startsWith('rust-test:') || lane.startsWith('rust-clippy:') || lane === 'cargo-fmt',
    );
  if (category === 'website')
    return [...selected].filter((lane) => lane === 'website-unit' || lane === 'website-e2e');
  if (category === 'e2e')
    return [...selected].filter((lane) => lane.startsWith('e2e:') && lane !== 'e2e:visual');
  if (category === 'visual') return [...selected].filter((lane) => lane === 'e2e:visual');
  if (category === 'desktop') return [...selected].filter((lane) => lane === 'desktop-native');
  if (category === 'models') return [...selected].filter((lane) => lane === 'models');
  if (category === 'bench') return [...selected].filter((lane) => lane.startsWith('bench:'));
  return [...selected].filter((lane) => lane === 'wasm');
}

export function commandsForCategory(plan, category, { shard = null } = {}) {
  const lanes = lanesForCategory(plan, category);
  const commands = [];
  for (const lane of lanes) {
    const argv = e2eArgv(lane, shard) ?? laneArgv(lane, { files: plan.files ?? [] });
    if (!argv) throw new Error(`no executable command for selected ${category} lane '${lane}'`);
    commands.push({ lane, argv });
  }
  if (commands.length === 0) {
    throw new Error(`category '${category}' was selected but its CI plan has no executable lanes`);
  }
  return commands;
}

export function runCategory(
  plan,
  category,
  { execute = runCommand, shard = null, dryRun = false } = {},
) {
  for (const { lane, argv } of commandsForCategory(plan, category, { shard })) {
    console.log(`CI ${category}: ${lane}`);
    const status = execute(argv, { dryRun, timeoutMs: 45 * 60 * 1000 });
    const code = typeof status === 'number' ? status : (status?.status ?? 1);
    if (code !== 0) return code;
  }
  return 0;
}

function runCommand(argv, { dryRun = false, timeoutMs = 45 * 60 * 1000 } = {}) {
  console.log(`    $ ${describe(argv)}`);
  if (dryRun) return 0;
  const result = spawnSync(argv[0], argv.slice(1), {
    ...commandEnvironment(),
    stdio: 'inherit',
    timeout: timeoutMs,
  });
  if (result.error) {
    const reason =
      result.error.code === 'ETIMEDOUT'
        ? `timeout after ${timeoutMs / 1000}s`
        : result.error.message;
    console.error(
      `    command failed: ${reason}; resources: ${availableParallelism()} CPUs, ${Math.round(freemem() / 1024 / 1024)} MiB free / ${Math.round(totalmem() / 1024 / 1024)} MiB total`,
    );
    return 1;
  }
  if (result.signal) return 1;
  return result.status ?? 1;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.plan || !flags.category)
    throw new Error(
      'usage: ci-run-lanes.mjs --plan <ci-plan.json> --category <category> [--shard N/8]',
    );
  const plan = JSON.parse(readFileSync(flags.plan, 'utf8'));
  const identityErrors = validateCiPlan(plan, {
    expectedHead: checkedOutHead(),
    expectedPolicyHash: computePolicyHash({ root: ROOT }),
  });
  if (identityErrors.length)
    throw new Error(`CI plan identity check failed: ${identityErrors.join('; ')}`);
  if (plan.profile && flags.profile !== plan.profile && flags.profile !== 'integration')
    throw new Error(`plan profile ${plan.profile} does not match requested ${flags.profile}`);
  const status = runCategory(plan, flags.category, {
    shard: flags.shard,
    dryRun: flags.dryRun,
  });
  process.exitCode = status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`CI lane execution failed: ${error.message}`);
    process.exitCode = 1;
  }
}

export { e2eArgv, lanesForCategory, parseArgs };
