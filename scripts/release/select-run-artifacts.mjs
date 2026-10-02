#!/usr/bin/env node
/** Select immutable release artifacts from successful attempts of one workflow run. */
import { appendFileSync, lstatSync, readdirSync, readFileSync } from 'node:fs';
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
  if (mode !== 'select') throw new Error('Expected select or verify mode');
  const evidence = await loadRunArtifacts({
    repository: args.repo,
    runId: args['run-id'],
    runSha: args.sha,
    attempt: args.attempt,
    token: process.env.GITHUB_TOKEN,
  });
  const selected = selectRunArtifacts({ ...evidence, targets });
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
