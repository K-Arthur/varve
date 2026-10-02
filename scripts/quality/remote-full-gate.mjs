/** A remote full gate adopts CI; it never dispatches, retries, tags or publishes. */
import { spawnSync } from 'node:child_process';
import { frozenSource, runFullGate } from './full-gate.mjs';
import { finishOperation, startOperation } from './operation-history.mjs';
import { verifyRemoteFullEvidence } from './remote-full-evidence.mjs';
import { computePolicyHash } from './validation-policy.mjs';

export const REMOTE_FULL_COMPLEMENT = Object.freeze([
  { label: 'Emoji audit', argv: ['pnpm', 'audit:emoji'] },
  { label: 'Health audit', argv: ['node', 'scripts/audit-health.mjs'] },
  { label: 'Architecture audit', argv: ['node', 'scripts/audit-architecture.mjs', '--ci'] },
]);

function git(root, argv) {
  const result = spawnSync('git', argv, {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 5000,
  });
  if (result.status !== 0) throw new Error('Could not read the local Git identity');
  return result.stdout.trim();
}

function repositoryName(root, environment) {
  if (environment.GITHUB_REPOSITORY) return environment.GITHUB_REPOSITORY;
  const remote = git(root, ['remote', 'get-url', 'origin']);
  const match = remote.match(
    /^(?:git@github\.com:|https:\/\/github\.com\/)([^/]+\/[^/]+?)(?:\.git)?$/,
  );
  if (!match) throw new Error('Remote full gate requires an explicit GitHub --repo');
  return match[1];
}

function authToken(root, environment) {
  if (environment.GITHUB_TOKEN || environment.GH_TOKEN)
    return environment.GITHUB_TOKEN || environment.GH_TOKEN;
  const result = spawnSync('gh', ['auth', 'token'], {
    cwd: root,
    encoding: 'utf8',
    shell: false,
    timeout: 5000,
  });
  if (result.status !== 0 || !result.stdout.trim())
    throw Object.assign(
      new Error('GitHub read access is unavailable; authenticate gh or set GITHUB_TOKEN'),
      { external: true },
    );
  return result.stdout.trim();
}

function value(args, flag) {
  const index = args.indexOf(flag);
  if (index === -1) return null;
  if (!args[index + 1] || args[index + 1].startsWith('--'))
    throw new Error(`${flag} requires a value`);
  return args[index + 1];
}

function sameEvidence(first, second) {
  return ['integration', 'candidate'].every(
    (profile) =>
      first.evidence[profile].binding.runId === second.evidence[profile].binding.runId &&
      first.evidence[profile].binding.runAttempt === second.evidence[profile].binding.runAttempt &&
      first.evidence[profile].summary.artifactId === second.evidence[profile].summary.artifactId &&
      first.evidence[profile].summary.digest === second.evidence[profile].summary.digest &&
      first.evidence[profile].plan.digest === second.evidence[profile].plan.digest,
  );
}

export async function runRemoteFullGate({
  root = process.cwd(),
  args = [],
  execute,
  environment = process.env,
  verify = verifyRemoteFullEvidence,
  complement = runFullGate,
} = {}) {
  const source = frozenSource(root);
  const operation = startOperation({
    type: 'remote-full-gate',
    cwd: root,
    requested: {
      commitSha: source.commitSha,
      reason: environment.VARVE_FULL_GATE_REASON ?? null,
      policyHash: computePolicyHash({ root }),
      resume: args.includes('--resume'),
      statusOnly: args.includes('--status'),
    },
  });
  const finish = (status, result) => {
    finishOperation(operation.path, {
      status:
        status === 0
          ? 'completed'
          : status === 2
            ? 'incomplete'
            : status === 3
              ? 'blocked'
              : result.local?.outcomes?.some((outcome) => outcome.signal)
                ? 'cancelled'
                : 'failed',
      exitCode: status,
      result,
    });
    return { status, ...result, operationPath: operation.path };
  };
  try {
    if (!source.clean || git(root, ['symbolic-ref', '--short', 'HEAD']) !== 'master')
      throw new Error('Remote full gate requires a clean, committed master candidate');
    const requestedSha = value(args, '--sha');
    if (requestedSha && requestedSha !== source.commitSha)
      throw new Error('--sha must match the frozen local HEAD');
    const repo = value(args, '--repo') || repositoryName(root, environment);
    const identity = {
      repo,
      token: authToken(root, environment),
      ...source,
      policyHash: computePolicyHash({ root }),
    };
    const before = await verify(identity);
    if (before.status !== 0) return finish(before.status, before);
    if (args.includes('--status'))
      return finish(2, {
        classification: 'status-only',
        remote: before,
        message:
          'Remote certification is complete. Status-only did not run the required local audit complement.',
      });
    const local = await complement(REMOTE_FULL_COMPLEMENT, {
      root,
      execute,
      resume: args.includes('--resume'),
      environment,
    });
    if (local.status !== 0)
      return finish(local.status, { classification: 'local-complement-failed', local });
    const afterSource = frozenSource(root);
    if (!afterSource.clean || afterSource.commitSha !== source.commitSha)
      throw new Error('Source changed while verifying the full gate');
    const after = await verify(identity);
    if (after.status !== 0) return finish(after.status, after);
    if (!sameEvidence(before, after))
      throw new Error(
        'Remote certification changed during the local complement; inspect the newest attempt',
      );
    return finish(0, {
      classification: 'passed',
      remote: after,
      local,
      message:
        'Full gate passed using exact-SHA full integration, final candidate, and local audit complement.',
    });
  } catch (error) {
    const external =
      error.external ||
      ['AbortError', 'TimeoutError'].includes(error.name) ||
      /^(GitHub API|fetch failed)/.test(error.message);
    return finish(external ? 3 : 1, {
      classification: external ? 'external-blocked' : 'invalid-evidence',
      message: error.message,
    });
  }
}
