#!/usr/bin/env node

/** Discover browser cases without launching a browser; bind coverage to exact source. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname } from 'node:path';
import { pathToFileURL } from 'node:url';
import { IMPACT_CONFIG } from '../../validation-impact.config.mjs';
import { redactSensitive } from '../ci/failure-manifest.mjs';

const digest = (value) => createHash('sha256').update(value).digest('hex');
const SOURCE_KEYS = ['commitSha', 'treeSha', 'planHash', 'policyHash'];
const RUNTIME_OPTIONS = new Set([
  '--workers',
  '--retries',
  '--update-snapshots',
  '--trace',
  '--reporter',
  '--max-failures',
  '--timeout',
  '--global-timeout',
  '--output',
  '--shard',
]);

export function browserCaseId(file, titlePath, project) {
  return digest(JSON.stringify([file.replaceAll('\\', '/'), titlePath, project]));
}

export function inventoryCommand(argv) {
  const result = [];
  for (let index = 0; index < argv.length; index++) {
    const arg = argv[index];
    const flag = arg.split('=')[0];
    if (RUNTIME_OPTIONS.has(flag)) {
      if (!arg.includes('=')) index++;
      continue;
    }
    if (['--list', '--fail-on-flaky-tests'].includes(arg)) continue;
    if (
      /^--(?:grep|grep-invert|last-failed|test-list|test-list-invert|only-changed|repeat-each)(?:=|$)/.test(
        arg,
      )
    )
      throw new Error('Browser inventory refuses a filtered or repeated discovery command');
    result.push(arg);
  }
  return [...result, '--list', '--reporter=json'];
}

export function discoveredCases(suites, parents = [], collected = []) {
  if (!Array.isArray(suites)) throw new Error('Browser discovery suites must be an array');
  for (const suite of suites) {
    if (!Array.isArray(suite.specs)) throw new Error('Browser discovery specs must be an array');
    const titles = [...parents, suite.title];
    for (const spec of suite.specs) {
      if (
        typeof spec.file !== 'string' ||
        typeof spec.title !== 'string' ||
        !Array.isArray(spec.tests)
      )
        throw new Error('Browser discovery has an invalid spec');
      for (const test of spec.tests) {
        if (
          typeof test.projectName !== 'string' ||
          !['passed', 'failed', 'skipped'].includes(test.expectedStatus)
        )
          throw new Error('Browser discovery has an invalid case');
        const titlePath = [...titles, spec.title];
        collected.push({
          caseId: browserCaseId(spec.file, titlePath, test.projectName),
          file: spec.file.replaceAll('\\', '/'),
          titlePath,
          project: test.projectName,
          expectedStatus: test.expectedStatus,
          skipReasons: (test.annotations ?? [])
            .filter((entry) => ['skip', 'fixme'].includes(entry.type))
            .map((entry) => redactSensitive(String(entry.description ?? '')).slice(0, 1000))
            .filter(Boolean),
          durationMs: null,
        });
      }
    }
    discoveredCases(suite.suites ?? [], titles, collected);
  }
  return collected;
}

function manifestBody(manifest) {
  const { sha256: _sha256, ...body } = manifest;
  return body;
}

function selectionErrors(manifest) {
  if (!Array.isArray(manifest?.command)) return ['missing inventory selection'];
  const command = manifest.command;
  if (
    JSON.stringify(command.slice(0, 4)) !== JSON.stringify(['pnpm', 'exec', 'playwright', 'test'])
  )
    return ['unsupported inventory discovery entry point'];
  const paths = [];
  let config = null;
  for (let index = 4; index < command.length; index++) {
    const arg = command[index];
    if (['--list', '--reporter=json'].includes(arg) || arg.startsWith('--project=')) continue;
    if (arg === '--project') {
      index++;
      continue;
    }
    if (arg === '--config' || arg === '-c') {
      config = command[++index];
      continue;
    }
    if (arg.startsWith('--config=')) {
      config = arg.slice(9);
      continue;
    }
    if (arg.startsWith('-')) return ['unsupported inventory selection option'];
    paths.push(arg);
  }
  const lane = manifest.lane;
  const expectedPaths = lane?.startsWith('e2e:file:')
    ? [lane.slice(9)]
    : lane?.startsWith('e2e:') && !['e2e:all', 'e2e:visual', 'e2e:demo-dist'].includes(lane)
      ? (IMPACT_CONFIG.e2eDomains[lane.slice(4)] ?? [`tests/e2e/${lane.slice(4)}`]).map((path) =>
          path.replace(/\/\*\*$/, ''),
        )
      : [];
  if (JSON.stringify(paths) !== JSON.stringify(expectedPaths))
    return ['inventory selection differs from its canonical lane'];
  const expectedConfig =
    lane === 'website-e2e'
      ? 'playwright.website.config.ts'
      : lane === 'e2e:demo-dist'
        ? 'playwright.demo-dist.config.mts'
        : null;
  if (config !== expectedConfig) return ['inventory config differs from its canonical lane'];
  return [];
}

export function inventoryErrors(manifest, expectedSource = null) {
  const errors = [];
  if (manifest?.schema !== 1 || typeof manifest?.lane !== 'string')
    errors.push('invalid inventory schema or lane');
  for (const key of SOURCE_KEYS) {
    if (
      !new RegExp(`^[a-f0-9]{${key.endsWith('Sha') ? 40 : 64}}$`).test(
        manifest?.source?.[key] ?? '',
      )
    )
      errors.push(`invalid inventory ${key}`);
    if (expectedSource?.[key] && manifest?.source?.[key] !== expectedSource[key])
      errors.push(`inventory ${key} mismatch`);
  }
  if (
    !/^[a-f0-9]{64}$/.test(manifest?.sha256 ?? '') ||
    manifest?.sha256 !== digest(JSON.stringify(manifestBody(manifest ?? {})))
  )
    errors.push('inventory digest mismatch');
  const cases = manifest?.cases;
  if (!Array.isArray(cases) || !cases.length) errors.push('missing or empty inventory');
  else {
    const ids = new Set();
    for (const entry of cases) {
      if (
        typeof entry?.file !== 'string' ||
        !Array.isArray(entry?.titlePath) ||
        typeof entry?.project !== 'string' ||
        !['passed', 'failed', 'skipped'].includes(entry?.expectedStatus) ||
        !Array.isArray(entry?.skipReasons) ||
        entry.caseId !== browserCaseId(entry.file, entry.titlePath, entry.project) ||
        ids.has(entry.caseId)
      ) {
        errors.push('invalid or duplicate inventory case');
      }
      ids.add(entry?.caseId);
    }
    if (manifest?.caseCount !== cases.length) errors.push('inventory case count mismatch');
    const projects = [...new Set(cases.map((entry) => entry?.project))].sort();
    if (JSON.stringify(projects) !== JSON.stringify(manifest?.projects))
      errors.push('inventory project coverage mismatch');
    if (cases.every((entry) => entry?.expectedStatus === 'skipped'))
      errors.push('selected inventory is entirely skipped');
  }
  if (
    !Array.isArray(manifest?.command) ||
    !manifest.command.includes('--list') ||
    !manifest.command.includes('--reporter=json')
  )
    errors.push('invalid inventory discovery command');
  errors.push(...selectionErrors(manifest));
  return [...new Set(errors)];
}

export function createBrowserInventory(json, { lane, argv, source }) {
  if (!Array.isArray(json.errors) || json.errors.length)
    throw new Error('Browser discovery reported runner errors');
  const cases = discoveredCases(json.suites).sort((a, b) => a.caseId.localeCompare(b.caseId));
  const projects = [...new Set(cases.map((entry) => entry.project))].sort();
  const requested = argv
    .flatMap((arg, index) =>
      arg.startsWith('--project=') ? [arg.slice(10)] : arg === '--project' ? [argv[index + 1]] : [],
    )
    .sort();
  const selected = requested.length
    ? [...new Set(requested)]
    : (json.config?.projects ?? []).map((project) => project.name).sort();
  if (JSON.stringify(projects) !== JSON.stringify(selected))
    throw new Error('Browser discovery omitted a selected project');
  if (json.config?.shard != null)
    throw new Error('Browser discovery must enumerate the complete unsharded selection');
  const manifest = {
    schema: 1,
    lane,
    source: Object.fromEntries(SOURCE_KEYS.map((key) => [key, source[key]])),
    command: inventoryCommand(argv),
    projects,
    caseCount: cases.length,
    cases,
  };
  manifest.sha256 = digest(JSON.stringify(manifest));
  const errors = inventoryErrors(manifest, source);
  if (errors.length) throw new Error(errors.join('; '));
  return manifest;
}

export function readInventorySource(root = process.cwd()) {
  const git = (args) => {
    const result = spawnSync('git', args, { cwd: root, encoding: 'utf8', shell: false });
    if (result.status !== 0 || result.error || result.signal)
      throw new Error('Cannot read browser inventory source');
    return result.stdout.trim();
  };
  return {
    clean: git(['status', '--porcelain=v1', '-z']) === '',
    commitSha: git(['rev-parse', '--verify', 'HEAD^{commit}']),
    treeSha: git(['rev-parse', '--verify', 'HEAD^{tree}']),
  };
}

function requireInventorySource(actual, expected) {
  if (
    actual?.clean !== true ||
    actual.commitSha !== expected.commitSha ||
    actual.treeSha !== expected.treeSha
  )
    throw new Error('Browser inventory requires unchanged clean source at the planned commit');
}

export function discoverBrowserInventory({
  argv,
  lane,
  source,
  root = process.cwd(),
  execute = spawnSync,
  readSource = readInventorySource,
}) {
  requireInventorySource(readSource(root), source);
  const command = inventoryCommand(argv);
  const result = execute(command[0], command.slice(1), {
    cwd: root,
    env: process.env,
    encoding: 'utf8',
    shell: false,
    timeout: 120000,
    maxBuffer: 32 * 1024 * 1024,
  });
  if (result.status !== 0 || result.error || result.signal)
    throw new Error('Browser inventory discovery failed or was interrupted');
  requireInventorySource(readSource(root), source);
  let json;
  try {
    json = JSON.parse(result.stdout);
  } catch {
    throw new Error('Browser inventory discovery returned malformed JSON');
  }
  return createBrowserInventory(json, { lane, argv, source });
}

/** Runtime skips must describe a documented absent capability, never a missing UI/fixture. */
export function explainedRuntimeSkip(entry, actual) {
  if (entry.expectedStatus === 'skipped') return entry.skipReasons.length > 0;
  const reasons = (actual.annotations ?? [])
    .filter((a) => a.type === 'skip')
    .map((a) => a.description ?? '');
  const file = entry.file;
  const capabilityFile =
    /^(?:webgpu\/|webgl2\/|effects\/gpu-agreement\.spec\.ts$|motion\/video-export\.spec\.ts$|tauri\/|archive\/archive\.spec\.ts$|canvas\/(?:object-selection.*real-model|photo-raw-hdr|photo-hdr-gainmap|threaded-wasm-probe|discovery-preprocess-parity)\.spec\.ts$|interaction\/chromeos-device-matrix\.spec\.ts$|browser\/browser-readiness\.spec\.ts$)/.test(
      file,
    );
  return (
    capabilityFile &&
    reasons.some(
      (reason) =>
        /(?:unavailable|no (?:hardware )?(?:WebGPU|WebGL2)|no .*adapter|without .*API|desktop.only|Tauri.only|native.only|not (?:available|supported)|model.*(?:missing|unavailable)|preflight refused|requires? (?:native|Tauri|WebGPU|WebGL2|cross.origin)|specs require --project=chromium-gpu|set VARVE_(?:RAW_FIXTURE|HDR_FIXTURE_DIR)|not cross.origin isolated)/i.test(
          reason,
        ) ||
        (/^canvas\/photo-hdr-gainmap\.spec\.ts$/.test(file) &&
          /^missing .+\.(?:jpe?g|hdr)$/i.test(reason)),
    )
  );
}

export function inventoryCoverageErrors(manifest, cases, { complete = true } = {}) {
  const errors = [...inventoryErrors(manifest)];
  if (errors.length) return errors;
  if (!Array.isArray(cases)) return [...errors, 'missing inventory execution cases'];
  if (!Array.isArray(manifest?.cases)) return [...errors, 'missing inventory discovery cases'];
  const expected = new Map((manifest?.cases ?? []).map((entry) => [entry.caseId, entry]));
  const seen = new Set();
  for (const actual of cases) {
    if (seen.has(actual?.caseId)) errors.push('duplicate executed inventory case');
    seen.add(actual?.caseId);
    const entry = expected.get(actual?.caseId);
    if (!entry) errors.push('unexpected executed inventory case');
    else {
      if (actual.expectedStatus !== entry.expectedStatus && actual.status !== 'skipped')
        errors.push('inventory case expectation changed');
      if (actual.status === 'skipped' && !explainedRuntimeSkip(entry, actual))
        errors.push('unexplained skipped inventory case');
    }
  }
  if (complete && expected.size !== seen.size) errors.push('incomplete inventory case coverage');
  if (complete && [...expected.keys()].some((id) => !seen.has(id)))
    errors.push('missing executed inventory case');
  if (cases.length && cases.every((entry) => entry?.status === 'skipped'))
    errors.push('selected browser coverage is entirely skipped');
  return [...new Set(errors)];
}

function value(args, flag) {
  const at = args.indexOf(flag);
  return at === -1 ? null : args[at + 1];
}
function main() {
  const args = process.argv.slice(2);
  const lane = value(args, '--lane');
  const planPath = value(args, '--plan');
  const plan = planPath ? JSON.parse(readFileSync(planPath, 'utf8')) : {};
  const git = (revision) => {
    const result = spawnSync('git', ['rev-parse', '--verify', revision], {
      encoding: 'utf8',
      shell: false,
    });
    if (result.status !== 0) throw new Error('Cannot read browser inventory source');
    return result.stdout.trim();
  };
  const source = {
    commitSha: git('HEAD^{commit}'),
    treeSha: git('HEAD^{tree}'),
    planHash: plan.planHash ?? process.env.VARVE_CI_PLAN_HASH,
    policyHash: plan.policyHash ?? process.env.VARVE_CI_POLICY_HASH,
  };
  if ((plan.commitSha ?? process.env.VARVE_CI_COMMIT_SHA) !== source.commitSha)
    throw new Error('Browser inventory source differs from planned commit');
  const projects = args.flatMap((arg, index) => (arg === '--project' ? [args[index + 1]] : []));
  const config = value(args, '--config');
  const paths = args.flatMap((arg, index) => (arg === '--path' ? [args[index + 1]] : []));
  const argv = [
    'pnpm',
    'exec',
    'playwright',
    'test',
    ...paths,
    ...(config ? ['--config', config] : []),
    ...projects.map((project) => `--project=${project}`),
  ];
  if (!lane || !value(args, '--output'))
    throw new Error('Browser inventory requires --lane and --output');
  const manifest = discoverBrowserInventory({ argv, lane, source });
  const output = value(args, '--output');
  mkdirSync(dirname(output), { recursive: true });
  writeFileSync(output, `${JSON.stringify(manifest, null, 2)}\n`);
  console.log(`Browser inventory: ${lane}, ${manifest.caseCount} cases, ${manifest.sha256}`);
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`Browser inventory failed: ${error.message}`);
    process.exitCode = 1;
  }
}
