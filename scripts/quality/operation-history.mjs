#!/usr/bin/env node

/**
 * Small durable operation journal for local Git/validation workflows.
 *
 * These records are local evidence and operation history, not CI credentials
 * or release provenance. Each operation has its own file so a failed retry
 * never overwrites the previous attempt. Writes are atomic and records live in
 * the common Git directory, which makes linked worktrees share the journal
 * without conflating their worktree identities.
 */

import { randomUUID } from 'node:crypto';
import {
  existsSync,
  mkdirSync,
  readdirSync,
  readFileSync,
  renameSync,
  writeFileSync,
} from 'node:fs';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { createGitAdapter } from './history-policy.mjs';

export const OPERATION_SCHEMA = 1;
export const DEFAULT_INTERRUPTED_AFTER_MS = 30 * 60 * 1000;

const SAFE_ENVIRONMENT_KEYS = new Set([
  'CI',
  'GITHUB_ACTIONS',
  'GITHUB_EVENT_NAME',
  'VARVE_VALIDATION_PROFILE',
]);

function gitText(git, args, cwd = process.cwd()) {
  const result = (git ?? createGitAdapter(cwd)).run(args);
  if (result.status !== 0) return '';
  return String(result.stdout ?? '').trim();
}

export function commonGitDirectory({ git = createGitAdapter(), cwd = process.cwd() } = {}) {
  const value = gitText(git, ['rev-parse', '--git-common-dir'], cwd);
  return value ? (value.startsWith('/') ? value : resolve(cwd, value)) : resolve(cwd, '.git');
}

export function operationDirectory({ commonDir, git, cwd = process.cwd() } = {}) {
  return join(commonDir ?? commonGitDirectory({ git, cwd }), 'varve-validation', 'operations');
}

export function sanitizeRemoteUrl(value) {
  const raw = String(value ?? '').trim();
  if (!raw) return '';
  try {
    const url = new URL(raw);
    url.username = '';
    url.password = '';
    url.search = '';
    url.hash = '';
    return url.toString().replace(/\/$/, '');
  } catch {
    return raw
      .replace(/:\/\/[^/\s@]+@/g, '://<credentials>@')
      .replace(/([?&](?:token|key|secret|password)=)[^&\s]*/gi, '$1<redacted>');
  }
}

function safeEnvironment(environment = process.env) {
  return Object.fromEntries(
    [...SAFE_ENVIRONMENT_KEYS]
      .filter((key) => environment[key] !== undefined)
      .map((key) => [key, String(environment[key])]),
  );
}

function atomicWrite(path, value) {
  const temp = `${path}.${process.pid}.${randomUUID()}.tmp`;
  writeFileSync(temp, `${JSON.stringify(value, null, 2)}\n`, { encoding: 'utf8', mode: 0o600 });
  renameSync(temp, path);
}

function operationFile(operationId, options = {}) {
  return `${operationDirectory(options)}/${operationId}.json`;
}

function operationId(now = Date.now()) {
  return `op-${new Date(now).toISOString().replace(/[-:.TZ]/g, '')}-${randomUUID()}`;
}

function refSummary(ref) {
  if (!ref || typeof ref !== 'object') return ref;
  return {
    localRef: ref.localRef ?? null,
    localSha: ref.localSha ?? null,
    remoteRef: ref.remoteRef ?? null,
    remoteSha: ref.remoteSha ?? null,
    baseSha: ref.baseSha ?? null,
    headSha: ref.headSha ?? null,
    treeSha: ref.treeSha ?? null,
    comparisonBaseSha: ref.comparisonBaseSha ?? null,
    deleted: Boolean(ref.deleted),
  };
}

export function startOperation({
  type,
  cwd = process.cwd(),
  commonDir,
  destination = {},
  requested = {},
  refs = [],
  parentOperationId = process.env.VARVE_PARENT_OPERATION_ID ?? null,
  now = Date.now(),
  id = operationId(now),
} = {}) {
  if (!type) throw new Error('operation type is required');
  const dir = operationDirectory({ commonDir, cwd });
  mkdirSync(dir, { recursive: true, mode: 0o700 });
  const record = {
    schema: OPERATION_SCHEMA,
    operationId: id,
    type,
    status: 'running',
    startedAt: new Date(now).toISOString(),
    terminalAt: null,
    durationMs: null,
    parentOperationId,
    repository: {
      worktreePath: resolve(cwd),
      commonGitDirectory: commonDir ?? commonGitDirectory({ cwd }),
    },
    destination: {
      name: destination.name ?? null,
      url: sanitizeRemoteUrl(destination.url),
    },
    requested: { ...requested },
    refs: refs.map(refSummary),
    environment: safeEnvironment(),
    result: null,
  };
  const path = operationFile(id, { commonDir, cwd });
  atomicWrite(path, record);
  return { path, record };
}

export function finishOperation(
  path,
  {
    status = 'completed',
    exitCode = null,
    phase = 'complete',
    result = {},
    refs = [],
    now = Date.now(),
  } = {},
) {
  const record = JSON.parse(readFileSync(path, 'utf8'));
  if (record.schema !== OPERATION_SCHEMA)
    throw new Error(`unsupported operation schema in ${path}`);
  const started = Date.parse(record.startedAt);
  const terminalAt = new Date(now).toISOString();
  const finished = {
    ...record,
    status,
    terminalAt,
    durationMs: Number.isFinite(started) ? Math.max(0, now - started) : null,
    refs: refs.length ? refs.map(refSummary) : record.refs,
    result: {
      ...result,
      exitCode,
      phase,
    },
  };
  atomicWrite(path, finished);
  return finished;
}

export function readOperation(path) {
  try {
    return { path, record: JSON.parse(readFileSync(path, 'utf8')), error: null };
  } catch (error) {
    return { path, record: null, error: error.message };
  }
}

export function listOperations(options = {}) {
  const dir = operationDirectory(options);
  if (!existsSync(dir)) return [];
  return readdirSync(dir)
    .filter((name) => name.endsWith('.json'))
    .map((name) => readOperation(`${dir}/${name}`))
    .sort((a, b) =>
      String(b.record?.startedAt ?? '').localeCompare(String(a.record?.startedAt ?? '')),
    );
}

export function recoverInterruptedOperations({
  now = Date.now(),
  maxAgeMs = DEFAULT_INTERRUPTED_AFTER_MS,
  ...options
} = {}) {
  const recovered = [];
  for (const entry of listOperations(options)) {
    const started = Date.parse(entry.record?.startedAt ?? '');
    if (entry.record?.status !== 'running' || !Number.isFinite(started)) continue;
    if (now - started < maxAgeMs) continue;
    recovered.push(
      finishOperation(entry.path, {
        status: 'incomplete',
        phase: 'recovery',
        result: { category: 'interrupted', recovery: 'operation exceeded the stale threshold' },
        now,
      }),
    );
  }
  return recovered;
}

export function formatOperation(record) {
  if (!record) return 'corrupt operation record';
  const duration =
    record.durationMs == null ? 'running' : `${(record.durationMs / 1000).toFixed(1)}s`;
  return `${record.operationId} ${record.type} ${record.status} ${duration} ${record.destination?.name ?? ''}`.trim();
}

function main() {
  const args = process.argv.slice(2);
  const command = args[0] ?? 'history';
  const options = {};
  if (command === 'recover') {
    const recovered = recoverInterruptedOperations(options);
    console.log(`Recovered ${recovered.length} interrupted operation(s) as incomplete.`);
    return;
  }
  if (command === 'status') {
    const git = createGitAdapter();
    const upstream = gitText(git, [
      'rev-parse',
      '--abbrev-ref',
      '--symbolic-full-name',
      '@{upstream}',
    ]);
    const counts = upstream
      ? gitText(git, ['rev-list', '--left-right', '--count', `${upstream}...HEAD`]).split(/\s+/)
      : [];
    const status = gitText(git, ['status', '--porcelain=v1']);
    const result = {
      branch: gitText(git, ['branch', '--show-current']) || '(detached HEAD)',
      headSha: gitText(git, ['rev-parse', '--verify', 'HEAD^{commit}']) || null,
      upstream: upstream || null,
      behind: counts[0] ? Number(counts[0]) : null,
      ahead: counts[1] ? Number(counts[1]) : null,
      dirty: Boolean(status),
      hooksPath: gitText(git, ['config', '--get', 'core.hooksPath']) || null,
      remote: sanitizeRemoteUrl(gitText(git, ['remote', 'get-url', 'origin'])),
      operations: listOperations({ git }).map((entry) => ({
        operationId: entry.record?.operationId ?? null,
        status: entry.record?.status ?? 'corrupt',
        type: entry.record?.type ?? null,
      })),
    };
    console.log(JSON.stringify(result, null, 2));
    return;
  }
  if (command === 'export' || command === 'history') {
    const entries = listOperations(options);
    if (args.includes('--json') || command === 'export') {
      process.stdout.write(`${JSON.stringify(entries, null, 2)}\n`);
    } else {
      for (const entry of entries) console.log(formatOperation(entry.record));
      if (!entries.length) console.log('No local validation operations recorded.');
    }
    return;
  }
  if (command === 'doctor') {
    const git = createGitAdapter();
    const hooksPath = gitText(git, ['config', '--get', 'core.hooksPath']);
    const remote = gitText(git, ['remote', 'get-url', 'origin']);
    const result = {
      hooksPath: hooksPath || null,
      expectedHooksPath: '.githooks',
      hooksActive: hooksPath === '.githooks',
      remote: sanitizeRemoteUrl(remote),
      operations: listOperations(options).length,
    };
    console.log(JSON.stringify(result, null, 2));
    process.exitCode = result.hooksActive ? 0 : 1;
    return;
  }
  throw new Error(
    'usage: operation-history.mjs status | history [--json] | export | recover | doctor',
  );
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  try {
    main();
  } catch (error) {
    console.error(`operation history failed: ${error.message}`);
    process.exitCode = 1;
  }
}
