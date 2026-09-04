#!/usr/bin/env node

/** Regression coverage for exact outgoing-ref discovery and history policy. */

import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { createGitAdapter, parseNameStatusZ } from './history-policy.mjs';
import { buildPushPlan, PUSH_EXIT_CODES, parsePrePushInput, ZERO_SHA } from './push-plan.mjs';
import { POLICY_VERSION } from './validation-policy.mjs';

const repo = mkdtempSync(join(tmpdir(), 'varve-push-plan-'));
const shallowRepo = mkdtempSync(join(tmpdir(), 'varve-push-plan-shallow-'));
const git = (args) => execFileSync('git', args, { cwd: repo, encoding: 'utf8' }).trim();
const commit = (message) => git(['commit', '-qm', message]);
const writeCommit = (name, value, message = name) => {
  writeFileSync(join(repo, name), value);
  git(['add', '--', name]);
  commit(message);
  return git(['rev-parse', 'HEAD']);
};
const fakePlanner = (files) => {
  const global = files.some(
    (file) => file === 'pnpm-lock.yaml' || file.startsWith('.github/workflows/'),
  );
  return {
    tiers: { 0: [], 1: [], 2: [], 3: [], 4: [] },
    skipped: [],
    full: global,
    reasons: global ? ['root contract fixture'] : [],
    changed: {
      js: files.filter((file) => /\.(ts|tsx|js|mjs)$/.test(file)),
      rust: files.filter((file) => file.startsWith('crates/')),
      other: files.filter(
        (file) => !/\.(ts|tsx|js|mjs)$/.test(file) && !file.startsWith('crates/'),
      ),
      app: [],
    },
    stats: { jsPackages: [], rustCrates: [], totalTestFiles: 0, selectedTestFiles: 0 },
    e2eDomains: [],
  };
};
const policyHash = 'a'.repeat(64);
const plan = (updates, options = {}) =>
  buildPushPlan(updates, {
    git: createGitAdapter(repo),
    cwd: repo,
    root: repo,
    remote: 'origin',
    policyHash,
    planBuilder: fakePlanner,
    ...options,
  });

try {
  git(['init', '-q', '-b', 'master']);
  git(['config', 'user.email', 'varve-tests@example.invalid']);
  git(['config', 'user.name', 'Varve push-plan tests']);
  git(['remote', 'add', 'origin', 'https://example.invalid/K-Arthur/varve.git']);
  const base = writeCommit('README.md', 'base\n', 'base');
  git(['update-ref', 'refs/remotes/origin/master', base]);

  // The parser accepts Git's four-field protocol, including HEAD, deletions,
  // detached-style pushes, and multiple updates in one stream.
  const parsed = parsePrePushInput(
    [
      `refs/heads/leaf ${base} refs/heads/leaf ${ZERO_SHA}`,
      `HEAD ${base} refs/tags/v0.3.0 ${ZERO_SHA}`,
      `refs/heads/delete ${ZERO_SHA} refs/heads/delete ${base}`,
    ].join('\n'),
  );
  assert.equal(parsed.length, 3, 'multiple refs are parsed independently');
  assert.equal(parsed[2].localSha, ZERO_SHA, 'branch deletion keeps the zero local SHA');
  assert.throws(() => parsePrePushInput(`refs/heads/x not-a-sha refs/heads/x ${base}`), {
    code: PUSH_EXIT_CODES.invalidInvocation,
  });
  assert.throws(() => parsePrePushInput('refs/heads/x only-three-fields'), {
    code: PUSH_EXIT_CODES.invalidInvocation,
  });

  const firstHead = writeCommit('packages-ui.ts', 'leaf\n');
  git(['update-ref', 'refs/remotes/origin/leaf', base]);
  const ordinary = plan([
    {
      localRef: 'refs/heads/leaf',
      localSha: firstHead,
      remoteRef: 'refs/heads/leaf',
      remoteSha: base,
    },
  ]);
  assert.equal(ordinary.status, 'ready', 'a normal leaf push is ready');
  assert.equal(ordinary.refs[0].comparisonBaseSha, base);
  assert.equal(ordinary.union.commitCount, 1);
  assert.ok(ordinary.union.netChangedFiles.some((record) => record.path === 'packages-ui.ts'));

  // Net diff is independent of the number of commits. A 200-commit range is
  // planned once, with no worktree files included in the comparison.
  const bulkBase = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/bulk', bulkBase]);
  for (let index = 0; index < 200; index += 1)
    writeCommit(`bulk-${index}.txt`, `${index}\n`, `bulk ${index}`);
  const bulkHead = git(['rev-parse', 'HEAD']);
  const bulk = plan([
    {
      localRef: 'refs/heads/bulk',
      localSha: bulkHead,
      remoteRef: 'refs/heads/bulk',
      remoteSha: bulkBase,
    },
  ]);
  assert.equal(bulk.union.commitCount, 200, 'all 200 outgoing commits are recorded');
  assert.equal(
    bulk.union.netChangedFileCount,
    200,
    'net changed files are bounded by final tree state',
  );
  const largeDirectMaster = plan([
    {
      localRef: 'refs/heads/master',
      localSha: bulkHead,
      remoteRef: 'refs/heads/master',
      remoteSha: bulkBase,
    },
  ]);
  assert.equal(largeDirectMaster.errorCode, PUSH_EXIT_CODES.policyRefusal);
  assert.ok(largeDirectMaster.errors.some((error) => error.kind === 'large-direct-master'));
  assert.match(
    largeDirectMaster.errors.find((error) => error.kind === 'large-direct-master').message,
    /git push origin/,
  );
  writeFileSync(join(repo, 'untracked outside push.txt'), 'not pushed\n');
  writeFileSync(join(repo, 'staged outside push.txt'), 'not pushed\n');
  git(['add', '--', 'staged outside push.txt']);
  const dirtyBulk = plan([
    {
      localRef: 'refs/heads/bulk',
      localSha: bulkHead,
      remoteRef: 'refs/heads/bulk',
      remoteSha: bulkBase,
    },
  ]);
  assert.equal(dirtyBulk.union.paths.includes('untracked outside push.txt'), false);
  assert.equal(dirtyBulk.union.paths.includes('staged outside push.txt'), false);
  assert.equal(dirtyBulk.worktree.dirty, true, 'dirty worktree is a warning, not outgoing input');
  git(['reset', '-q', 'HEAD', '--', 'staged outside push.txt']);

  // Reverted net changes do not appear in the ordinary file plan, but a root
  // lockfile/workflow change still carries global-impact semantics.
  const rootBase = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/root', rootBase]);
  const lockHead = writeCommit('pnpm-lock.yaml', 'lock fixture\n', 'root lock fixture');
  const lockPlan = plan([
    {
      localRef: 'refs/heads/root',
      localSha: lockHead,
      remoteRef: 'refs/heads/root',
      remoteSha: rootBase,
    },
  ]);
  assert.equal(lockPlan.validation.flags.globalImpact, true);
  assert.match(lockPlan.riskReasons.join('\n'), /global impact/);

  // New branches use a merge-base with the remote default branch rather than
  // treating the first repository commit as the comparison base.
  const newBranch = plan([
    {
      localRef: 'refs/heads/new-branch',
      localSha: lockHead,
      remoteRef: 'refs/heads/new-branch',
      remoteSha: ZERO_SHA,
    },
  ]);
  assert.equal(newBranch.refs[0].comparisonBaseRef, 'refs/remotes/origin/master');
  assert.equal(newBranch.refs[0].comparisonBaseSha, base);

  // New tags require candidate evidence; a normal non-release tag does not.
  const tagHead = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/master', tagHead]);
  const candidateDir = join(repo, '.git', 'varve-validation', 'candidates');
  mkdirSync(candidateDir, { recursive: true });
  const candidatePath = join(candidateDir, `${tagHead}.json`);
  writeFileSync(
    candidatePath,
    JSON.stringify({
      schema: 1,
      commitSha: tagHead,
      policyVersion: POLICY_VERSION,
      policyHash,
      status: 'passed',
    }),
  );
  const releaseTag = plan(
    [
      {
        localRef: 'refs/tags/v0.3.0',
        localSha: tagHead,
        remoteRef: 'refs/tags/v0.3.0',
        remoteSha: ZERO_SHA,
      },
    ],
    { candidateEvidencePath: candidatePath },
  );
  assert.equal(releaseTag.status, 'ready', 'release tag with exact candidate evidence is accepted');
  const wrongCandidate = join(repo, 'wrong-candidate.json');
  writeFileSync(wrongCandidate, JSON.stringify({ commitSha: base, policyHash, status: 'passed' }));
  const missingCertification = plan(
    [
      {
        localRef: 'refs/tags/v0.3.1',
        localSha: tagHead,
        remoteRef: 'refs/tags/v0.3.1',
        remoteSha: ZERO_SHA,
      },
    ],
    { candidateEvidencePath: wrongCandidate },
  );
  assert.equal(missingCertification.errorCode, PUSH_EXIT_CODES.policyRefusal);
  assert.ok(
    missingCertification.errors.some(
      (error) => error.kind === 'release-candidate-certification-missing',
    ),
  );
  const ordinaryTag = plan([
    {
      localRef: 'refs/tags/test-tag',
      localSha: tagHead,
      remoteRef: 'refs/tags/test-tag',
      remoteSha: ZERO_SHA,
    },
  ]);
  assert.equal(ordinaryTag.status, 'ready');

  // Multiple refs share one union plan; a deletion is represented without
  // inventing a comparison range.
  const multiple = plan([
    {
      localRef: 'refs/heads/leaf',
      localSha: tagHead,
      remoteRef: 'refs/heads/leaf',
      remoteSha: base,
    },
    {
      localRef: 'refs/tags/test-tag',
      localSha: tagHead,
      remoteRef: 'refs/tags/test-tag',
      remoteSha: ZERO_SHA,
    },
  ]);
  assert.equal(multiple.refs.length, 2);
  const deletion = plan([
    {
      localRef: 'refs/heads/leaf',
      localSha: ZERO_SHA,
      remoteRef: 'refs/heads/leaf',
      remoteSha: base,
    },
  ]);
  assert.equal(deletion.refs[0].deleted, true);
  assert.equal(deletion.union.commitCount, 0);

  // Non-fast-forward updates are explicit: unprotected refs require a reason,
  // while master and release refs remain refused even with an override.
  const divergenceBase = git(['rev-parse', 'HEAD']);
  const localHead = writeCommit('local-divergence.txt', 'local\n', 'local divergence');
  git(['switch', '-q', '-c', 'remote-divergence', divergenceBase]);
  const remoteHead = writeCommit('remote-divergence.txt', 'remote\n', 'remote divergence');
  git(['switch', '-q', '-']);
  const nonFastForward = plan([
    {
      localRef: 'refs/heads/rewritten',
      localSha: localHead,
      remoteRef: 'refs/heads/rewritten',
      remoteSha: remoteHead,
    },
  ]);
  assert.equal(nonFastForward.errorCode, PUSH_EXIT_CODES.policyRefusal);
  const overridden = plan(
    [
      {
        localRef: 'refs/heads/rewritten',
        localSha: localHead,
        remoteRef: 'refs/heads/rewritten',
        remoteSha: remoteHead,
      },
    ],
    { overrideReason: 'recovering a deliberately rewritten feature branch' },
  );
  assert.equal(overridden.status, 'ready');
  const protectedRewrite = plan(
    [
      {
        localRef: 'refs/heads/master',
        localSha: localHead,
        remoteRef: 'refs/heads/master',
        remoteSha: remoteHead,
      },
    ],
    { overrideReason: 'not allowed to rewrite master' },
  );
  assert.equal(protectedRewrite.errorCode, PUSH_EXIT_CODES.policyRefusal);

  // A shallow repository must not reinterpret an incomplete graph as a
  // deliberate rewrite. Both divergent heads and their common boundary are
  // present, but the shallow marker still makes the comparison unsafe.
  const shallowGit = (args) =>
    execFileSync('git', args, { cwd: shallowRepo, encoding: 'utf8' }).trim();
  shallowGit(['init', '-q', '-b', 'master']);
  shallowGit(['config', 'user.email', 'varve-tests@example.invalid']);
  shallowGit(['config', 'user.name', 'Varve shallow-history tests']);
  shallowGit(['remote', 'add', 'origin', 'https://example.invalid/K-Arthur/varve.git']);
  writeFileSync(join(shallowRepo, 'base.txt'), 'base\n');
  shallowGit(['add', '--', 'base.txt']);
  shallowGit(['commit', '-qm', 'shallow base']);
  const shallowBase = shallowGit(['rev-parse', 'HEAD']);
  shallowGit(['switch', '-q', '-c', 'remote']);
  writeFileSync(join(shallowRepo, 'remote.txt'), 'remote\n');
  shallowGit(['add', '--', 'remote.txt']);
  shallowGit(['commit', '-qm', 'remote head']);
  const shallowRemoteHead = shallowGit(['rev-parse', 'HEAD']);
  shallowGit(['switch', '-q', 'master']);
  writeFileSync(join(shallowRepo, 'local.txt'), 'local\n');
  shallowGit(['add', '--', 'local.txt']);
  shallowGit(['commit', '-qm', 'local head']);
  const shallowLocalHead = shallowGit(['rev-parse', 'HEAD']);
  writeFileSync(join(shallowRepo, '.git', 'shallow'), `${shallowBase}\n`);
  const shallow = buildPushPlan(
    [
      {
        localRef: 'refs/heads/master',
        localSha: shallowLocalHead,
        remoteRef: 'refs/heads/feature',
        remoteSha: shallowRemoteHead,
      },
    ],
    {
      git: createGitAdapter(shallowRepo),
      cwd: shallowRepo,
      root: shallowRepo,
      remote: 'origin',
      policyHash,
      planBuilder: fakePlanner,
      historyScanner: () => [],
    },
  );
  assert.equal(shallow.errorCode, PUSH_EXIT_CODES.invalidInvocation);
  assert.ok(shallow.errors.some((error) => error.kind === 'incomplete-history'));

  // Missing objects and no safe comparison base are startup errors, never a
  // validation pass. Detached HEAD input is syntactically supported above.
  const missingObject = plan([
    {
      localRef: 'HEAD',
      localSha: localHead,
      remoteRef: 'refs/heads/missing',
      remoteSha: 'b'.repeat(40),
    },
  ]);
  assert.equal(missingObject.errorCode, PUSH_EXIT_CODES.invalidInvocation);
  assert.ok(missingObject.errors.some((error) => error.kind === 'missing-object'));

  const noSafeBase = buildPushPlan(
    [
      {
        localRef: 'HEAD',
        localSha: localHead,
        remoteRef: 'refs/heads/no-base',
        remoteSha: ZERO_SHA,
      },
    ],
    {
      git: createGitAdapter(repo),
      cwd: repo,
      root: repo,
      remote: 'not-configured',
      policyHash,
      planBuilder: fakePlanner,
      historyScanner: () => [],
      defaultBranchRefs: [],
    },
  );
  assert.equal(noSafeBase.errorCode, PUSH_EXIT_CODES.invalidInvocation);
  assert.ok(noSafeBase.errors.some((error) => error.kind === 'no-safe-base'));

  // A file added and later removed is absent from the net diff but remains in
  // outgoing-history scanning. The scanner catches the secret in its commit.
  git(['switch', '-q', '-c', 'history-check', divergenceBase]);
  const historyBase = git(['rev-parse', 'HEAD']);
  git(['update-ref', 'refs/remotes/origin/history-check', historyBase]);
  const syntheticSecret = `${['AWS', 'SECRET', 'ACCESS', 'KEY'].join('_')}='aaaaaaaaaaaaaaaa'\n`;
  writeCommit('temporary-secret.env', syntheticSecret, 'temporary secret');
  git(['rm', '-q', '--', 'temporary-secret.env']);
  commit('remove temporary secret');
  const historyHead = git(['rev-parse', 'HEAD']);
  const history = buildPushPlan(
    [
      {
        localRef: 'refs/heads/history-check',
        localSha: historyHead,
        remoteRef: 'refs/heads/history-check',
        remoteSha: historyBase,
      },
    ],
    {
      git: createGitAdapter(repo),
      cwd: repo,
      root: repo,
      remote: 'origin',
      policyHash,
      planBuilder: fakePlanner,
    },
  );
  assert.equal(
    history.union.netChangedFiles.some((record) => record.path === 'temporary-secret.env'),
    false,
  );
  assert.ok(history.historyFindings.some((finding) => finding.kind === 'secret'));
  assert.equal(history.status, 'blocked');

  // NUL-delimited rename/copy/type records preserve paths with whitespace and
  // never turn a pathname into shell syntax.
  const records = parseNameStatusZ(
    'R100\0old name.txt\0new name [x].txt\0C75\0copy source.txt\0copy target.txt\0T\0type changed.txt\0',
  );
  assert.deepEqual(
    records.map((record) => record.status),
    ['R100', 'C75', 'T'],
  );
  assert.equal(records[0].oldPath, 'old name.txt');
  assert.equal(records[0].path, 'new name [x].txt');
  assert.equal(records[1].path, 'copy target.txt');

  // An annotated tag's object ID is accepted by Git's ^{commit} resolution;
  // the candidate check is still bound to the peeled commit.
  git(['tag', '-a', '-m', 'annotated', 'v0.3.2', historyHead]);
  git(['update-ref', 'refs/remotes/origin/master', historyHead]);
  const tagObject = git(['rev-parse', 'refs/tags/v0.3.2']);
  const annotatedEvidence = join(repo, 'annotated-candidate.json');
  writeFileSync(
    annotatedEvidence,
    JSON.stringify({
      schema: 1,
      commitSha: historyHead,
      policyVersion: POLICY_VERSION,
      policyHash,
      status: 'passed',
    }),
  );
  const annotated = buildPushPlan(
    [
      {
        localRef: 'refs/tags/v0.3.2',
        localSha: tagObject,
        remoteRef: 'refs/tags/v0.3.2',
        remoteSha: ZERO_SHA,
      },
    ],
    {
      git: createGitAdapter(repo),
      cwd: repo,
      root: repo,
      remote: 'origin',
      policyHash,
      candidateEvidencePath: annotatedEvidence,
      planBuilder: fakePlanner,
      historyScanner: () => [],
    },
  );
  assert.equal(annotated.refs[0].headSha, historyHead);
  assert.equal(annotated.status, 'ready');

  console.log('push-plan tests passed');
} finally {
  rmSync(repo, { recursive: true, force: true });
  rmSync(shallowRepo, { recursive: true, force: true });
}
