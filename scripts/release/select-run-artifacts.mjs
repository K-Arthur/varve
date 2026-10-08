#!/usr/bin/env node
/** Select verified release artifacts from explicit successful workflow producers. */
import { appendFileSync, lstatSync, readdirSync, readFileSync, writeFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { collectResumableArtifacts, RELEASE_TARGETS } from './resume.mjs';

const SHA = /^[0-9a-f]{40}$/;
const POLICY = /^[0-9a-f]{64}$/;

function positiveInteger(value, label) {
  if (!['string', 'number'].includes(typeof value) || !/^[1-9][0-9]*$/.test(String(value))) {
    throw new Error(`Invalid ${label}`);
  }
  const number = Number(value);
  if (!Number.isSafeInteger(number) || number < 1) throw new Error(`Invalid ${label}`);
  return number;
}

export function resolveReuseInputs({ runId = '', targets = '', windows = 'true', macos = 'true' }) {
  if (!runId && !targets) return { runId: '', targets: [] };
  if (!runId || !targets) throw new Error('Reuse requires both a run ID and explicit target list');
  const id = positiveInteger(runId, 'reuse run ID');
  const selected = requestedTargets(targets);
  const enabled = requestedTargets('all', { windows, macos });
  if (selected.some((target) => !enabled.includes(target)))
    throw new Error('Reuse targets must belong to this requested platform selection');
  return { runId: String(id), targets: selected };
}

export function nativeReuseInputs({
  runId = '',
  targets = '',
  bundleRunId = '',
  bundleTargets = [],
  windows = 'true',
  macos = 'true',
}) {
  if (!runId && !targets) return { runId: '', targets: [] };
  positiveInteger(runId, 'native retention run ID');
  const selected = requestedTargets(targets, { windows, macos });
  const enabled = requestedTargets('all', { windows, macos });
  if (String(runId) !== String(bundleRunId))
    throw new Error('Native and installer retention must use the same producer run');
  if (!selected.every((t) => enabled.includes(t) && bundleTargets.includes(t)))
    throw new Error('Retained native targets require the same retained installers');
  return { runId: String(runId), targets: selected };
}

/** Explicit adoption preserves bytes, not trust in a mutable cache or branch. */
export async function loadReusableRun({
  repository,
  runId,
  workflowSha,
  sourceSha,
  token,
  request = fetch,
}) {
  runId = positiveInteger(runId, 'reuse run ID');
  if (
    !/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') ||
    !token ||
    !SHA.test(workflowSha ?? '') ||
    !SHA.test(sourceSha ?? '')
  )
    throw new Error('Reuse requires repository, token and exact workflow/product SHAs');
  async function get(path) {
    const response = await request(`https://api.github.com/repos/${repository}/${path}`, {
      headers: { Authorization: `Bearer ${token}`, Accept: 'application/vnd.github+json' },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Reuse evidence API returned HTTP ${response.status}`);
    return response.json();
  }
  const run = await get(`actions/runs/${runId}`);
  if (
    run.id !== runId ||
    run.path !== '.github/workflows/release.yml' ||
    run.head_repository?.full_name !== repository ||
    run.head_branch !== 'master' ||
    run.event !== 'workflow_dispatch' ||
    run.status !== 'completed' ||
    !['success', 'failure', 'cancelled'].includes(run.conclusion) ||
    !SHA.test(run.head_sha ?? '') ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1
  )
    throw new Error('Reuse requires a completed master Release dispatch in this repository');
  const master = await get('branches/master');
  if (master.name !== 'master' || !SHA.test(master.commit?.sha ?? ''))
    throw new Error('Reuse cannot establish accepted master source');
  for (const [base, head] of [
    [sourceSha, run.head_sha],
    [run.head_sha, workflowSha],
    [workflowSha, master.commit.sha],
  ]) {
    const comparison = await get(`compare/${base}...${head}`);
    if (
      !['ahead', 'identical'].includes(comparison.status) ||
      comparison.base_commit?.sha !== base ||
      comparison.merge_base_commit?.sha !== base
    )
      throw new Error('Reuse source and workflows must belong to accepted master ancestry');
  }
  return { runId, runSha: run.head_sha, attempt: run.run_attempt };
}

export function requestedTargets(value, { windows = 'true', macos = 'true' } = {}) {
  if (!['true', 'false'].includes(windows) || !['true', 'false'].includes(macos)) {
    throw new Error('Platform switches must be true or false');
  }
  const targets =
    value === 'all'
      ? RELEASE_TARGETS.filter(
          (target) =>
            (!target.startsWith('windows-') || windows === 'true') &&
            (!target.startsWith('macos-') || macos === 'true'),
        )
      : value?.split(',');
  if (
    !targets?.length ||
    new Set(targets).size !== targets.length ||
    targets.some((target) => target !== 'final' && !RELEASE_TARGETS.includes(target)) ||
    (targets.includes('final') && targets.length !== 1)
  ) {
    throw new Error('A unique supported release target list or final is required');
  }
  return targets;
}

function producerName(target) {
  return target === 'final' ? 'Verify, attest and finalize' : `Bundle (${target})`;
}

export function selectRunArtifacts({ artifacts, jobs, runId, runSha, attempt, targets }) {
  runId = positiveInteger(runId, 'workflow run ID');
  attempt = positiveInteger(attempt, 'workflow attempt');
  if (!SHA.test(runSha ?? '')) throw new Error('Invalid workflow head SHA');
  requestedTargets(targets?.join(','));
  if (!Array.isArray(artifacts) || !Array.isArray(jobs)) throw new Error('Missing run evidence');
  for (const artifact of artifacts) {
    const uploadAttempt = artifact.name?.match(
      /^release-(?:linux|windows|macos|final).*?-attempt-([1-9][0-9]*)$/,
    )?.[1];
    if (uploadAttempt && Number(uploadAttempt) > attempt) {
      throw new Error('Release upload comes from a future workflow attempt');
    }
  }
  return targets.map((target) => {
    const producers = jobs.filter((job) => job.name === producerName(target));
    if (!producers.length) throw new Error(`Missing producer for ${target}`);
    for (const job of producers) {
      if (
        job.run_id !== runId ||
        job.head_sha !== runSha ||
        !Number.isSafeInteger(job.run_attempt) ||
        job.run_attempt < 1 ||
        job.run_attempt > attempt
      ) {
        throw new Error(`Producer identity or attempt mismatch for ${target}`);
      }
    }
    const latest = Math.max(...producers.map((job) => job.run_attempt));
    const newest = producers.filter((job) => job.run_attempt === latest);
    if (
      newest.length !== 1 ||
      newest[0].status !== 'completed' ||
      newest[0].conclusion !== 'success'
    ) {
      throw new Error(`Newest producer attempt ${latest} is not uniquely successful for ${target}`);
    }
    const name = `release-${target}-attempt-${latest}`;
    const candidates = artifacts.filter((artifact) => artifact.name === name);
    if (candidates.length !== 1) throw new Error(`Expected exactly one ${name} upload`);
    const artifact = candidates[0];
    if (
      !Number.isSafeInteger(artifact.id) ||
      artifact.id < 1 ||
      artifact.expired !== false ||
      artifact.workflow_run?.id !== runId ||
      artifact.workflow_run?.head_sha !== runSha
    ) {
      throw new Error(`Artifact identity, expiry or ID mismatch for ${name}`);
    }
    return { id: artifact.id, name, target, attempt: latest };
  });
}

/** API identity selects the run; these sidecars bind actual installer bytes to the tag. */
export function verifyDownloadedArtifacts(dir, { version, commitSha, policyHash, targets }) {
  if (!version || !SHA.test(commitSha ?? '') || !POLICY.test(policyHash ?? '')) {
    throw new Error('Version, tagged SHA and policy hash are required for downloaded bytes');
  }
  requestedTargets(targets?.join(','));
  if (targets.includes('final'))
    throw new Error('Installer target list required for byte verification');
  const directories = lstatSync(join(dir, 'release-manifest.json'), {
    throwIfNoEntry: false,
  })?.isFile()
    ? [dir]
    : readdirSync(dir, { withFileTypes: true })
        .filter((entry) => entry.isDirectory())
        .map((entry) => join(dir, entry.name));
  const seenTargets = new Set();
  const seenFiles = new Set();
  for (const directory of directories) {
    const manifest = JSON.parse(readFileSync(join(directory, 'release-manifest.json'), 'utf8'));
    if (
      manifest.version !== version ||
      !Array.isArray(manifest.artifacts) ||
      !manifest.artifacts.length
    ) {
      throw new Error('Downloaded manifest version or installer set mismatch');
    }
    const result = collectResumableArtifacts(directory, { version, commitSha, policyHash });
    if (!result.ok) throw new Error(`Downloaded provenance rejected: ${result.errors.join('; ')}`);
    const metadata = new Map(
      result.entries.map((entry) => [entry.metadata.artifact, entry.metadata]),
    );
    if (metadata.size !== manifest.artifacts.length)
      throw new Error('Installer and provenance sets differ');
    for (const installer of manifest.artifacts) {
      const target = `${installer.os}-${installer.arch}`;
      const record = metadata.get(installer.filename);
      if (
        !targets.includes(target) ||
        !record ||
        record.platform !== target ||
        installer.sha256 !== record.sha256 ||
        seenFiles.has(installer.filename)
      ) {
        throw new Error(`Unexpected, duplicate or unverified installer ${installer.filename}`);
      }
      seenTargets.add(target);
      seenFiles.add(installer.filename);
    }
  }
  for (const target of targets) {
    if (!seenTargets.has(target)) throw new Error(`Missing downloaded installer target ${target}`);
  }
  return seenFiles.size;
}

export async function loadRunArtifacts({
  repository,
  runId,
  runSha,
  attempt,
  token,
  request = fetch,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? '') || !token) {
    throw new Error('Repository and Actions read token are required');
  }
  runId = positiveInteger(runId, 'workflow run ID');
  attempt = positiveInteger(attempt, 'workflow attempt');
  if (!SHA.test(runSha ?? '')) throw new Error('Invalid workflow head SHA');
  const base = `https://api.github.com/repos/${repository}/actions/runs/${runId}`;
  async function get(url) {
    const response = await request(url, {
      headers: {
        Authorization: `Bearer ${token}`,
        Accept: 'application/vnd.github+json',
        'X-GitHub-Api-Version': '2022-11-28',
      },
      signal: AbortSignal.timeout(30_000),
    });
    if (!response.ok) throw new Error(`Actions evidence API returned HTTP ${response.status}`);
    return response.json();
  }
  const run = await get(base);
  if (run.id !== runId || run.head_sha !== runSha || run.run_attempt !== attempt) {
    throw new Error('Workflow run identity or current attempt mismatch');
  }
  async function pages(resource, field, query = '') {
    const collected = [];
    for (let page = 1; page <= 100; page += 1) {
      const data = await get(`${base}/${resource}?${query}per_page=100&page=${page}`);
      if (!Array.isArray(data[field])) throw new Error(`Missing ${field} in Actions evidence`);
      collected.push(...data[field]);
      if (data[field].length < 100) return collected;
    }
    throw new Error('Actions evidence exceeds pagination limit');
  }
  const [artifacts, jobs] = await Promise.all([
    pages('artifacts', 'artifacts'),
    pages('jobs', 'jobs', 'filter=all&'),
  ]);
  return { artifacts, jobs, runId, runSha, attempt };
}

function parseArgs(args) {
  const values = {};
  const allowed = new Set([
    'dir',
    'version',
    'sha',
    'policy-hash',
    'targets',
    'windows',
    'macos',
    'repo',
    'run-id',
    'attempt',
    'source-sha',
    'expected-artifact-id',
    'record-source',
  ]);
  for (let index = 0; index < args.length; index += 2) {
    const key = args[index]?.replace(/^--/, '');
    if (
      !args[index]?.startsWith('--') ||
      !allowed.has(key) ||
      !args[index + 1] ||
      values[key] !== undefined
    ) {
      throw new Error('Invalid or duplicate selector argument');
    }
    values[key] = args[index + 1];
  }
  return values;
}

async function main() {
  const [mode, ...argv] = process.argv.slice(2);
  const args = parseArgs(argv);
  if (mode === 'native-reuse-inputs') {
    const reuse = nativeReuseInputs({
      runId: process.env.VARVE_NATIVE_REUSE_RUN_ID,
      targets: process.env.VARVE_NATIVE_REUSE_TARGETS,
      bundleRunId: process.env.VARVE_REUSE_RUN_ID,
      bundleTargets: JSON.parse(process.env.VARVE_REUSE_TARGETS_JSON),
      windows: args.windows ?? 'true',
      macos: args.macos ?? 'true',
    });
    const outputs = `native_reuse_run_id=${reuse.runId}\nnative_reuse_targets=${JSON.stringify(reuse.targets)}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
    else process.stdout.write(outputs);
    return;
  }
  if (mode === 'reuse-inputs') {
    const reuse = resolveReuseInputs({
      runId: process.env.VARVE_REUSE_RUN_ID,
      targets: process.env.VARVE_REUSE_TARGETS,
      windows: args.windows ?? 'true',
      macos: args.macos ?? 'true',
    });
    const outputs = `reuse_run_id=${reuse.runId}\nreuse_targets=${JSON.stringify(reuse.targets)}\n`;
    if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
    else process.stdout.write(outputs);
    return;
  }
  const targets = requestedTargets(args.targets, {
    windows: args.windows ?? 'true',
    macos: args.macos ?? 'true',
  });
  if (mode === 'verify') {
    const count = verifyDownloadedArtifacts(resolve(args.dir ?? 'staged'), {
      version: args.version,
      commitSha: args.sha,
      policyHash: args['policy-hash'],
      targets,
    });
    console.log(
      `Verified ${count} downloaded installer(s) against the exact tagged SHA and policy.`,
    );
    return;
  }
  if (!['select', 'select-reuse'].includes(mode))
    throw new Error('Expected select, select-reuse or verify mode');
  if (mode === 'select-reuse' && targets.includes('final'))
    throw new Error('Reuse adopts platform bytes; final trust and attestation must run again');
  const identity =
    mode === 'select-reuse'
      ? await loadReusableRun({
          repository: args.repo,
          runId: args['run-id'],
          workflowSha: args.sha,
          sourceSha: args['source-sha'],
          token: process.env.GITHUB_TOKEN,
        })
      : { runId: args['run-id'], runSha: args.sha, attempt: args.attempt };
  const evidence = await loadRunArtifacts({
    repository: args.repo,
    ...identity,
    token: process.env.GITHUB_TOKEN,
  });
  const selected = selectRunArtifacts({ ...evidence, targets });
  if (
    args['expected-artifact-id'] &&
    (selected.length !== 1 ||
      selected[0].id !== positiveInteger(args['expected-artifact-id'], 'expected artifact ID'))
  )
    throw new Error(
      'Reuse producer changed while downloading; select its latest successful bytes again',
    );
  if (args['record-source']) {
    if (mode !== 'select-reuse' || selected.length !== 1)
      throw new Error('Source receipt requires one retained platform');
    const artifact = evidence.artifacts.find((entry) => entry.id === selected[0].id);
    if (!/^sha256:[a-f0-9]{64}$/.test(artifact.digest ?? ''))
      throw new Error('Retained source digest is required');
    writeFileSync(
      args['record-source'],
      JSON.stringify(
        {
          runId: evidence.runId,
          runSha: evidence.runSha,
          artifactId: artifact.id,
          digest: artifact.digest,
          target: selected[0].target,
        },
        null,
        2,
      ) + '\n',
    );
  }
  const outputs = `artifact_ids=${selected.map((artifact) => artifact.id).join(',')}\ntargets=${targets.join(',')}\n`;
  if (process.env.GITHUB_OUTPUT) appendFileSync(process.env.GITHUB_OUTPUT, outputs);
  else process.stdout.write(outputs);
  for (const artifact of selected) console.log(`Selected ${artifact.name} (ID ${artifact.id}).`);
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  main().catch((error) => {
    console.error(`Release artifact selection failed: ${error.message}`);
    process.exitCode = 1;
  });
}
