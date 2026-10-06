#!/usr/bin/env node
/**
 * Verify the actual GitHub draft immediately before explicit publication.
 * The attested checksum file authenticates all downloaded bytes; its verified
 * signing certificate binds them to the tag workflow or an explicitly verified
 * master recovery run. Authenticated installer sidecars separately bind product
 * bytes to the certified tag. This helper never publishes or changes a release.
 */
import { execFileSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import { lstatSync, mkdirSync, mkdtempSync, readdirSync, readFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { isDeepStrictEqual } from 'node:util';
import { collectResumableArtifacts } from './resume.mjs';
import {
  readSigningReports,
  signingStateFromReport,
  verifyReleaseTrust,
} from './signing-policy.mjs';
import { normalizeArchitecture, RELEASE_TARGETS } from './targets.mjs';
import { parseChecksums, verifyReleaseIntegrity } from './verify-release-data.mjs';

const scriptDir = import.meta.dirname;
const SAFE_NAME = /^[A-Za-z0-9][A-Za-z0-9._-]*$/;

function sha256(path) {
  return createHash('sha256').update(readFileSync(path)).digest('hex');
}

function readJSON(path) {
  return JSON.parse(readFileSync(path, 'utf8'));
}

function runCommand(command, args) {
  try {
    return execFileSync(command, args, {
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      maxBuffer: 16 * 1024 * 1024,
    });
  } catch (error) {
    // Downloader diagnostics can contain temporary credential-bearing URLs.
    const detail = String(error.stderr ?? '')
      .replace(/https?:\/\/\S+/g, '[redacted URL]')
      .trim();
    throw new Error(
      `${command} ${args[0]} failed (exit ${error.status ?? 'unknown'}): ${detail.slice(0, 1500)}`,
    );
  }
}

export function requiredTargets(platforms = 'all') {
  const selections = {
    linux: ['linux'],
    'linux-windows': ['linux', 'windows'],
    all: ['linux', 'windows', 'macos'],
  };
  const os = selections[platforms];
  if (!os) throw new Error(`Invalid platform selection: ${platforms}`);
  return RELEASE_TARGETS.filter((target) => os.includes(target.os));
}

function validateOptions({
  repository,
  tag,
  commitSha,
  policyHash,
  platforms,
  expectSigned,
  requireUpdater,
  buildRunId,
  trustedWorkflowSha,
}) {
  if (!/^[A-Za-z0-9_.-]+\/[A-Za-z0-9_.-]+$/.test(repository ?? ''))
    throw new Error('Invalid repository');
  if (!/^v\d+\.\d+\.\d+(?:-[A-Za-z0-9.-]+)?$/.test(tag ?? ''))
    throw new Error('Invalid release tag');
  if (!/^[0-9a-f]{40}$/.test(commitSha ?? ''))
    throw new Error('Expected exact 40-character source SHA');
  if (!/^[0-9a-f]{64}$/.test(policyHash ?? ''))
    throw new Error('Expected certification policy SHA-256');
  if (
    typeof expectSigned !== 'boolean' ||
    (requireUpdater !== undefined && typeof requireUpdater !== 'boolean')
  )
    throw new Error('Signing and updater policy inputs must be booleans');
  requiredTargets(platforms);
  if (buildRunId !== undefined) {
    if (!/^[1-9][0-9]*$/.test(String(buildRunId)) || !Number.isSafeInteger(Number(buildRunId)))
      throw new Error('Expected a positive safe recovery build run ID');
    if (!/^[0-9a-f]{40}$/.test(trustedWorkflowSha ?? ''))
      throw new Error('Recovery requires the exact trusted publication workflow SHA');
  } else if (trustedWorkflowSha !== undefined) {
    throw new Error('Trusted workflow SHA requires an explicit recovery build run ID');
  }
}

/** Recovery is opt-in: API identity and accepted ancestry establish the signer. */
export function verifyRecoveryBuild(run, options) {
  const url = `https://github.com/${options.repository}/actions/runs/${options.buildRunId}`;
  if (
    run?.id !== Number(options.buildRunId) ||
    run.head_repository?.full_name !== options.repository ||
    run.path !== '.github/workflows/release.yml' ||
    run.event !== 'workflow_dispatch' ||
    run.head_branch !== 'master' ||
    !/^[0-9a-f]{40}$/.test(run.head_sha ?? '') ||
    run.html_url !== url ||
    !Number.isSafeInteger(run.run_attempt) ||
    run.run_attempt < 1 ||
    run.status !== 'completed' ||
    run.conclusion !== 'success'
  )
    throw new Error('Recovery build is not an exact successful master Release run');
  return {
    workflowSha: run.head_sha,
    signerRef: 'refs/heads/master',
    invocation: `${url}/attempts/${run.run_attempt}`,
  };
}

function verifyAncestor(base, head, options, run) {
  const comparison = JSON.parse(
    run('gh', ['api', `repos/${options.repository}/compare/${base}...${head}`]),
  );
  if (
    !['ahead', 'identical'].includes(comparison.status) ||
    comparison.base_commit?.sha !== base ||
    comparison.merge_base_commit?.sha !== base
  )
    throw new Error('Recovery workflow and product must belong to accepted master ancestry');
}

function loadRecoveryBuild(options, run) {
  if (options.buildRunId === undefined) return undefined;
  const build = JSON.parse(
    run('gh', ['api', `repos/${options.repository}/actions/runs/${options.buildRunId}`]),
  );
  const binding = verifyRecoveryBuild(build, options);
  const master = JSON.parse(run('gh', ['api', `repos/${options.repository}/branches/master`]));
  if (master.name !== 'master' || !/^[0-9a-f]{40}$/.test(master.commit?.sha ?? ''))
    throw new Error('Cannot establish accepted master source identity');
  verifyAncestor(options.commitSha, binding.workflowSha, options, run);
  verifyAncestor(binding.workflowSha, options.trustedWorkflowSha, options, run);
  verifyAncestor(options.trustedWorkflowSha, master.commit.sha, options, run);
  return binding;
}

export function draftFingerprint(release, tag) {
  if (release?.tag_name !== tag || release.draft !== true || release.published_at != null) {
    throw new Error(`Expected an unpublished draft for ${tag}`);
  }
  if (
    !Number.isSafeInteger(release.id) ||
    !Array.isArray(release.assets) ||
    !release.assets.length
  ) {
    throw new Error('Draft has no valid release identity or assets');
  }
  const names = new Set();
  const assets = release.assets
    .map((asset) => {
      if (!SAFE_NAME.test(asset.name ?? '') || asset.name.includes('..') || names.has(asset.name)) {
        throw new Error(`Unsafe or duplicate draft asset name: ${JSON.stringify(asset.name)}`);
      }
      names.add(asset.name);
      if (
        asset.state !== 'uploaded' ||
        !Number.isSafeInteger(asset.id) ||
        !Number.isSafeInteger(asset.size) ||
        asset.size <= 0
      ) {
        throw new Error(`Draft asset is incomplete: ${asset.name}`);
      }
      return {
        id: asset.id,
        name: asset.name,
        size: asset.size,
        digest: asset.digest ?? null,
        updated_at: asset.updated_at,
      };
    })
    .sort((a, b) => a.name.localeCompare(b.name));
  return JSON.stringify({ id: release.id, tag, prerelease: release.prerelease, assets });
}

export function verifyChecksumAttestation(
  results,
  { repository, commitSha, checksumsPath, recovery },
) {
  const digest = sha256(checksumsPath);
  const signer = `https://github.com/${repository}/.github/workflows/release.yml@`;
  const verified =
    Array.isArray(results) &&
    results.some(({ verificationResult }) => {
      const certificate = verificationResult?.signature?.certificate;
      return (
        certificate?.issuer === 'https://token.actions.githubusercontent.com' &&
        certificate.sourceRepositoryURI === `https://github.com/${repository}` &&
        certificate.sourceRepositoryDigest === (recovery?.workflowSha ?? commitSha) &&
        (recovery
          ? certificate.buildSignerURI === `${signer}${recovery.signerRef}` &&
            certificate.buildSignerDigest === recovery.workflowSha &&
            certificate.sourceRepositoryRef === recovery.signerRef &&
            certificate.runInvocationURI === recovery.invocation
          : certificate.buildSignerURI?.startsWith(signer)) &&
        verificationResult.statement?.subject?.some(
          (subject) => subject.name === 'SHA256SUMS.txt' && subject.digest?.sha256 === digest,
        )
      );
    });
  if (!verified)
    throw new Error('Checksum attestation does not authenticate the requested exact source SHA');
}

function verifyDownloadedInventory(dir, release) {
  const actual = readdirSync(dir).sort();
  const expected = release.assets.map((asset) => asset.name).sort();
  if (!isDeepStrictEqual(actual, expected))
    throw new Error('Downloaded files differ from the draft asset inventory');
  for (const asset of release.assets) {
    const stat = lstatSync(join(dir, asset.name));
    if (!stat.isFile() || stat.size !== asset.size)
      throw new Error(`Downloaded asset is not a complete regular file: ${asset.name}`);
  }
}

function verifyTargetCoverage(artifacts, targets) {
  for (const target of targets) {
    const present = artifacts.filter(
      (artifact) =>
        artifact.os === target.os && normalizeArchitecture(artifact.arch) === target.architecture,
    );
    for (const format of target.packageFormats) {
      if (!present.some((artifact) => artifact.format === format))
        throw new Error(`Missing required ${target.id} ${format} installer`);
    }
  }
}

function verifyProvenance(dir, artifacts, options) {
  const result = collectResumableArtifacts(dir, {
    version: options.tag.slice(1),
    commitSha: options.commitSha,
    policyHash: options.policyHash,
  });
  if (!result.ok) throw new Error(`Draft provenance rejected: ${result.errors.join('; ')}`);
  const byName = new Map(result.entries.map(({ metadata }) => [metadata.artifact, metadata]));
  if (byName.size !== artifacts.length)
    throw new Error('Draft installer and provenance sets differ');
  for (const artifact of artifacts) {
    const metadata = byName.get(artifact.filename);
    if (
      !metadata ||
      metadata.sha256 !== artifact.sha256 ||
      metadata.platform !== `${artifact.os}-${normalizeArchitecture(artifact.arch)}`
    ) {
      throw new Error(
        `Draft installer does not match its exact-SHA provenance: ${artifact.filename}`,
      );
    }
  }
}

function verifySigning(dir, manifest, options) {
  const reports = readSigningReports(dir);
  for (const platform of new Set(manifest.artifacts.map((artifact) => artifact.os))) {
    if (platform === 'linux') continue;
    const state = signingStateFromReport({ platform, report: reports[platform] });
    if (
      !state ||
      reports[platform]?.error ||
      !isDeepStrictEqual(manifest.signing?.[platform], state)
    ) {
      throw new Error(`Draft ${platform} signing labels do not match the verification report`);
    }
  }
  const result = verifyReleaseTrust({
    channel: options.channel,
    expectSigned: options.expectSigned,
    manifest,
    reports,
  });
  if (result.problems.length)
    throw new Error(`Draft signing policy rejected: ${result.problems.join('; ')}`);
}

function verifySbomIdentity(path, options) {
  const sbom = readJSON(path);
  const component = sbom.metadata?.component;
  const commit = sbom.metadata?.properties?.find(
    (property) => property.name === 'varve:gitCommit',
  )?.value;
  if (component?.version !== options.tag.slice(1) || commit !== options.commitSha) {
    throw new Error(`SBOM version or source SHA mismatch: ${path}`);
  }
}

function verifySizeReports(dir, artifacts) {
  for (const artifact of artifacts.filter(
    (entry) => entry.os === 'windows' && entry.format === 'nsis',
  )) {
    const evidence = readJSON(
      join(dir, `installer-size-report-windows-${normalizeArchitecture(artifact.arch)}.json`),
    );
    const report = evidence.installers?.find((entry) => entry.filename === artifact.filename);
    if (evidence.schemaVersion !== 1 || !report)
      throw new Error(`Missing installer-size evidence: ${artifact.filename}`);
    const accepted = ['ok', 'warn', 'block-overridden'].includes(report.status);
    if (
      !accepted ||
      (report.status === 'block-overridden' && !report.overrideReason?.trim()) ||
      report.filename !== artifact.filename ||
      report.sizeBytes !== artifact.sizeBytes
    ) {
      throw new Error(`Missing or unsuccessful installer-size evidence: ${artifact.filename}`);
    }
  }
}

function expectedUpdaterTargets(artifacts, options) {
  const present = new Set(
    artifacts.map((artifact) => `${artifact.os}-${normalizeArchitecture(artifact.arch)}`),
  );
  const requested = new Set(requiredTargets(options.platforms).map((target) => target.id));
  return RELEASE_TARGETS.filter((target) => present.has(target.id) || requested.has(target.id)).map(
    (target) => ({
      key: target.os === 'macos' ? `darwin-${target.architecture}` : target.updateTarget,
      filename: `Varve-${options.tag.slice(1)}-${target.id}.${target.os === 'linux' ? 'AppImage' : target.os === 'windows' ? 'exe' : 'app.tar.gz'}`,
    }),
  );
}

function verifyUpdaterCoverage(feed, dir, targets, options) {
  const keys = Object.keys(feed.platforms ?? {}).sort();
  if (!isDeepStrictEqual(keys, targets.map((target) => target.key).sort()))
    throw new Error('Updater feed does not cover every requested/present installer target');
  const base = `https://github.com/${options.repository}/releases/download/${options.tag}/`;
  for (const target of targets) {
    const entry = feed.platforms[target.key];
    if (entry.url !== `${base}${target.filename}`)
      throw new Error(`Updater feed artifact mismatch for ${target.key}`);
    for (const name of [target.filename, `${target.filename}.sig`]) {
      if (!lstatSync(join(dir, name), { throwIfNoEntry: false })?.isFile())
        throw new Error(`Updater bundle or signature is missing: ${name}`);
    }
    if (entry.signature !== readFileSync(join(dir, `${target.filename}.sig`), 'utf8').trim())
      throw new Error(`Updater feed signature differs from its detached sidecar: ${target.key}`);
  }
}

function verifyUpdaterFeeds(dir, assetNames, artifacts, options, run) {
  const feeds = assetNames.filter((name) => /^varve-update-.*\.json$/.test(name));
  const expected = `varve-update-${options.channel}.json`;
  if (!feeds.length && options.requireUpdater)
    throw new Error(`Required signed updater feed is missing: ${expected}`);
  if (feeds.length && !isDeepStrictEqual(feeds, [expected]))
    throw new Error(`Updater feed channel must match ${expected}`);
  for (const filename of feeds) {
    const path = join(dir, filename);
    const feed = readJSON(path);
    if (feed.version !== options.tag.slice(1))
      throw new Error(`Updater feed version mismatch: ${filename}`);
    verifyUpdaterCoverage(feed, dir, expectedUpdaterTargets(artifacts, options), options);
    run(process.execPath, [
      join(scriptDir, 'verify-updater-feed-signatures.mjs'),
      '--dir',
      dir,
      '--feed',
      path,
      ...(options.updaterConfig ? ['--tauri-conf', options.updaterConfig] : []),
    ]);
  }
}

export function verifyDraftDirectory(dir, release, options, run = runCommand) {
  verifyDownloadedInventory(dir, release);
  const manifest = readJSON(join(dir, 'release-manifest.json'));
  const checksumsPath = join(dir, 'SHA256SUMS.txt');
  const checksumsText = readFileSync(checksumsPath, 'utf8');
  const assetNames = release.assets.map((asset) => asset.name);
  for (const name of parseChecksums(checksumsText).keys()) {
    if (!SAFE_NAME.test(name) || name.includes('..'))
      throw new Error(`Unsafe checksum asset name: ${name}`);
  }
  const { artifacts, sbomAssets } = verifyReleaseIntegrity({
    tag: options.tag,
    manifest,
    checksumsText,
    assetNames,
  });
  verifyTargetCoverage(artifacts, requiredTargets(options.platforms));
  run(process.execPath, [
    join(scriptDir, 'verify-downloaded.mjs'),
    '--dir',
    dir,
    '--checksums',
    checksumsPath,
  ]);
  run(process.execPath, [
    join(scriptDir, 'verify-artifacts.mjs'),
    '--dir',
    dir,
    '--expect-version',
    options.tag.slice(1),
  ]);
  verifyProvenance(dir, artifacts, options);
  verifySigning(dir, manifest, options);
  verifySizeReports(dir, artifacts);
  const sbomPaths = sbomAssets.map((name) => join(dir, name));
  for (const path of sbomPaths) verifySbomIdentity(path, options);
  run(process.execPath, [join(scriptDir, 'validate-sbom.mjs'), ...sbomPaths]);
  verifyUpdaterFeeds(dir, assetNames, artifacts, options, run);
  return { installers: artifacts.length, assets: assetNames.length };
}

export function verifyDraftRelease(options, run = runCommand) {
  validateOptions(options);
  const recovery = loadRecoveryBuild(options, run);
  const endpoint = `repos/${options.repository}/releases/tags/${options.tag}`;
  const release = JSON.parse(run('gh', ['api', endpoint]));
  const fingerprint = draftFingerprint(release, options.tag);
  const dir = options.dir ? resolve(options.dir) : mkdtempSync(join(tmpdir(), 'varve-publish-'));
  if (options.dir) mkdirSync(dir); // Exclusive creation rejects occupied/stale output.
  run('gh', [
    'release',
    'download',
    options.tag,
    '--repo',
    options.repository,
    '--dir',
    dir,
    '--pattern',
    '*',
  ]);
  const checksumsPath = join(dir, 'SHA256SUMS.txt');
  const attestation = JSON.parse(
    run('gh', [
      'attestation',
      'verify',
      checksumsPath,
      '--repo',
      options.repository,
      '--signer-workflow',
      `${options.repository}/.github/workflows/release.yml`,
      '--format',
      'json',
    ]),
  );
  verifyChecksumAttestation(attestation, { ...options, checksumsPath, recovery });
  const result = verifyDraftDirectory(dir, release, options, run);
  if (recovery && !isDeepStrictEqual(loadRecoveryBuild(options, run), recovery))
    throw new Error('Recovery build attempt changed during verification');
  const current = JSON.parse(run('gh', ['api', endpoint]));
  if (draftFingerprint(current, options.tag) !== fingerprint)
    throw new Error(
      'Draft asset inventory changed during verification; publication must be retried',
    );
  return { ...result, dir, commitSha: options.commitSha };
}

export function parseArgs(argv) {
  const allowed = new Set([
    'repo',
    'tag',
    'sha',
    'policy-hash',
    'platforms',
    'channel',
    'expect-signed',
    'require-updater',
    'dir',
    'build-run-id',
    'trusted-workflow-sha',
    'tauri-conf',
  ]);
  const args = {};
  for (let i = 0; i < argv.length; i += 2) {
    const key = argv[i].slice(2);
    if (!argv[i].startsWith('--') || !allowed.has(key))
      throw new Error(`Unknown release verification option: ${argv[i]}`);
    if (Object.hasOwn(args, key))
      throw new Error(`Duplicate release verification option: --${key}`);
    const value = argv[i + 1];
    if (!value || value.startsWith('--'))
      throw new Error(`Missing value for release verification option: --${key}`);
    if (['expect-signed', 'require-updater'].includes(key) && !['true', 'false'].includes(value))
      throw new Error(`--${key} requires exactly true or false`);
    args[key] = value;
  }
  return args;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  const result = verifyDraftRelease({
    repository: args.repo,
    tag: args.tag,
    commitSha: args.sha,
    policyHash: args['policy-hash'],
    platforms: args.platforms ?? 'all',
    channel: args.channel ?? 'stable',
    expectSigned: args['expect-signed'] === 'true',
    requireUpdater: args['require-updater'] === 'true',
    dir: args.dir,
    buildRunId: args['build-run-id'],
    trustedWorkflowSha: args['trusted-workflow-sha'],
    updaterConfig: args['tauri-conf'],
  });
  process.stdout.write(
    `Verified ${result.installers} installers and ${result.assets} actual draft assets for ${result.commitSha}.\nDownloaded evidence: ${result.dir}\n`,
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`Draft publication verification FAILED: ${error.message}\n`);
    process.exitCode = 1;
  }
}
