import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';

const yaml = createRequire(import.meta.url)('js-yaml');
const root = process.env.VARVE_BROWSER_LEASE_WORKFLOW_ROOT
  ? resolve(process.env.VARVE_BROWSER_LEASE_WORKFLOW_ROOT)
  : fileURLToPath(new URL('../../', import.meta.url));
const paths = ['.github/workflows/ci.yml', '.github/workflows/release-candidate.yml'];
const workflows = paths.map((path) => yaml.load(readFileSync(resolve(root, path), 'utf8')));
const browserCommand = /\b(?:pnpm exec playwright test|pnpm e2e:visual)(?:\s|$)/;
const wrapper = /^node scripts\/quality\/heavy-lease\.mjs "[^"\n]+" -- (.+)$/;

function runs(workflow) {
  return Object.entries(workflow.jobs).flatMap(([job, value]) =>
    (value.steps ?? [])
      .filter((step) => typeof step.run === 'string')
      .map((step) => ({
        job,
        name: step.name ?? '(unnamed)',
        lines: step.run.split('\n').map((line) => line.trim()),
      })),
  );
}

function browserCalls(workflow) {
  return runs(workflow).flatMap(({ job, name, lines }) =>
    lines
      .filter((line) => browserCommand.test(line))
      .map((line) => {
        const match = wrapper.exec(line);
        assert.ok(
          match,
          `${job}/${name}: direct browser execution must use the heavy lease: ${line}`,
        );
        assert.match(match[1], /^(?:pnpm exec playwright test|pnpm e2e:visual)(?:\s|$)/);
        return { job, name, command: match[1] };
      }),
  );
}

const strictFlags = [
  '--workers=1',
  '--retries=0',
  '--update-snapshots=none',
  '--fail-on-flaky-tests',
  '--trace=retain-on-failure',
];

for (const [index, path] of paths.entries()) {
  test(`${path}: every direct browser command uses the lease and retains strict execution`, () => {
    const calls = browserCalls(workflows[index]);
    assert.equal(calls.length, index === 0 ? 4 : 8, 'Cover every existing direct branch');
    for (const { command } of calls) {
      for (const flag of strictFlags) assert.ok(command.split(/\s+/).includes(flag), flag);
    }
  });
}

test('candidate branches bound red attempts while retaining complete inventory and canonical shard selection', () => {
  const calls = browserCalls(workflows[1]);
  for (const name of [
    'Website E2E (candidate)',
    'Browser E2E (candidate)',
    'Visual E2E (candidate)',
  ]) {
    const pair = calls.filter((call) => call.name === name);
    assert.equal(pair.length, 2, name);
    assert.ok(pair[0].command.split(/\s+/).includes('--max-failures=5'), 'Triage remains bounded');
    assert.ok(
      pair[1].command.split(/\s+/).includes('--max-failures=5'),
      'Final failures remain bounded; inventory completeness is still required for green',
    );
  }
  for (const call of calls.filter((call) => call.name === 'Browser E2E (candidate)'))
    assert.ok(
      call.command.includes(
        // biome-ignore lint/suspicious/noTemplateCurlyInString: Match literal GitHub Actions expressions.
        '--shard=${{ matrix.shard }}/${{ needs.changes.outputs.e2e_shard_count }}',
      ),
      'Use the canonical planner shard count',
    );
  assert.ok(
    calls.find(
      (call) =>
        call.name === 'Visual E2E (candidate)' && call.command.startsWith('pnpm e2e:visual '),
    ),
    'Final visuals retain the existing alias and its three DPR projects',
  );
});

test('negative control: a raw Playwright branch is rejected', () => {
  const raw = structuredClone(workflows[1]);
  const step = Object.values(raw.jobs)
    .flatMap((job) => job.steps ?? [])
    .find((step) => step.name === 'Browser E2E (candidate)');
  step.run = step.run.replace(/^\s*node scripts\/quality\/heavy-lease\.mjs "[^"\n]+" -- /m, '');
  assert.throws(() => browserCalls(raw), /direct browser execution must use the heavy lease/);
});

test('negative control: a raw visual alias is rejected', () => {
  const raw = structuredClone(workflows[1]);
  const step = Object.values(raw.jobs)
    .flatMap((job) => job.steps ?? [])
    .find((step) => step.name === 'Visual E2E (candidate)');
  step.run = step.run.replace(
    /node scripts\/quality\/heavy-lease\.mjs "[^"\n]+" -- (?=pnpm e2e:visual)/,
    '',
  );
  assert.throws(() => browserCalls(raw), /direct browser execution must use the heavy lease/);
});

test('browser installation and the already leased lane runner stay outside additional wrappers', () => {
  for (const workflow of workflows) {
    const installs = runs(workflow)
      .flatMap((run) => run.lines)
      .filter((line) => line.includes('playwright install'));
    assert.equal(installs.length, 3);
    for (const line of installs)
      assert.equal(line, 'pnpm exec playwright install --with-deps chromium');
  }
  const laneRuns = runs(workflows[0])
    .flatMap((run) => run.lines)
    .filter((line) => line.includes('scripts/quality/ci-run-lanes.mjs'));
  assert.ok(laneRuns.length > 0);
  assert.ok(
    laneRuns.every((line) => !line.includes('heavy-lease.mjs')),
    'Avoid nested leases',
  );
});

function nativeLinuxRoutes(workflow, candidate) {
  const steps = workflow.jobs['desktop-e2e'].steps;
  const setup = steps.find((step) => step.name === 'Install Linux system deps (Tauri + WebKitGTK)');
  assert.equal(setup?.if, "runner.os == 'Linux'", 'Only the Linux cell installs apt dependencies');
  const dependencies = setup.run
    .match(/apt-get install -y --no-install-recommends ([\s\S]+)/)?.[1]
    .replaceAll('\\', '')
    .split(/\s+/)
    .filter(Boolean)
    .sort();
  for (const name of ['libwebkit2gtk-4.1-dev', 'libgtk-3-dev', 'xvfb', 'dbus-x11'])
    assert.ok(dependencies?.includes(name), `Linux desktop requires ${name}`);
  const routes = steps.filter((step) => step.run?.includes('pnpm test:desktop:native'));
  assert.equal(routes.length, 2, 'Every native OS uses exactly one conditional execution route');
  const linux = routes.find((step) => step.run.startsWith('dbus-run-session'));
  const other = routes.find((step) => step.run === 'pnpm test:desktop:native');
  assert.equal(
    linux?.run,
    'dbus-run-session -- xvfb-run --auto-servernum pnpm test:desktop:native',
  );
  assert.equal(linux?.if, candidate ? "runner.os == 'Linux'" : 'matrix.xvfb');
  // biome-ignore lint/suspicious/noTemplateCurlyInString: Match the literal GitHub Actions condition.
  assert.equal(other?.if, candidate ? "runner.os != 'Linux'" : '${{ !matrix.xvfb }}');
  assert.ok(
    steps.indexOf(setup) < steps.indexOf(linux),
    'Install dependencies before preflight/build',
  );
  return dependencies;
}

test('candidate Linux native setup matches integration and keeps display isolation OS-specific', () => {
  assert.deepEqual(nativeLinuxRoutes(workflows[1], true), nativeLinuxRoutes(workflows[0], false));
});

test('negative control: candidate cannot omit Linux dependencies or run unwrapped without display', () => {
  const missing = structuredClone(workflows[1]);
  const setup = missing.jobs['desktop-e2e'].steps.find(
    (step) => step.name === 'Install Linux system deps (Tauri + WebKitGTK)',
  );
  setup.run = setup.run.replace(/\b(?:libwebkit2gtk-4\.1-dev|dbus-x11)\b/g, '');
  assert.throws(() => nativeLinuxRoutes(missing, true), /Linux desktop requires/);
  const raw = structuredClone(workflows[1]);
  const linux = raw.jobs['desktop-e2e'].steps.find(
    (step) => step.name === 'Native desktop smoke (Linux Xvfb)',
  );
  linux.run = 'pnpm test:desktop:native';
  assert.throws(() => nativeLinuxRoutes(raw, true));
});
