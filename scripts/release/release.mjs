#!/usr/bin/env node

/** Human-facing release lifecycle commands; none creates tags or publishes. */

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { pathToFileURL } from 'node:url';
import { computePolicyHash, POLICY_VERSION } from '../quality/validation-policy.mjs';
import { collectResumableArtifacts, RELEASE_TARGETS, writeFinalManifest } from './resume.mjs';

const ROOT = process.cwd();
const VERSION_RE = /^\d+\.\d+\.\d+(?:-[0-9A-Za-z.-]+)?$/;

function git(args) {
  const result = spawnSync('git', args, {
    cwd: ROOT,
    encoding: 'utf8',
    stdio: ['ignore', 'pipe', 'pipe'],
    shell: false,
  });
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout;
}

function cleanState() {
  return git(['status', '--porcelain=v1', '-z']).length === 0;
}

function head() {
  return git(['rev-parse', '--verify', 'HEAD^{commit}']).trim();
}

function currentVersion() {
  return JSON.parse(readFileSync(join(ROOT, 'package.json'), 'utf8')).version;
}

function changelogHas(version) {
  const text = readFileSync(join(ROOT, 'CHANGELOG.md'), 'utf8');
  return new RegExp(`^## \\[v?${version.replaceAll('.', '\\.')}(?:\\]|\\s)`, 'm').test(text);
}

function runVersion(command, value) {
  const result = spawnSync(
    'node',
    ['scripts/release/version.mjs', command, ...(value ? [value] : [])],
    {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: 'inherit',
      shell: false,
    },
  );
  if (result.status !== 0) throw new Error(`version.mjs ${command} failed`);
}

export function releaseStatus() {
  const version = currentVersion();
  const result = {
    branch: git(['branch', '--show-current']).trim() || '(detached HEAD)',
    commitSha: head(),
    dirty: !cleanState(),
    version,
    changelogSection: changelogHas(version),
    policyVersion: POLICY_VERSION,
    policyHash: computePolicyHash({ root: ROOT }),
    proposedTag: `v${version}`,
  };
  console.log(JSON.stringify(result, null, 2));
  return result;
}

export function prepare(version, { checkOnly = false } = {}) {
  if (!version || !VERSION_RE.test(version))
    throw new Error(`invalid release version '${version}'`);
  if (!cleanState())
    throw new Error(
      'release:prepare requires a clean worktree; commit or stash unrelated work first',
    );
  runVersion('verify');
  if (!changelogHas(version)) throw new Error(`CHANGELOG.md has no ## [${version}] section`);
  const sourceSha = head();
  if (!checkOnly) {
    runVersion('set', version);
    runVersion('verify');
  }
  const after = releaseStatus();
  console.log(`Prepared ${after.proposedTag}. Source SHA before the version commit: ${sourceSha}.`);
  console.log(
    'Review the version diff, commit it normally, then run `pnpm release:status` to freeze the exact SHA.',
  );
  console.log('No tag was created. No release was published.');
  return after;
}

export function certify({ sha = head(), mode = 'final' } = {}) {
  if (!cleanState()) throw new Error('release:certify requires a clean worktree');
  console.log(`Candidate ${mode} request for exact SHA ${sha}`);
  console.log(`Policy: ${POLICY_VERSION} (${computePolicyHash({ root: ROOT })})`);
  console.log(`Run: gh workflow run release-candidate.yml -f sha=${sha} -f mode=${mode}`);
  console.log(
    'This command only prints the remote certification request; it does not create a tag.',
  );
  return { sha, mode };
}

export function resume({
  dir,
  version,
  sha,
  policyHash = computePolicyHash({ root: ROOT }),
  platforms = [],
} = {}) {
  if (!dir || !version || !sha)
    throw new Error('release:resume requires --dir, --version, and --sha');
  const requiredPlatforms = platforms.length ? platforms : RELEASE_TARGETS;
  const result = collectResumableArtifacts(
    dir,
    { version, commitSha: sha, policyHash },
    { requiredPlatforms },
  );
  if (!result.ok) throw new Error(`resume refused: ${result.errors.join('; ')}`);
  const manifest = writeFinalManifest(dir, result, { version, commitSha: sha, policyHash });
  console.log(`Verified ${result.entries.length} exact-SHA artifact(s); wrote ${manifest}.`);
  return result;
}

function parseArgs(args) {
  const [command, value] = args;
  const flags = {
    command,
    value,
    checkOnly: args.includes('--check-only'),
    mode: 'final',
    dir: null,
    version: null,
    sha: null,
    policyHash: null,
    platforms: [],
  };
  for (let i = 0; i < args.length; i += 1) {
    if (args[i] === '--mode') flags.mode = args[++i];
    else if (args[i] === '--dir') flags.dir = args[++i];
    else if (args[i] === '--version') flags.version = args[++i];
    else if (args[i] === '--sha') flags.sha = args[++i];
    else if (args[i] === '--policy-hash') flags.policyHash = args[++i];
    else if (args[i] === '--platform') flags.platforms.push(args[++i]);
  }
  return flags;
}

function main() {
  const flags = parseArgs(process.argv.slice(2));
  if (flags.command === 'prepare') prepare(flags.value, { checkOnly: flags.checkOnly });
  else if (flags.command === 'status') releaseStatus();
  else if (flags.command === 'certify') certify({ sha: flags.sha ?? head(), mode: flags.mode });
  else if (flags.command === 'resume')
    resume({
      dir: flags.dir,
      version: flags.version,
      sha: flags.sha,
      policyHash: flags.policyHash ?? computePolicyHash({ root: ROOT }),
      platforms: flags.platforms,
    });
  else
    throw new Error(
      'usage: release.mjs prepare <version> | status | certify [--sha <sha>] | resume --dir <dir> --version <v> --sha <sha> [--platform <os-arch>]',
    );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`release command failed: ${error.message}`);
    process.exitCode = 1;
  }
}

export { changelogHas, parseArgs };
