#!/usr/bin/env node

/**
 * Exact outgoing-ref planner for the pre-push checkpoint.
 *
 * Git invokes pre-push hooks with one line per update:
 *   <local-ref> <local-sha> <remote-ref> <remote-sha>
 *
 * This module parses that stream and performs all Git work with argument
 * arrays.  It never asks the worktree what to validate.  The worktree is only
 * inspected separately for a warning about files that are not being pushed.
 */

import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import { buildPlan } from './affected-plan.mjs';
import { createGitAdapter, parseNameStatusZ, scanOutgoingHistory } from './history-policy.mjs';
import {
  computePolicyHash,
  LANE_COST_SECONDS,
  POLICY_VERSION,
  PUSH_LIMITS,
  selectPushValidation,
  sha256,
} from './validation-policy.mjs';

export const ZERO_SHA = '0'.repeat(40);
export const PUSH_EXIT_CODES = Object.freeze({
  ok: 0,
  validationFailure: 1,
  invalidInvocation: 2,
  policyRefusal: 4,
});

const SHA = /^[0-9a-f]{40}$/;
const REF = /^(?:refs\/(?:heads|tags|remotes)\/[^\0\s]+|HEAD)$/;
const PROTECTED_BRANCH = 'refs/heads/master';

function commandGit(cwd = process.cwd()) {
  return createGitAdapter(cwd);
}

function gitText(git, args, { allowFailure = false } = {}) {
  const result = git.run(args);
  if (!allowFailure && result.status !== 0) {
    throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  }
  return String(result.stdout ?? '');
}

function gitResult(git, args) {
  return git.run(args);
}

function commitObject(git, object, label) {
  if (!object || object === ZERO_SHA) return null;
  const result = gitResult(git, ['rev-parse', '--verify', `${object}^{commit}`]);
  if (result.status !== 0) {
    throw new Error(
      `missing local Git object for ${label}: ${object}. Fetch the comparison base and retry; ` +
        'the push was not validated.',
    );
  }
  const sha = result.stdout.trim();
  if (!SHA.test(sha)) throw new Error(`Git returned an invalid commit for ${label}: ${sha}`);
  return sha;
}

function isAncestor(git, base, head) {
  if (!base || !head) return false;
  return gitResult(git, ['merge-base', '--is-ancestor', base, head]).status === 0;
}

function isShallowRepository(git) {
  const result = gitResult(git, ['rev-parse', '--is-shallow-repository']);
  return result.status === 0 && result.stdout.trim() === 'true';
}

function mergeBase(git, left, right) {
  const result = gitResult(git, ['merge-base', left, right]);
  if (result.status !== 0) return null;
  const sha = result.stdout.trim();
  return SHA.test(sha) ? sha : null;
}

/** Parse Git's standard pre-push input without interpreting refs as shell. */
export function parsePrePushInput(input) {
  const updates = [];
  for (const [lineNumber, rawLine] of String(input ?? '')
    .split(/\r?\n/)
    .entries()) {
    const line = rawLine.trim();
    if (!line) continue;
    const fields = line.split(/\s+/);
    if (fields.length !== 4) {
      const error = new Error(
        `invalid pre-push input on line ${lineNumber + 1}: expected four fields, received ${fields.length}`,
      );
      error.code = PUSH_EXIT_CODES.invalidInvocation;
      throw error;
    }
    const [localRef, localSha, remoteRef, remoteSha] = fields;
    if (!REF.test(localRef) || !REF.test(remoteRef)) {
      const error = new Error(`invalid Git ref in pre-push input: ${localRef} ${remoteRef}`);
      error.code = PUSH_EXIT_CODES.invalidInvocation;
      throw error;
    }
    if (
      (!SHA.test(localSha) && localSha !== ZERO_SHA) ||
      (!SHA.test(remoteSha) && remoteSha !== ZERO_SHA)
    ) {
      const error = new Error(`invalid Git SHA in pre-push input: ${localSha} ${remoteSha}`);
      error.code = PUSH_EXIT_CODES.invalidInvocation;
      throw error;
    }
    updates.push({ localRef, localSha, remoteRef, remoteSha });
  }
  return updates;
}

function defaultBranchCandidates(git, remote, explicitRefs = null) {
  if (Array.isArray(explicitRefs)) return explicitRefs;
  const refs = [];
  const symbolic = gitResult(git, ['symbolic-ref', '--quiet', `refs/remotes/${remote}/HEAD`]);
  if (symbolic.status === 0) refs.push(symbolic.stdout.trim());
  refs.push(
    `refs/remotes/${remote}/master`,
    `refs/remotes/${remote}/main`,
    'refs/heads/master',
    'refs/heads/main',
  );
  return [...new Set(refs.filter(Boolean))];
}

function knownDefaultCommit(git, remote, explicitRefs = null) {
  for (const ref of defaultBranchCandidates(git, remote, explicitRefs)) {
    const result = gitResult(git, ['rev-parse', '--verify', `${ref}^{commit}`]);
    if (result.status === 0 && SHA.test(result.stdout.trim())) return result.stdout.trim();
  }
  return null;
}

function newRefBase(git, remote, head, explicitRefs = null) {
  for (const ref of defaultBranchCandidates(git, remote, explicitRefs)) {
    const result = gitResult(git, ['rev-parse', '--verify', `${ref}^{commit}`]);
    if (result.status !== 0) continue;
    const base = mergeBase(git, head, result.stdout.trim());
    if (base) return { base, ref };
  }
  return null;
}

function parseWorktreeStatus(git) {
  const raw = gitText(git, ['status', '--porcelain=v1', '-z'], { allowFailure: true });
  const entries = raw.split('\0').filter(Boolean);
  return {
    dirty: entries.length > 0,
    entries: entries.map((entry) => ({
      status: entry.slice(0, 2),
      path: entry.slice(3),
    })),
    untracked: entries.filter((entry) => entry.startsWith('?? ')).map((entry) => entry.slice(3)),
    warning:
      entries.length > 0
        ? 'Unstaged, staged, and untracked worktree files are not part of this push checkpoint.'
        : null,
  };
}

function parseLogShas(output) {
  return String(output)
    .split('\0')
    .filter((sha) => SHA.test(sha));
}

function outgoingCommits(git, base, head) {
  if (!base || !head || base === head) return [];
  return parseLogShas(
    gitText(git, ['log', '--topo-order', '--format=%H', '-z', `${base}..${head}`]),
  );
}

function diffRecords(git, base, head) {
  if (!base || !head || base === head) return [];
  const raw = gitText(git, [
    'diff',
    '--name-status',
    '-z',
    '--find-renames=50%',
    '--find-copies=50%',
    '--diff-filter=ACDMRTUXB',
    base,
    head,
  ]);
  return parseNameStatusZ(raw);
}

function stableRecords(records) {
  return records
    .map((record) => ({
      status: record.status,
      path: record.path,
      oldPath: record.oldPath,
    }))
    .sort((a, b) =>
      `${a.status}\0${a.path}\0${a.oldPath ?? ''}`.localeCompare(
        `${b.status}\0${b.path}\0${b.oldPath ?? ''}`,
      ),
    );
}

function shaForLockfile(git, head) {
  const files = ['pnpm-lock.yaml', 'Cargo.lock', 'apps/desktop/src-tauri/Cargo.lock'];
  const parts = files.map((path) => {
    const result = gitResult(git, ['show', `${head}:${path}`]);
    return `${path}\0${result.status === 0 ? result.stdout : '<missing>\n'}`;
  });
  return sha256(parts.join('\0'));
}

function releaseTag(ref) {
  return ref.startsWith('refs/tags/v');
}

function protectedRef(ref) {
  return ref === PROTECTED_BRANCH || releaseTag(ref);
}

function findCandidateEvidence(sha, policyHash, explicitPath, commonGitDir) {
  const paths = [
    explicitPath,
    process.env.VARVE_CANDIDATE_EVIDENCE,
    commonGitDir ? join(commonGitDir, 'varve-validation', 'candidates', `${sha}.json`) : null,
    join(process.cwd(), '.git', 'varve-validation', 'candidates', `${sha}.json`),
    join(process.cwd(), '.varve', 'validation', `candidate-${sha}.json`),
  ].filter(Boolean);
  for (const path of paths) {
    try {
      const evidence = JSON.parse(readFileSync(path, 'utf8'));
      if (
        evidence.commitSha === sha &&
        evidence.policyHash === policyHash &&
        evidence.policyVersion === POLICY_VERSION &&
        evidence.schema === 1 &&
        (evidence.conclusion === 'success' || evidence.status === 'passed')
      ) {
        return { path, evidence };
      }
    } catch {
      // A missing or malformed local evidence file is not valid certification.
    }
  }
  return null;
}

function makePlanner(files, options) {
  if (typeof options.planBuilder === 'function') return options.planBuilder(files);
  return buildPlan(files);
}

/**
 * Build a machine-readable plan for every update in a pre-push stream.
 * `plan.errorCode` is set for protected-ref/ref-resolution refusal; callers
 * should preserve it rather than flattening it into a test failure.
 */
export function buildPushPlan(input, options = {}) {
  const updates = Array.isArray(input) ? input : parsePrePushInput(input);
  if (updates.length === 0) {
    const error = new Error(
      'Git supplied no refs to validate; refusing an ambiguous push checkpoint.',
    );
    error.code = PUSH_EXIT_CODES.invalidInvocation;
    throw error;
  }
  const git = options.git ?? commandGit(options.cwd);
  const remote = options.remote ?? options.remoteName ?? 'origin';
  const policyHash =
    options.policyHash ?? computePolicyHash({ root: options.root ?? process.cwd() });
  const refs = [];
  const unionCommits = new Set();
  const unionRecords = new Map();
  const riskReasons = [];
  const errors = [];
  let policyRefusal = false;
  const shallowRepository = isShallowRepository(git);

  let remoteUrl = String(options.remoteUrl ?? '').trim();
  if (!remoteUrl) {
    try {
      remoteUrl = gitText(git, ['remote', 'get-url', remote], { allowFailure: true }).trim();
    } catch {
      remoteUrl = '';
    }
  }

  for (const update of updates) {
    const refResult = {
      ...update,
      deleted: update.localSha === ZERO_SHA,
      forceUpdate: false,
      rewrittenCommits: [],
      baseSha: update.remoteSha === ZERO_SHA ? null : update.remoteSha,
      headSha: update.localSha === ZERO_SHA ? null : update.localSha,
      comparisonBaseSha: null,
      comparisonBaseRef: null,
      netChangedFiles: [],
      outgoingCommits: [],
      historyFindings: [],
    };

    if (refResult.deleted) {
      if (protectedRef(update.remoteRef)) {
        errors.push({
          kind: 'protected-ref',
          ref: update.remoteRef,
          message: 'deleting a protected ref is refused',
        });
        policyRefusal = true;
      }
      refs.push(refResult);
      continue;
    }

    let head;
    try {
      head = commitObject(git, update.localSha, `local ref ${update.localRef}`);
    } catch (error) {
      errors.push({ kind: 'missing-object', ref: update.localRef, message: error.message });
      continue;
    }
    refResult.headSha = head;

    let comparisonBase = null;
    if (update.remoteSha !== ZERO_SHA) {
      try {
        comparisonBase = commitObject(git, update.remoteSha, `remote ref ${update.remoteRef}`);
      } catch (error) {
        errors.push({ kind: 'missing-object', ref: update.remoteRef, message: error.message });
        refs.push(refResult);
        continue;
      }
      refResult.baseSha = comparisonBase;
      if (!isAncestor(git, comparisonBase, head)) {
        refResult.forceUpdate = true;
        const divergenceBase = mergeBase(git, comparisonBase, head);
        if (shallowRepository || !divergenceBase) {
          comparisonBase = null;
          refResult.comparisonBaseSha = null;
          errors.push({
            kind: 'incomplete-history',
            ref: update.remoteRef,
            message:
              `cannot safely classify ${update.remoteRef} as a rewrite because local history is ` +
              `${shallowRepository ? 'shallow' : 'incomplete'}; fetch the full comparison history and retry`,
          });
          refResult.rewrittenCommits = divergenceBase
            ? outgoingCommits(git, divergenceBase, head)
            : [];
        } else if (protectedRef(update.remoteRef)) {
          refResult.rewrittenCommits = outgoingCommits(git, divergenceBase, head);
          errors.push({
            kind: 'non-fast-forward-protected',
            ref: update.remoteRef,
            message: 'non-fast-forward updates to master and release tags are refused',
          });
          policyRefusal = true;
        } else if (
          !String(options.overrideReason ?? process.env.VARVE_PUSH_OVERRIDE_REASON ?? '').trim()
        ) {
          refResult.rewrittenCommits = outgoingCommits(git, divergenceBase, head);
          errors.push({
            kind: 'non-fast-forward',
            ref: update.remoteRef,
            rewrittenCommits: refResult.rewrittenCommits,
            message: 'unprotected non-fast-forward update requires VARVE_PUSH_OVERRIDE_REASON',
          });
          policyRefusal = true;
        } else {
          refResult.rewrittenCommits = outgoingCommits(git, divergenceBase, head);
          riskReasons.push(
            `non-fast-forward update on ${update.remoteRef}; deliberate override recorded`,
          );
          comparisonBase = mergeBase(git, comparisonBase, head);
        }
      }
    } else {
      const base = newRefBase(git, remote, head, options.defaultBranchRefs ?? null);
      if (base) {
        comparisonBase = base.base;
        refResult.comparisonBaseRef = base.ref;
      } else {
        errors.push({
          kind: 'no-safe-base',
          ref: update.remoteRef,
          message:
            'new ref has no reachable remote default branch; fetch a complete comparison base',
        });
      }
    }
    refResult.comparisonBaseSha = comparisonBase;

    if (
      comparisonBase &&
      !errors.some((error) => error.ref === update.remoteRef && error.kind === 'missing-object')
    ) {
      try {
        refResult.netChangedFiles = stableRecords(diffRecords(git, comparisonBase, head));
        refResult.outgoingCommits = outgoingCommits(git, comparisonBase, head);
        if (
          update.remoteRef === PROTECTED_BRANCH &&
          refResult.outgoingCommits.length >= PUSH_LIMITS.directMasterCommitThreshold
        ) {
          const integrationRef = `refs/heads/varve/integration-${head.slice(0, 12)}`;
          errors.push({
            kind: 'large-direct-master',
            ref: update.remoteRef,
            message:
              `direct master push contains ${refResult.outgoingCommits.length} outgoing commits; ` +
              `push the same HEAD through integration certification with: ` +
              `git push ${remote} ${update.localRef}:${integrationRef}`,
          });
          policyRefusal = true;
        }
        for (const commit of refResult.outgoingCommits) unionCommits.add(commit);
        for (const record of refResult.netChangedFiles) {
          unionRecords.set(`${record.status}\0${record.path}\0${record.oldPath ?? ''}`, record);
        }
      } catch (error) {
        errors.push({ kind: 'comparison-failure', ref: update.remoteRef, message: error.message });
      }
    }

    if (releaseTag(update.remoteRef)) {
      const defaultCommit = knownDefaultCommit(git, remote, options.defaultBranchRefs ?? null);
      const pushedDefaultHeads = updates
        .filter(
          (candidate) =>
            candidate.remoteRef === PROTECTED_BRANCH && candidate.localSha !== ZERO_SHA,
        )
        .map((candidate) => {
          try {
            return commitObject(git, candidate.localSha, `local ref ${candidate.localRef}`);
          } catch {
            return null;
          }
        })
        .filter(Boolean);
      const reachableFromDefault = [defaultCommit, ...pushedDefaultHeads]
        .filter(Boolean)
        .some((defaultHead) => isAncestor(git, head, defaultHead));
      if (!reachableFromDefault) {
        errors.push({
          kind: 'release-tag-provenance',
          ref: update.remoteRef,
          message: 'release tag must point to a commit reachable from the remote default branch',
        });
        policyRefusal = true;
      }
      const candidate = findCandidateEvidence(
        head,
        policyHash,
        options.candidateEvidencePath,
        options.commonGitDir,
      );
      if (!candidate) {
        errors.push({
          kind: 'release-candidate-certification-missing',
          ref: update.remoteRef,
          message: `no successful exact-SHA candidate evidence for ${head} with policy ${policyHash}`,
        });
        policyRefusal = true;
      } else {
        refResult.candidateEvidence = {
          path: candidate.path,
          commitSha: candidate.evidence.commitSha,
        };
      }
    }
    refs.push(refResult);
  }

  const commits = [...unionCommits].sort();
  const netChangedFiles = [...unionRecords.values()].sort((a, b) =>
    `${a.status}\0${a.path}`.localeCompare(`${b.status}\0${b.path}`),
  );
  const files = [
    ...new Set(netChangedFiles.flatMap((record) => [record.path, record.oldPath]).filter(Boolean)),
  ].sort();
  const planner = makePlanner(files, options);
  const validation = selectPushValidation(planner, { files, strict: Boolean(options.strict) });
  const historyFindings = options.historyScanner
    ? options.historyScanner(commits)
    : scanOutgoingHistory(commits, { git });
  if (historyFindings.length)
    riskReasons.push('history-sensitive policy finding requires push refusal');

  const dirty = parseWorktreeStatus(git);
  const outgoingCommitHash = sha256(commits.join('\0'));
  const changedFileHash = sha256(JSON.stringify(stableRecords(netChangedFiles)));
  const lockfileHash = shaForLockfile(
    git,
    refs.find((ref) => ref.headSha)?.headSha ?? commits.at(-1) ?? updates[0].localSha,
  );
  const allErrors = [...errors];
  const status = allErrors.length || historyFindings.length ? 'blocked' : 'ready';
  const overrideReason = String(
    options.overrideReason ?? process.env.VARVE_PUSH_OVERRIDE_REASON ?? '',
  ).trim();

  return {
    schema: 1,
    generatedAt: new Date().toISOString(),
    remote: { name: remote, url: remoteUrl },
    refs,
    baseSha: refs.length === 1 ? refs[0].comparisonBaseSha : null,
    headSha: refs.length === 1 ? refs[0].headSha : null,
    union: {
      outgoingCommits: commits,
      commitCount: commits.length,
      netChangedFiles,
      netChangedFileCount: netChangedFiles.length,
      paths: files,
    },
    historyFindings,
    planner,
    validation,
    affected: {
      packages: planner.stats?.jsPackages ?? [],
      crates: planner.stats?.rustCrates ?? [],
      domains: planner.e2eDomains ?? [],
    },
    riskReasons: [...new Set([...riskReasons, ...(validation.reasons ?? [])])],
    localBlockingLanes: validation.localBlocking,
    remotelyRequiredLanes: validation.remoteRequired,
    deferredLanes: validation.deferred,
    estimatedCostSeconds: {
      local: validation.estimatedLocalSeconds,
      remote: validation.promisedIntegrationLanes.reduce(
        (sum, lane) => sum + (LANE_COST_SECONDS[lane] ?? 60),
        0,
      ),
    },
    changedFileHash,
    outgoingCommitHash,
    lockfileHash,
    policyVersion: options.policyVersion ?? POLICY_VERSION,
    policyHash,
    worktree: dirty,
    override: overrideReason
      ? { reason: overrideReason, recorded: false, bypassed: [] }
      : { reason: null, recorded: false, bypassed: [] },
    errors: allErrors,
    status,
    errorCode: policyRefusal
      ? PUSH_EXIT_CODES.policyRefusal
      : historyFindings.length
        ? PUSH_EXIT_CODES.validationFailure
        : allErrors.length
          ? PUSH_EXIT_CODES.invalidInvocation
          : PUSH_EXIT_CODES.ok,
  };
}

export function planExitCode(plan) {
  if (plan.errorCode === PUSH_EXIT_CODES.policyRefusal) return PUSH_EXIT_CODES.policyRefusal;
  if (plan.historyFindings?.length) return PUSH_EXIT_CODES.validationFailure;
  if (plan.errors?.length) return PUSH_EXIT_CODES.invalidInvocation;
  return PUSH_EXIT_CODES.ok;
}

export function formatPushPlan(plan, { json = false } = {}) {
  if (json) return JSON.stringify(plan, null, 2);
  const lines = [
    `Push checkpoint: ${plan.status.toUpperCase()}`,
    `Remote: ${plan.remote.name}${plan.remote.url ? ` (${plan.remote.url})` : ''}`,
    `Refs: ${plan.refs.length} · outgoing commits: ${plan.union.commitCount} · net files: ${plan.union.netChangedFileCount}`,
    `Affected packages: ${plan.affected.packages.join(', ') || 'none'}`,
    `Affected crates: ${plan.affected.crates.join(', ') || 'none'}`,
  ];
  if (plan.worktree.dirty) lines.push(`Warning: ${plan.worktree.warning}`);
  if (plan.override.recorded) lines.push(`Override recorded: ${plan.override.reason}`);
  if (plan.errors.length) {
    lines.push('Blocking errors:');
    for (const error of plan.errors) lines.push(`  - ${error.message}`);
  }
  if (plan.historyFindings.length) {
    lines.push('History-sensitive findings:');
    for (const finding of plan.historyFindings) {
      lines.push(`  - ${finding.rule} ${finding.commit ?? ''} ${finding.path ?? ''}`.trim());
    }
  }
  lines.push(`Local blocking lanes: ${plan.localBlockingLanes.join(', ') || 'none'}`);
  lines.push(`Remote certification required: ${plan.remotelyRequiredLanes.join(', ') || 'none'}`);
  lines.push(`Deferred heavyweight lanes: ${plan.deferredLanes.join(', ') || 'none'}`);
  lines.push(`Policy: ${plan.policyVersion} (${plan.policyHash})`);
  return lines.join('\n');
}

export { createGitAdapter };
