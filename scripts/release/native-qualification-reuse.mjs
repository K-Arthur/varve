#!/usr/bin/env node
/** Retain authentic native evidence only at unchanged platform inputs and bytes. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { appendFileSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { parseArgs } from 'node:util';
import { load } from 'js-yaml';
import { loadReusableRun, loadRunArtifacts, selectRunArtifacts } from './select-run-artifacts.mjs';

const SHA = /^[a-f0-9]{40}$/;
const hash = (bytes) => createHash('sha256').update(bytes).digest('hex');
const nativeJobs = {
  'linux-x86_64': 'Linux package smoke (x86_64)',
  'linux-aarch64': 'Linux package smoke (aarch64)',
  'windows-x86_64': 'windows runner smoke',
  'windows-aarch64': 'windows-aarch64 runner smoke',
  'macos-aarch64': 'macos runner smoke',
};
const adoptionSteps = new Set([
  'Select retained native qualification',
  'Download original native qualification',
  'Verify retained native qualification and installer identity',
  'Preserve retained native provenance',
]);

/** Tests are not runtime inputs; every non-test production file is included. */
export function nativeRuntimePaths(paths, target) {
  assert.ok(nativeJobs[target], 'Unsupported native target');
  const platform = target.split('-')[0];
  return paths
    .filter((path) => {
      if (path.startsWith('scripts/release/production/')) {
        const name = path.slice('scripts/release/production/'.length);
        if (/\.test\.mjs$|\/test_|^test_/.test(name)) return false;
        if (/^(linux|windows|macos)[-_.]/.test(name)) return name.startsWith(platform);
        return true;
      }
      return (
        /^(package\.json|pnpm-lock\.yaml|pnpm-workspace\.yaml)$/.test(path) ||
        (path.startsWith('packages/') && path.endsWith('/package.json')) ||
        /^scripts\/quality\/(heavy-lease|run-bounded-command)\.mjs$/.test(path) ||
        /^scripts\/release\/(targets|verify-release-data|verify-license-payload|extract_updater_archive)\./.test(
          path,
        ) ||
        path === 'scripts/is-main-module.mjs' ||
        path.startsWith('tests/e2e/fixtures/published-v021/')
      );
    })
    .sort();
}

export function nativeWorkflowContract(text, target) {
  const workflow = load(text),
    linux = target.startsWith('linux-');
  const job = workflow.jobs[linux ? 'package-smoke' : 'platform-smoke'];
  const artifact = linux ? `release-${target}` : target;
  const cell = job.strategy.matrix.include.find((entry) => entry.artifact === artifact);
  assert.ok(cell, 'Owning native runner must be present');
  const os = target.startsWith('windows-')
    ? 'Windows'
    : target.startsWith('macos-')
      ? 'macOS'
      : 'Linux';
  const steps = job.steps
    .filter((step) => !adoptionSteps.has(step.name))
    .filter((step) => {
      const match = step.if?.match(/runner\.os == '(Windows|macOS)'/);
      return !match || match[1] === os;
    })
    .map((step) => {
      const normalized = { ...step };
      if (normalized.if)
        normalized.if = normalized.if.replace(/ && env\.REUSE_NATIVE != 'true'/g, '');
      if (normalized.name === 'Native qualification adapter contracts') {
        normalized.run = normalized.run.replace(
          /^.*production\/native-retention\.test\.mjs\n?/gm,
          '',
        );
      }
      // A sparse tooling checkout gains the retention reader, not a runtime mutation.
      if (normalized.name === 'Checkout workflow-pinned native qualification tooling') {
        normalized.with = { ...normalized.with };
        normalized.with['sparse-checkout'] = normalized.with['sparse-checkout']
          .split('\n')
          .filter(
            (line) =>
              !/^\/scripts\/release\/(native-qualification-reuse|select-run-artifacts|resume)\.mjs$/.test(
                line,
              ),
          )
          .join('\n');
      }
      return normalized;
    });
  const jobEnv = Object.fromEntries(
    Object.entries(job.env ?? {}).filter(([key]) => key !== 'REUSE_NATIVE'),
  );
  return { env: workflow.env, jobEnv, runner: cell, timeout: job['timeout-minutes'], steps };
}

export function selectNativeArtifact(evidence, target) {
  assert.ok(nativeJobs[target], 'Unsupported native target');
  const jobs = evidence.jobs.filter((job) => job.name === nativeJobs[target]);
  assert.ok(jobs.length, 'Missing native producer');
  for (const job of jobs) {
    assert.equal(job.run_id, evidence.runId);
    assert.equal(job.head_sha, evidence.runSha);
    assert.ok(
      Number.isSafeInteger(job.run_attempt) &&
        job.run_attempt > 0 &&
        job.run_attempt <= evidence.attempt,
    );
  }
  const attempt = Math.max(...jobs.map((job) => job.run_attempt));
  const newest = jobs.filter((job) => job.run_attempt === attempt);
  assert.equal(newest.length, 1, 'Ambiguous newest native producer');
  assert.equal(newest[0].status, 'completed');
  assert.equal(
    newest[0].conclusion,
    'success',
    'Newest native producer must pass; no fallback to earlier success',
  );
  const completed = Date.parse(newest[0].completed_at);
  assert.ok(
    Number.isFinite(completed) &&
      completed <= Date.now() &&
      Date.now() - completed <= 24 * 60 * 60_000,
    'Native retention is restricted to original qualification completed in the last 24 hours',
  );
  const name = `native-production-${target.startsWith('linux-') ? 'release-' : ''}${target}-${evidence.runId}-attempt-${attempt}`;
  const artifacts = evidence.artifacts.filter((artifact) => artifact.name === name);
  assert.equal(artifacts.length, 1, 'Exactly one original native evidence artifact is required');
  const artifact = artifacts[0];
  assert.ok(Number.isSafeInteger(artifact.id) && artifact.id > 0);
  assert.equal(artifact.expired, false);
  assert.equal(artifact.workflow_run?.id, evidence.runId);
  assert.equal(artifact.workflow_run?.head_sha, evidence.runSha);
  assert.match(artifact.digest ?? '', /^sha256:[a-f0-9]{64}$/);
  assert.ok(artifact.size_in_bytes > 0 && artifact.size_in_bytes <= 1024 ** 3);
  return { id: artifact.id, name, digest: artifact.digest, attempt, jobId: newest[0].id };
}

export function verifyNativeRunnerImage(log, currentVersion) {
  assert.match(
    currentVersion ?? '',
    /^\d{8}\.[\d.]+$/,
    'Current hosted runner image version must be available',
  );
  const groups = [...log.matchAll(/##\[group\]Runner Image\r?\n([\s\S]*?)##\[endgroup\]/g)];
  assert.equal(groups.length, 1, 'One actual original runner image block is required');
  const image = /\bImage: ([^\r\n]+)/.exec(groups[0][1])?.[1];
  const version = /\bVersion: ([^\r\n]+)/.exec(groups[0][1])?.[1];
  assert.ok(image && version, 'Original native runner image/version must be recorded');
  assert.equal(version, currentVersion, 'Hosted runner image changed; execute this target again');
  return { image, version };
}

function git(args) {
  return execFileSync('git', args, { encoding: 'utf8', maxBuffer: 16 * 1024 ** 2 });
}
function fingerprint(sha, target) {
  assert.match(sha, SHA);
  const rows = git(['ls-tree', '-r', sha])
    .trim()
    .split('\n')
    .map((line) => {
      const [metadata, path] = line.split('\t');
      return { path, metadata };
    });
  const paths = nativeRuntimePaths(
    rows.map((row) => row.path),
    target,
  );
  const blobs = rows.filter((row) => paths.includes(row.path));
  assert.ok(
    blobs.some(
      (row) => row.path === `scripts/release/production/${target.split('-')[0]}-production.mjs`,
    ),
  );
  const workflow = nativeWorkflowContract(
    git(['show', `${sha}:.github/workflows/release.yml`]),
    target,
  );
  return hash(JSON.stringify({ blobs, workflow }));
}

/** Forward slashes are accepted by all three hosts and keep evidence matching portable. */
export function canonicalEvidencePath(path) {
  return path.replaceAll('\\', '/');
}

function files(dir, depth = 0) {
  assert.ok(depth < 32, 'Native evidence exceeds directory depth bound');
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    assert.ok(!entry.isSymbolicLink(), 'Native evidence may not contain links');
    const path = canonicalEvidencePath(join(dir, entry.name));
    return entry.isDirectory() ? files(path, depth + 1) : [path];
  });
}
export function verifyNativeReports(dir, { sourceSha, version, schema = '2.33' }) {
  const reports = files(dir).filter((path) => path.endsWith('/qualification.json'));
  assert.equal(reports.length, 2, 'One baseline and one current native report required');
  const currentPath = reports.find((path) => path.includes('/current-document/'));
  const oldPath = reports.find((path) => path.includes('/old-document/'));
  assert.ok(currentPath && oldPath);
  const current = JSON.parse(readFileSync(currentPath)),
    old = JSON.parse(readFileSync(oldPath));
  assert.equal(current.passed, true);
  assert.equal(old.passed, true);
  assert.ok(!current.error && !old.error);
  assert.equal(current.sourceSha, sourceSha);
  assert.deepEqual(current.expected, { version, schema });
  assert.equal(old.baselineTag, 'v0.2.1');
  assert.deepEqual(old.expected, { version: '0.2.1', schema: '2.21' });
  assert.ok(current.appDataDirectory);
  assert.equal(current.appDataDirectory, old.appDataDirectory);
  const directory = resolve(currentPath, '..');
  for (const format of ['png', 'svg', 'pdf']) {
    const entries = current.evidence.filter(
      (entry) => entry.phase === `actual native ${format.toUpperCase()} output`,
    );
    assert.equal(entries.length, 1);
    const bytes = readFileSync(join(directory, `native-export.${format}`));
    assert.equal(bytes.length, entries[0].bytes);
    assert.equal(hash(bytes), entries[0].sha256);
  }
  const reopen = current.evidence.filter(
    (entry) => entry.phase === 'native process restart and disk reopen',
  );
  assert.equal(reopen.length, 1);
  const saved = readFileSync(join(directory, 'Migrated save β.varve'));
  assert.equal(hash(saved), reopen[0].savedSha256);
  assert.equal(String(JSON.parse(saved).formatVersion), schema);
  for (const name of ['native-reopened.png', 'native-export-pdf-render.png'])
    assert.ok(lstatSync(join(directory, name)).isFile());
  return {
    currentReportSha256: hash(readFileSync(currentPath)),
    baselineReportSha256: hash(readFileSync(oldPath)),
  };
}

async function select(args) {
  const identity = await loadReusableRun({
    repository: args.repo,
    runId: args['run-id'],
    workflowSha: args.sha,
    sourceSha: args['source-sha'],
    token: process.env.GITHUB_TOKEN,
  });
  assert.equal(
    git(['rev-parse', 'HEAD']).trim(),
    args.sha,
    'Retention tooling must be the exact workflow checkout',
  );
  // Fetch the exact accepted producer, never a moving branch or a mutable cache.
  git(['fetch', '--no-tags', '--depth=1', 'origin', identity.runSha]);
  const producerFingerprint = fingerprint(identity.runSha, args.target);
  assert.equal(
    fingerprint(args.sha, args.target),
    producerFingerprint,
    'Native runtime/runner contract changed; execute this target again',
  );
  const evidence = await loadRunArtifacts({
    repository: args.repo,
    ...identity,
    token: process.env.GITHUB_TOKEN,
  });
  const native = selectNativeArtifact(evidence, args.target);
  const log = execFileSync('gh', ['api', `repos/${args.repo}/actions/jobs/${native.jobId}/logs`], {
    encoding: 'utf8',
    maxBuffer: 16 * 1024 ** 2,
  });
  const runnerImage = verifyNativeRunnerImage(log, process.env.ImageVersion);
  const bundle = selectRunArtifacts({ ...evidence, targets: [args.target] })[0];
  const bundleArtifact = evidence.artifacts.find((entry) => entry.id === bundle.id);
  assert.match(bundleArtifact.digest ?? '', /^sha256:[a-f0-9]{64}$/);
  return {
    producerRunId: identity.runId,
    producerWorkflowSha: identity.runSha,
    sourceSha: args['source-sha'],
    target: args.target,
    fingerprint: producerFingerprint,
    native,
    runnerImage,
    bundle: { ...bundle, digest: bundleArtifact.digest },
  };
}

export function verifyInstallerSource(dir, selected) {
  const paths = files(dir).filter((path) =>
    path.endsWith(`/retained-platform-source-${selected.target}.json`),
  );
  assert.equal(
    paths.length,
    1,
    'One original installer adoption receipt is required, including nested artifact layouts',
  );
  const installer = JSON.parse(readFileSync(paths[0]));
  assert.equal(installer.runId, selected.producerRunId);
  assert.equal(installer.runSha, selected.producerWorkflowSha);
  assert.equal(installer.target, selected.target);
  assert.equal(installer.artifactId, selected.bundle.id);
  assert.equal(installer.digest, selected.bundle.digest);
}

async function main() {
  const [mode, ...argv] = process.argv.slice(2);
  const { values: args } = parseArgs({
    args: argv,
    options: Object.fromEntries(
      [
        'repo',
        'run-id',
        'sha',
        'source-sha',
        'target',
        'dir',
        'installer-dir',
        'selection',
        'version',
        'bundle-run-id',
        'bundle-targets',
      ].map((name) => [name, { type: 'string' }]),
    ),
  });
  assert.ok(['select', 'verify'].includes(mode), 'Expected inputs, select or verify');
  const selected = await select(args);
  if (mode === 'select') {
    writeFileSync(args.selection, JSON.stringify(selected, null, 2) + '\n');
    appendFileSync(process.env.GITHUB_OUTPUT, `artifact_ids=${selected.native.id}\n`);
    return;
  }
  assert.deepEqual(
    selected,
    JSON.parse(readFileSync(args.selection)),
    'Native producer changed during download; do not retain superseded evidence',
  );
  verifyInstallerSource(args['installer-dir'], selected);
  const reports = verifyNativeReports(args.dir, {
    sourceSha: selected.sourceSha,
    version: args.version,
  });
  if (args.target.startsWith('macos-')) {
    const snapshots = files(args.dir).filter((path) =>
      path.endsWith('/current-document/profile-after-session.json'),
    );
    assert.equal(
      snapshots.length,
      1,
      'Retained Mac qualification requires its actual clean-exit diagnostic',
    );
    execFileSync(
      'python3',
      ['scripts/release/production/macos-profile-snapshot.py', '--check-current', snapshots[0]],
      { stdio: 'pipe' },
    );
  }
  writeFileSync(
    join(args.dir, 'retained-native-provenance.json'),
    JSON.stringify(
      {
        ...selected,
        ...reports,
        consumerWorkflowSha: args.sha,
        reused: true,
        originalReportsUnmodified: true,
      },
      null,
      2,
    ) + '\n',
  );
  console.log(
    `Retained ${args.target} from original native run ${selected.producerRunId}, artifact ${selected.native.id}; unchanged platform contract and exact original installer artifact ${selected.bundle.id}.`,
  );
}
if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href)
  main().catch((error) => {
    console.error(error.message);
    process.exitCode = 1;
  });
