/** Dependency-light scheduling regressions; browser commands are recorded, never run. */

import assert from 'node:assert/strict';
import { spawn, spawnSync } from 'node:child_process';
import {
  chmodSync,
  existsSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  rmSync,
  writeFileSync,
} from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  broadBrowserArgv,
  buildExecutionPlan,
  formatExecutionPlan,
  playwrightRunOptions,
} from './execution-plan.mjs';

const exact = 'e2e:file:tests/e2e/canvas/direct.spec.ts';
const visual = 'e2e:file:tests/e2e/visual/replay.spec.ts';
const tiers = {
  0: ['format:touched', 'audit:docs'],
  1: ['typecheck:e2e', exact, 'js-unit:file:unit.test.ts', visual],
  2: ['js-unit:@varve/editor', 'typecheck:@varve/editor'],
  3: ['typecheck:@varve/desktop'],
  4: ['wasm', 'e2e:canvas', 'e2e:visual', 'website-e2e', 'e2e:all'],
};
const scheduled = buildExecutionPlan({ tiers });
assert.deepEqual(scheduled.covered, [
  { lane: exact, coveredBy: 'e2e:all' },
  { lane: visual, coveredBy: 'e2e:all' },
  { lane: 'e2e:canvas', coveredBy: 'e2e:all' },
  { lane: 'e2e:visual', coveredBy: 'e2e:all' },
]);
assert.deepEqual(scheduled.lanes, [
  'format:touched',
  'audit:docs',
  'typecheck:e2e',
  'typecheck:@varve/editor',
  'typecheck:@varve/desktop',
  'js-unit:file:unit.test.ts',
  'js-unit:@varve/editor',
  'wasm',
  'website-e2e',
  'e2e:all',
]);
assert.deepEqual(
  new Set(scheduled.selected),
  new Set([...scheduled.lanes, ...scheduled.covered.map(({ lane }) => lane)]),
  'every selected lane must execute or have explicit broader coverage',
);
assert.deepEqual(
  tiers[1],
  ['typecheck:e2e', exact, 'js-unit:file:unit.test.ts', visual],
  'the planner selection is not mutated',
);
assert.match(formatExecutionPlan(scheduled), /Coverage succeeds only when e2e:all passes/);
assert.doesNotMatch(formatExecutionPlan(scheduled), /\[PASS\]|\[SKIP\]/);

const narrow = buildExecutionPlan({ tiers: { ...tiers, 4: ['e2e:canvas', 'e2e:visual'] } });
assert.deepEqual(
  narrow.covered,
  [],
  'without a selected whole suite, narrower browser lanes remain selected',
);
assert.ok(narrow.lanes.includes(exact));
assert.ok(narrow.lanes.indexOf('typecheck:@varve/desktop') < narrow.lanes.indexOf(exact));
const quick = buildExecutionPlan({ tiers }, { tiers: [0, 1] });
assert.deepEqual(quick.covered, [], 'quick cannot claim coverage from an unselected Tier 4 suite');
assert.deepEqual(quick.lanes, [
  'format:touched',
  'audit:docs',
  'typecheck:e2e',
  'js-unit:file:unit.test.ts',
  exact,
  visual,
]);
assert.ok(
  !quick.lanes.includes('typecheck:@varve/editor'),
  'ordering does not broaden quick scope',
);

const external = 'e2e:file:apps/website/tests/e2e/home.spec.ts';
const traversed = 'e2e:file:tests/e2e/../../apps/website/home.spec.ts';
const separate = buildExecutionPlan(
  { tiers: { 1: [external, traversed], 4: ['e2e:custom', 'website-e2e', 'e2e:all'] } },
  { e2eDomains: { custom: ['external/tests/**'] } },
);
assert.deepEqual(
  separate.covered,
  [],
  'different configs or paths outside the app test directory cannot be subsumed',
);
assert.deepEqual(separate.lanes, [external, traversed, 'e2e:custom', 'website-e2e', 'e2e:all']);

const discovery = { workers: '1', maxFailures: '5', triage: true };
const bounds = ['--workers', '1', '--max-failures', '5', '--retries=0'];
assert.deepEqual(playwrightRunOptions(discovery), bounds);
assert.deepEqual(broadBrowserArgv('e2e:all', discovery), [
  'pnpm',
  'exec',
  'playwright',
  'test',
  ...bounds,
]);
assert.deepEqual(broadBrowserArgv('e2e:visual', discovery), [
  'pnpm',
  'exec',
  'playwright',
  'test',
  '--project=chromium-visual-1x',
  '--project=chromium-visual-2x',
  ...bounds,
]);
assert.deepEqual(broadBrowserArgv('website-e2e', discovery), [
  'pnpm',
  'test:website:e2e',
  ...bounds,
]);
assert.deepEqual(
  broadBrowserArgv('e2e:all', { workers: '2' }),
  ['pnpm', 'exec', 'playwright', 'test', '--workers', '2'],
  'ordinary/final runs retain the configured retry policy',
);
assert.deepEqual(
  playwrightRunOptions({ maxFailures: '3' }),
  ['--max-failures', '3'],
  'explicit existing failure-count override remains supported',
);
assert.throws(() => broadBrowserArgv('unknown'), /No broad browser command/);

const repo = mkdtempSync(join(tmpdir(), 'varve-execution-plan-'));
try {
  const bin = join(repo, 'node_modules/.bin');
  mkdirSync(bin, { recursive: true });
  mkdirSync(join(repo, 'tests/e2e/canvas'), { recursive: true });
  mkdirSync(join(repo, 'tests/e2e/helpers'), { recursive: true });
  mkdirSync(join(repo, 'scripts/quality'), { recursive: true });
  const commandsPath = join(repo, 'commands.jsonl');
  const recordImport = 'import { appendFileSync } from "node:fs";';
  const record =
    'appendFileSync(process.env.TEST_COMMAND_LOG, JSON.stringify(process.argv.slice(2)) + "\\n");';
  const compilerDescendant = `process.on('SIGTERM',()=>{});require('node:fs').writeFileSync(process.argv[1],JSON.stringify({parent:process.ppid,grandchild:process.pid}));setInterval(()=>{},1000);`;
  const compilerFixture = `if (process.argv[2] === 'typecheck:e2e' && process.env.TEST_CANCEL_MARKER) { const {spawn}=await import('node:child_process'); process.on('SIGTERM',()=>{}); const child=spawn(process.execPath,['-e',${JSON.stringify(compilerDescendant)},process.env.TEST_CANCEL_MARKER],{detached:true,stdio:'ignore'}); child.on('exit',()=>process.exit(0)); setInterval(()=>{},1000); }`;
  writeFileSync(
    join(bin, 'pnpm'),
    `#!/usr/bin/env node\n${recordImport}\nif (process.argv[2] === 'm') { console.log('[]'); } else { ${record} ${compilerFixture} if (process.argv[2] === 'typecheck:e2e' && process.env.TEST_COMPILER_FAILURE === '1') process.exit(9); }\n`,
  );
  writeFileSync(join(bin, 'biome'), `#!/usr/bin/env node\n${recordImport}\n${record}\n`);
  chmodSync(join(bin, 'pnpm'), 0o755);
  chmodSync(join(bin, 'biome'), 0o755);
  // Only the throwaway fixture replaces the lease wrapper with an argv
  // recorder. The production verifier still invokes its real lease wrapper.
  writeFileSync(join(repo, 'scripts/quality/heavy-lease.mjs'), `${recordImport}\n${record}\n`);
  writeFileSync(join(repo, 'package.json'), '{"name":"execution-plan-fixture","private":true}\n');
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: repo, encoding: 'utf8' });
    assert.equal(result.status, 0, result.stderr);
  };
  git(['init', '-q']);
  git(['config', 'user.name', 'Validation test']);
  git(['config', 'user.email', 'validation@example.invalid']);
  git(['add', 'package.json']);
  git(['commit', '-qm', 'base']);
  writeFileSync(join(repo, 'tests/e2e/canvas/direct.spec.ts'), '// direct browser fixture\n');
  writeFileSync(join(repo, 'tests/e2e/helpers/shared.ts'), '// shared browser fixture\n');
  writeFileSync(join(repo, 'playwright.config.ts'), '// final escalation fixture\n');
  git(['add', 'tests', 'playwright.config.ts']);
  const verifier = fileURLToPath(new URL('./verify.mjs', import.meta.url));
  const execute = (mode, overrides = {}) => {
    writeFileSync(commandsPath, '');
    const result = spawnSync(process.execPath, [verifier, mode, '--staged'], {
      cwd: repo,
      encoding: 'utf8',
      env: {
        ...process.env,
        PATH: `${bin}:${process.env.PATH}`,
        CI: '1',
        TEST_COMMAND_LOG: commandsPath,
        VARVE_E2E_WORKERS: '1',
        VARVE_E2E_MAX_FAILURES: '3',
        ...overrides,
      },
    });
    const recorded = readFileSync(commandsPath, 'utf8')
      .trim()
      .split('\n')
      .filter(Boolean)
      .map(JSON.parse);
    return { ...result, recorded };
  };
  const cancelMarker = join(repo, 'cancel-owned-pids.json');
  const cancelled = spawn(process.execPath, [verifier, 'quick', '--staged'], {
    cwd: repo,
    stdio: 'ignore',
    env: {
      ...process.env,
      PATH: `${bin}:${process.env.PATH}`,
      TEST_COMMAND_LOG: commandsPath,
      TEST_CANCEL_MARKER: cancelMarker,
    },
  });
  const cancelledExit = new Promise((resolve) =>
    cancelled.once('exit', (code, signal) => resolve({ code, signal })),
  );
  let ownedPids;
  try {
    const deadline = Date.now() + 5000;
    while (!existsSync(cancelMarker) && Date.now() < deadline)
      await new Promise((resolve) => setTimeout(resolve, 5));
    assert.ok(existsSync(cancelMarker), 'actual verifier compiler fixture did not start');
    ownedPids = JSON.parse(readFileSync(cancelMarker, 'utf8'));
    cancelled.kill('SIGTERM');
    const result = await Promise.race([
      cancelledExit,
      new Promise((_, reject) =>
        setTimeout(() => reject(new Error('verifier cancellation was not bounded')), 4000).unref(),
      ),
    ]);
    assert.equal(result.code, 143, 'actual verifier must preserve cancellation status');
    assert.equal(result.signal, null);
    for (const pid of Object.values(ownedPids)) {
      let state;
      try {
        const stat = readFileSync(`/proc/${pid}/stat`, 'utf8');
        state = stat.slice(stat.lastIndexOf(')') + 2).split(' ')[0];
      } catch {
        state = null;
      }
      assert.ok(
        state === null || state === 'Z',
        'actual verifier left an owned detached compiler descendant running',
      );
    }
  } finally {
    for (const pid of Object.values(ownedPids ?? {})) {
      try {
        process.kill(pid, 'SIGKILL');
      } catch {}
    }
    cancelled.kill('SIGKILL');
  }

  const triage = execute('triage');
  assert.equal(triage.status, 0, `${triage.stdout}\n${triage.stderr}`);
  assert.match(triage.stdout, /Final full gate required after triage/);
  assert.match(
    triage.stdout,
    /\[COVERAGE\] e2e:all includes e2e:file:tests\/e2e\/canvas\/direct.spec.ts/,
  );
  assert.doesNotMatch(triage.stdout, /Full gate passed|\[PASS\] e2e:file:/);
  const browserCalls = triage.recorded.filter((args) => args.includes('playwright'));
  assert.deepEqual(
    browserCalls,
    [
      [
        'e2e:all',
        '--',
        'pnpm',
        'exec',
        'playwright',
        'test',
        '--workers',
        '1',
        '--max-failures',
        '3',
        '--retries=0',
      ],
    ],
    'the real executor performs one bounded whole-suite command through its lease, without repeated exact specs',
  );
  assert.ok(
    triage.recorded.findIndex((args) => args[0] === 'typecheck:e2e') <
      triage.recorded.findIndex((args) => args.includes('playwright')),
  );
  const failed = execute('triage', { TEST_COMPILER_FAILURE: '1' });
  assert.equal(failed.status, 9, 'the exact compiler failure code is retained');
  assert.equal(
    failed.recorded.filter((args) => args.includes('playwright')).length,
    0,
    'a compiler failure must stop before any browser launches',
  );
  const affected = execute('affected');
  assert.equal(
    affected.status,
    2,
    'full escalation remains incomplete, never a successful deferred gate',
  );
  assert.equal(affected.recorded.length, 0);
  const quickRun = execute('quick');
  assert.equal(quickRun.status, 0, `${quickRun.stdout}\n${quickRun.stderr}`);
  const quickBrowsers = quickRun.recorded.filter((args) => args.includes('playwright'));
  assert.equal(quickBrowsers.length, 1);
  assert.ok(quickBrowsers[0].includes('tests/e2e/canvas/direct.spec.ts'));
  assert.ok(!quickBrowsers[0].includes('--retries=0'), 'quick keeps ordinary retries');
} finally {
  rmSync(repo, { recursive: true, force: true });
}

// Exercise real pnpm forwarding without building or opening a browser.
const forwardingRepo = mkdtempSync(join(tmpdir(), 'varve-website-forwarding-'));
try {
  writeFileSync(
    join(forwardingRepo, 'build.mjs'),
    'console.log("fixture build", JSON.stringify(process.argv.slice(2)));\n',
  );
  writeFileSync(
    join(forwardingRepo, 'browser.mjs'),
    'console.log("fixture browser", JSON.stringify(process.argv.slice(2)));\n',
  );
  writeFileSync(
    join(forwardingRepo, 'package.json'),
    JSON.stringify({
      name: 'website-forwarding-fixture',
      private: true,
      scripts: {
        'test:website:e2e':
          'node build.mjs && node build.mjs && node browser.mjs --update-snapshots=none',
      },
    }),
  );
  const [command, ...args] = broadBrowserArgv('website-e2e', discovery);
  const result = spawnSync(command, args, { cwd: forwardingRepo, encoding: 'utf8' });
  assert.equal(result.status, 0, result.stderr);
  assert.equal(
    (result.stdout.match(/fixture build \[\]/g) ?? []).length,
    2,
    'both website outputs remain prerequisites',
  );
  assert.ok(
    result.stdout.includes(
      `fixture browser ${JSON.stringify(['--update-snapshots=none', ...bounds])}`,
    ),
    'pnpm forwards bounds only to the final browser command and preserves frozen snapshots',
  );
} finally {
  rmSync(forwardingRepo, { recursive: true, force: true });
}

console.log('execution plan tests passed (no browsers launched)');
