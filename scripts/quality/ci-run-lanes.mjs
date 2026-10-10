#!/usr/bin/env node

/** Execute the concrete lanes selected by the canonical CI plan. */

import { spawnSync } from 'node:child_process';
import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { delimiter, dirname, join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';
import { demoDistInputs } from '../website/demo-dist-validation.mjs';
import { loadPackages } from './affected-plan.mjs';
import { discoverBrowserInventory } from './browser-inventory.mjs';
import {
  browserEvidenceErrors,
  browserLane,
  collectBrowserEvidence,
  createExecutionReport,
  writeExecutionReport,
} from './ci-execution-report.mjs';
import { validateCiPlan } from './ci-plan.mjs';
import { playwrightRunOptions } from './execution-plan.mjs';
import { laneArgv, packageDirs } from './validation-lanes.mjs';
import { CI_CATEGORIES, computePolicyHash } from './validation-policy.mjs';

const ROOT = process.cwd();
for (const [name, packageInfo] of Object.entries(loadPackages()))
  packageDirs[name] = packageInfo.dir;

function parseArgs(args) {
  const flags = {
    plan: null,
    category: null,
    profile: 'integration',
    dryRun: false,
    shard: null,
    report: null,
    matrix: null,
  };
  for (let index = 0; index < args.length; index += 1) {
    if (args[index] === '--plan') flags.plan = args[++index];
    else if (args[index] === '--category') flags.category = args[++index];
    else if (args[index] === '--profile') flags.profile = args[++index];
    else if (args[index] === '--shard') flags.shard = args[++index];
    else if (args[index] === '--report') flags.report = args[++index];
    else if (args[index] === '--matrix') flags.matrix = args[++index];
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
    const selectedFile = lane.slice('e2e:file:'.length).replaceAll('\\', '/');
    if (IMPACT_CONFIG.demoDistE2eOwners.includes(selectedFile))
      throw new Error(`${selectedFile} requires the dedicated e2e:demo-dist lane`);
    const argv = ['pnpm', 'exec', 'playwright', 'test', selectedFile, '--project=chromium'];
    // A file/domain lane still runs inside the sharded matrix cell. Passing the
    // cell's shard keeps the execution receipt's shard identity equal to the
    // browser evidence (the aggregator compares them); omitting it made every
    // green file-lane cell uncertifiable.
    if (shard) argv.push('--shard', shard);
    return argv;
  }
  if (lane === 'e2e:demo-dist')
    return ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.demo-dist.config.mts'];
  if (lane.startsWith('e2e:')) {
    const argv = [
      'pnpm',
      'exec',
      'playwright',
      'test',
      ...pathsForDomain(lane.slice('e2e:'.length)),
      '--project=chromium',
    ];
    if (shard) argv.push('--shard', shard);
    return argv;
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
  if (category === 'e2e') {
    const lanes = [...selected].filter(
      (lane) => lane === 'typecheck:e2e' || (lane.startsWith('e2e:') && lane !== 'e2e:visual'),
    );
    lanes.sort((left, right) => {
      if (left === 'typecheck:e2e') return -1;
      if (right === 'typecheck:e2e') return 1;
      return left.localeCompare(right);
    });
    return lanes;
  }
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
    // The production-demo owners form one complete unsharded inventory. Run
    // that full lane once in the first cell of a broad matrix; other cells
    // still certify their assigned e2e:all cases.
    if (lane === 'e2e:demo-dist' && shard && Number(shard.split('/')[0]) !== 1) continue;
    // Playwright cells are sharded; the e2e compiler is not. Run it once with
    // the first cell so later shards do not pay for the same tsc and so the
    // union of receipts still covers the selected lane.
    if (lane === 'typecheck:e2e' && shard && Number(shard.split('/')[0]) !== 1) continue;
    const argv = e2eArgv(lane, shard) ?? laneArgv(lane, { files: plan.files ?? [] });
    if (!argv) throw new Error(`no executable command for selected ${category} lane '${lane}'`);
    if (lane.startsWith('e2e:') || lane === 'website-e2e')
      argv.push(...playwrightRunOptions({ strict: true }));
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
  {
    execute,
    shard = null,
    dryRun = false,
    browserReportDir = null,
    discover = discoverBrowserInventory,
  } = {},
) {
  return runCategoryDetailed(plan, category, { execute, shard, dryRun, browserReportDir, discover })
    .status;
}

export function runCategoryDetailed(
  plan,
  category,
  {
    execute,
    shard = null,
    dryRun = false,
    browserReportDir = null,
    discover = discoverBrowserInventory,
  } = {},
) {
  if (typeof execute !== 'function')
    throw new TypeError('CI lane execution requires an explicitly selected command runner');
  const outcomes = [];
  const browserReports = [];
  let browserEvidence = collectBrowserEvidence([]);
  let categoryStatus = 0;
  for (const { lane, argv } of commandsForCategory(plan, category, { shard })) {
    console.log(`CI ${category}: ${lane}`);
    const startedAt = Date.now();
    const browserReportPath =
      browserReportDir && browserLane(lane)
        ? lane === 'e2e:demo-dist'
          ? demoDistInputs(process.env, ROOT).report
          : join(browserReportDir, `${process.pid}-${category}-${outcomes.length}.json`)
        : null;
    if (browserReportPath) {
      mkdirSync(dirname(browserReportPath), { recursive: true });
      if (existsSync(browserReportPath)) throw new Error('browser report output already exists');
      const inventoryArgv =
        lane === 'website-e2e'
          ? ['pnpm', 'exec', 'playwright', 'test', '--config', 'playwright.website.config.ts']
          : argv;
      const source =
        lane === 'e2e:demo-dist'
          ? JSON.parse(readFileSync(process.env.VARVE_DEMO_INPUT_RECEIPT, 'utf8')).validationSource
          : plan;
      const inventory = discover({ argv: inventoryArgv, lane, source, root: ROOT });
      const inventoryPath = `${browserReportPath}.inventory.json`;
      writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
      browserReports.push({
        lane,
        path: browserReportPath,
        inventory,
        ...(lane === 'e2e:demo-dist' && shard ? { executionShard: String(shard) } : {}),
      });
    }
    const status = execute(argv, { dryRun, browserReportPath, timeoutMs: 45 * 60 * 1000 });
    let code = typeof status === 'number' ? status : (status?.status ?? 1);
    if (browserReportPath) {
      if (lane === 'e2e:demo-dist' && !dryRun) {
        for (const command of ['verify-report', 'assert-unchanged']) {
          const audit = execute(
            [process.execPath, 'scripts/website/demo-dist-validation.mjs', command],
            { browserReportPath, timeoutMs: 45 * 60 * 1000 },
          );
          const auditCode = typeof audit === 'number' ? audit : (audit?.status ?? 1);
          if (auditCode !== 0) code = code || auditCode;
        }
        const artifactInventory = join(dirname(browserReportPath), 'browser-inventory.json');
        if (existsSync(artifactInventory)) {
          const inventory = JSON.parse(readFileSync(artifactInventory, 'utf8'));
          const inventoryPath = `${browserReportPath}.inventory.json`;
          writeFileSync(inventoryPath, `${JSON.stringify(inventory, null, 2)}\n`);
          const descriptor = browserReports.find((browser) => browser.lane === lane);
          if (descriptor) descriptor.inventory = inventory;
        }
      }
      browserEvidence = collectBrowserEvidence(browserReports, { root: ROOT });
      if (browserEvidenceErrors(browserEvidence, [lane]).length) code = code || 1;
    }
    outcomes.push({
      lane,
      argv,
      status: code === 0 ? 'success' : 'failure',
      exitCode: typeof status === 'number' ? status : (status?.status ?? code),
      signal: typeof status === 'number' ? null : (status?.signal ?? null),
      timedOut: typeof status === 'number' ? false : status?.timedOut === true,
      durationMs: Date.now() - startedAt,
    });
    // Selected lanes are independent validation evidence. Keep running later
    // lanes after a failure so a failed app E2E shard does not suppress the
    // separately-built production demo's report.
    if (code !== 0 && categoryStatus === 0) categoryStatus = code;
  }
  return { status: categoryStatus, outcomes, browserEvidence };
}

function createCommandExecutor(spawnCommand) {
  return function runCommand(
    argv,
    { dryRun = false, browserReportPath = null, timeoutMs = 45 * 60 * 1000 } = {},
  ) {
    console.log(`    $ ${describe(argv)}`);
    if (dryRun) return 0;
    const environment = commandEnvironment();
    if (browserReportPath) environment.env.VARVE_CI_PLAYWRIGHT_REPORT = browserReportPath;
    const result = spawnCommand(argv, {
      ...environment,
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
      return { status: 1, timedOut: result.error.code === 'ETIMEDOUT' };
    }
    if (result.signal) return { status: 1, signal: result.signal };
    return { status: result.status ?? 1 };
  };
}

/**
 * Select the smallest command runner needed by a lane category. Rust lanes
 * invoke only native `node` and `cargo` executables, so they do not require the
 * pnpm-installed cross-spawn adapter. Other categories retain the validated
 * Windows shim handling from heavy-lease.
 */
export async function commandExecutorForCategory(
  category,
  { dryRun = false, loadSecureRunner = () => import('./heavy-lease.mjs') } = {},
) {
  if (dryRun) return createCommandExecutor(() => ({ status: 0 }));
  if (category === 'rust') {
    return createCommandExecutor((argv, options) => {
      if (!['node', 'cargo'].includes(argv[0]))
        throw new Error(`Rust lane attempted a non-native command '${argv[0]}'`);
      return spawnSync(argv[0], argv.slice(1), { ...options, shell: false });
    });
  }
  const { spawnValidationCommandSync } = await loadSecureRunner();
  return createCommandExecutor((argv, options) => spawnValidationCommandSync(argv, options));
}

async function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (!flags.plan || !flags.category)
    throw new Error(
      'usage: ci-run-lanes.mjs --plan <ci-plan.json> --category <category> [--shard N/count]',
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
  const execute = await commandExecutorForCategory(flags.category, { dryRun: flags.dryRun });
  const startedAt = Date.now();
  const result = runCategoryDetailed(plan, flags.category, {
    execute,
    shard: flags.shard,
    dryRun: flags.dryRun,
    browserReportDir: flags.dryRun
      ? null
      : join(
          'test-results',
          `ci-browser-${process.env.GITHUB_RUN_ID ?? 'local'}-${process.env.GITHUB_RUN_ATTEMPT ?? '1'}`,
        ),
  });
  if (flags.report) {
    const report = createExecutionReport({
      plan,
      category: flags.category,
      profile: flags.profile,
      status: result.status === 0 ? 'success' : 'failure',
      laneOutcomes: result.outcomes,
      browserEvidence: result.browserEvidence,
      shard: flags.shard,
      matrix: flags.matrix,
      durationMs: Date.now() - startedAt,
    });
    writeExecutionReport(report, flags.report);
  }
  process.exitCode = result.status;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`CI lane execution failed: ${error.message}`);
    process.exitCode = 1;
  });
}

export { e2eArgv, lanesForCategory, parseArgs };
