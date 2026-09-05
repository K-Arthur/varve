#!/usr/bin/env node

/** Exact-identity local push receipts.  Receipts are a cache, never CI evidence. */

import { appendFileSync, mkdirSync, readFileSync, renameSync, writeFileSync } from 'node:fs';
import { isAbsolute, join, resolve } from 'node:path';
import { createGitAdapter } from './history-policy.mjs';
import { PUSH_LIMITS, sha256, toolVersions } from './validation-policy.mjs';

const RECEIPT_SCHEMA = 1;

function stable(value) {
  if (Array.isArray(value)) return `[${value.map(stable).join(',')}]`;
  if (value && typeof value === 'object') {
    return `{${Object.keys(value)
      .sort()
      .map((key) => `${JSON.stringify(key)}:${stable(value[key])}`)
      .join(',')}}`;
  }
  return JSON.stringify(value);
}

function gitText(git, args) {
  const result = git.run(args);
  if (result.status !== 0) throw new Error(result.stderr.trim() || `git ${args.join(' ')} failed`);
  return result.stdout.trim();
}

export function commonGitDirectory({ git = createGitAdapter(), cwd = process.cwd() } = {}) {
  const value = gitText(git, ['rev-parse', '--git-common-dir']);
  return isAbsolute(value) ? value : resolve(cwd, value);
}

export function receiptDirectory(options = {}) {
  const common = options.commonDir ?? commonGitDirectory(options);
  return join(common, 'varve-validation', 'receipts');
}

export function receiptIdentity(plan, { tools = toolVersions(), now = Date.now() } = {}) {
  const refs = (plan.refs ?? [])
    .map((ref) => ({
      localRef: ref.localRef,
      localSha: ref.localSha,
      remoteRef: ref.remoteRef,
      remoteSha: ref.remoteSha,
      baseSha: ref.baseSha,
      headSha: ref.headSha,
      comparisonBaseSha: ref.comparisonBaseSha,
      deleted: ref.deleted,
    }))
    .sort((a, b) => `${a.remoteRef}`.localeCompare(`${b.remoteRef}`));
  const identity = {
    schema: RECEIPT_SCHEMA,
    remote: plan.remote,
    refs,
    changedFileHash: plan.changedFileHash,
    outgoingCommitHash: plan.outgoingCommitHash,
    lockfileHash: plan.lockfileHash,
    policyVersion: plan.policyVersion,
    policyHash: plan.policyHash,
    tools,
  };
  return {
    ...identity,
    identityHash: sha256(stable(identity)),
    createdAt: new Date(now).toISOString(),
  };
}

export function receiptPath(plan, options = {}) {
  const identity = receiptIdentity(plan, options);
  return join(receiptDirectory(options), `${identity.identityHash}.json`);
}

export function readReceipt(
  plan,
  {
    commonDir,
    git,
    cwd,
    now = Date.now(),
    maxAgeMs = PUSH_LIMITS.receiptMaxAgeMs,
    tools = toolVersions(),
  } = {},
) {
  const identity = receiptIdentity(plan, { tools, now });
  const path = join(receiptDirectory({ commonDir, git, cwd }), `${identity.identityHash}.json`);
  let receipt;
  try {
    receipt = JSON.parse(readFileSync(path, 'utf8'));
  } catch {
    return { reusable: false, path, reason: 'missing' };
  }
  const timestamp = Date.parse(receipt.timestamp ?? receipt.createdAt ?? '');
  if (!Number.isFinite(timestamp) || now < timestamp || now - timestamp > maxAgeMs) {
    return { reusable: false, path, reason: 'expired', receipt };
  }
  const storedIdentity = { ...receipt.identity };
  delete storedIdentity.identityHash;
  delete storedIdentity.createdAt;
  const expectedIdentity = { ...identity };
  delete expectedIdentity.identityHash;
  delete expectedIdentity.createdAt;
  if (stable(storedIdentity) !== stable(expectedIdentity)) {
    return { reusable: false, path, reason: 'identity-mismatch', receipt };
  }
  if (receipt.outcome !== 'passed') {
    return { reusable: false, path, reason: 'not-passed', receipt };
  }
  return { reusable: true, path, reason: 'exact-match', receipt };
}

export function writeReceipt(
  plan,
  {
    commonDir,
    git,
    cwd,
    commands = [],
    outcomes = [],
    durations = {},
    override = null,
    now = Date.now(),
    tools = toolVersions(),
  } = {},
) {
  const identity = receiptIdentity(plan, { tools, now });
  const dir = receiptDirectory({ commonDir, git, cwd });
  mkdirSync(dir, { recursive: true });
  const receipt = {
    schema: RECEIPT_SCHEMA,
    timestamp: new Date(now).toISOString(),
    outcome: 'passed',
    identity,
    commands: [...commands],
    outcomes: [...outcomes],
    durations: { ...durations },
    override,
    note: 'Local push checkpoint cache only; this receipt cannot satisfy CI, candidate, signing, or provenance gates.',
  };
  const path = join(dir, `${identity.identityHash}.json`);
  const temp = `${path}.${process.pid}.tmp`;
  writeFileSync(temp, `${JSON.stringify(receipt, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
  return { path, receipt };
}

export function recordOverride(reason, plan, { commonDir, git, cwd, now = Date.now() } = {}) {
  const trimmed = String(reason ?? '').trim();
  if (!trimmed) throw new Error('A push override requires a nonempty, specific reason.');
  const dir = join(receiptDirectory({ commonDir, git, cwd }), '..');
  mkdirSync(dir, { recursive: true });
  const entry = {
    timestamp: new Date(now).toISOString(),
    reason: trimmed,
    identityHash: receiptIdentity(plan, { now }).identityHash,
    refs: (plan.refs ?? []).map((ref) => ref.remoteRef),
    headShas: (plan.refs ?? []).map((ref) => ref.headSha),
  };
  appendFileSync(join(dir, 'overrides.ndjson'), `${JSON.stringify(entry)}\n`, { mode: 0o600 });
  return entry;
}

export { RECEIPT_SCHEMA, stable as stableReceiptJson };
