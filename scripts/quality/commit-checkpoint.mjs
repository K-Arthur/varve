#!/usr/bin/env node

/**
 * Bounded staged-work checkpoint used by the pre-commit adapter.
 *
 * This deliberately knows only about the index.  It does not run browser,
 * visual, native, benchmark, release, or workspace-wide test suites.  The
 * push driver owns exact outgoing-ref validation; this driver owns the cheap
 * commit boundary.
 */

import { spawnSync } from 'node:child_process';
import { existsSync } from 'node:fs';
import { availableParallelism, freemem, totalmem } from 'node:os';
import { delimiter, join } from 'node:path';

const ROOT = process.cwd();
const DEFAULT_TIMEOUT_MS = 120_000;
const DIRECT_TEST_TIMEOUT_MS = 180_000;
const DIRECT_TEST_GROUP_SIZE = 8;

function commandEnvironment() {
  const pathEntries = [
    join(ROOT, 'node_modules', '.bin'),
    process.env.PNPM_HOME ? join(process.env.PNPM_HOME, 'bin') : null,
    process.env.HOME ? join(process.env.HOME, '.local', 'share', 'pnpm', 'bin') : null,
    process.env.USERPROFILE ? join(process.env.USERPROFILE, 'AppData', 'Local', 'pnpm') : null,
    process.env.PATH ?? '',
  ].filter(Boolean);
  return {
    cwd: ROOT,
    env: { ...process.env, PATH: pathEntries.join(delimiter) },
    shell: false,
  };
}

function describe(argv) {
  return argv.map((part) => JSON.stringify(part)).join(' ');
}

function resourceSummary() {
  return `${availableParallelism()} CPUs, ${Math.round(freemem() / 1024 / 1024)} MiB free / ${Math.round(totalmem() / 1024 / 1024)} MiB total`;
}

export function execute(argv, { dryRun = false, timeoutMs = DEFAULT_TIMEOUT_MS } = {}) {
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
    console.error(`    command failed: ${reason} (${resourceSummary()})`);
    return 1;
  }
  if (result.signal) {
    console.error(`    command terminated by ${result.signal} (${resourceSummary()})`);
    return 1;
  }
  return result.status ?? 1;
}

function runGit(args) {
  const result = spawnSync('git', args, {
    ...commandEnvironment(),
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
  });
  if (result.error || result.status !== 0) return '';
  return result.stdout ?? '';
}

export function readStagedFiles() {
  return runGit(['diff', '--cached', '--name-only', '-z', '--diff-filter=ACMRTUXB'])
    .split('\0')
    .filter(Boolean);
}

function chunk(values, size) {
  const result = [];
  for (let index = 0; index < values.length; index += size)
    result.push(values.slice(index, index + size));
  return result;
}

function isDirectUnitTest(file) {
  return (
    /(?:^|\/)(?:[^/]+\.)?(?:test|spec)\.(?:ts|tsx|js|jsx|mjs|cjs)$/.test(file) &&
    !/(?:^|\/)(?:e2e|visual|perf)\//.test(file) &&
    !file.startsWith('apps/desktop/test/')
  );
}

function existingDirectTests(files) {
  return files.filter((file) => isDirectUnitTest(file) && existsSync(join(ROOT, file)));
}

function hasPath(files, pattern) {
  return files.some((file) => pattern.test(file));
}

function command(lane, argv, timeoutMs = DEFAULT_TIMEOUT_MS) {
  return { lane, argv, timeoutMs };
}

export function selectCommitCommands(stagedFiles) {
  const files = [...new Set(stagedFiles)].sort();
  const commands = [
    command('format-lint:staged', [
      'pnpm',
      'exec',
      'biome',
      'check',
      '--staged',
      '--no-errors-on-unmatched',
    ]),
    command('audit:emoji', ['pnpm', 'audit:emoji']),
    command('audit:health:staged', ['node', 'scripts/audit-health.mjs', '--staged']),
    command('audit:impact-config', ['node', 'scripts/quality/audit-impact-config.mjs']),
    command('secrets:staged', ['node', 'scripts/secret-scan.mjs', '--staged']),
    command('audit:contacts', ['node', 'scripts/audit-contacts.mjs']),
  ];

  if (hasPath(files, /(?:^|\/)docs\//) || hasPath(files, /\.md$/)) {
    commands.push(command('audit:docs', ['pnpm', 'audit:docs']));
  }

  if (hasPath(files, /^\.github\/workflows\//)) {
    commands.push(
      command('workflow-validate', ['node', 'scripts/validate-workflows.mjs', '--staged']),
    );
    commands.push(command('action-pins', ['node', 'scripts/pin-github-actions.mjs', '--check']));
    commands.push(
      command('action-pins:verify', ['node', 'scripts/pin-github-actions.mjs', '--verify']),
    );
    commands.push(command('security-policy', ['node', 'scripts/security/workflow-policy.mjs']));
  }

  if (hasPath(files, /\.(?:ts|tsx|js|jsx|mjs|cjs)$/)) {
    commands.push(command('import-boundaries', ['node', 'scripts/security/import-boundaries.mjs']));
  }

  if (
    hasPath(
      files,
      /(?:scripts\/quality\/|validation-impact\.config\.mjs|tests\/unit\/validationPolicy\.test\.ts)/,
    )
  ) {
    commands.push(
      command('validation-policy', [
        'pnpm',
        'exec',
        'vitest',
        'run',
        '--maxWorkers=1',
        'tests/unit/validationPolicy.test.ts',
      ]),
    );
  }

  if (hasPath(files, /^tests\/e2e\//)) {
    commands.push(command('typecheck:e2e', ['pnpm', 'typecheck:e2e']));
  }

  const directTests = existingDirectTests(files).filter(
    (file) => file !== 'tests/unit/validationPolicy.test.ts' && !file.startsWith('scripts/'),
  );
  for (const group of chunk(directTests, DIRECT_TEST_GROUP_SIZE)) {
    commands.push(
      command(
        'direct-unit',
        ['pnpm', 'exec', 'vitest', 'run', '--maxWorkers=1', ...group],
        DIRECT_TEST_TIMEOUT_MS,
      ),
    );
  }

  return { files, commands };
}

function commandAvailable(name) {
  const result = spawnSync(name, ['--version'], { ...commandEnvironment(), stdio: 'ignore' });
  return !result.error && result.status === 0;
}

function printDeferred(stagedFiles) {
  const deferred = [
    'browser E2E and visual regression',
    'native desktop GUI matrices',
    'full Vitest and Cargo workspace suites',
    'benchmarks, model-quality, packaging, signing, and release checks',
  ];
  if (stagedFiles.some((file) => file.startsWith('tests/e2e/'))) {
    deferred.push('browser execution for staged E2E files (typechecking only runs locally)');
  }
  console.log(`  Deferred to integration/candidate CI: ${deferred.join('; ')}.`);
}

export function runCommitCheckpoint({
  stagedFiles = readStagedFiles(),
  executeCommand = execute,
  dryRun = process.env.VARVE_COMMIT_DRY_RUN === '1',
} = {}) {
  if (process.env.CI) {
    console.log('Commit checkpoint skipped in CI.');
    return 0;
  }

  const selection = selectCommitCommands(stagedFiles);
  if (selection.files.length === 0) {
    console.log('No staged files; commit checkpoint passed.');
    return 0;
  }

  console.log(`Commit checkpoint: ${selection.files.length} staged path(s).`);
  for (const item of selection.commands) {
    const status = executeCommand(item.argv, { dryRun, timeoutMs: item.timeoutMs });
    const code = typeof status === 'number' ? status : (status?.status ?? 1);
    if (code !== 0) {
      console.error(`\nCommit blocked: ${item.lane} failed.`);
      console.error(`Reproduce: ${describe(item.argv)}`);
      return 1;
    }
  }

  if (commandAvailable('gitleaks')) {
    const status = executeCommand(
      ['gitleaks', 'protect', '--staged', '--no-banner', '--source', '.'],
      { dryRun, timeoutMs: DEFAULT_TIMEOUT_MS },
    );
    const code = typeof status === 'number' ? status : (status?.status ?? 1);
    if (code !== 0) {
      console.error('\nCommit blocked: gitleaks found a staged secret.');
      console.error('Review the finding; never allowlist a real credential.');
      return 1;
    }
  }

  // Dependency-cycle and architecture metrics are explicit system-change/CI
  // checks, not a hidden heavyweight pre-commit requirement. Their results
  // are still required by the repository regression protocol when applicable.
  printDeferred(selection.files);
  console.log('Commit checkpoint passed; no repository-wide certification was run.');
  return 0;
}

if (process.argv[1]?.endsWith('commit-checkpoint.mjs')) {
  process.exitCode = runCommitCheckpoint({
    dryRun: process.argv.includes('--dry-run') || process.env.VARVE_COMMIT_DRY_RUN === '1',
  });
}
