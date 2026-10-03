#!/usr/bin/env node

/** Read-only dependency advisory gate; no updates, ignores, or retry loops. */
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdirSync,
  mkdtempSync,
  openSync,
  readFileSync,
  rmSync,
  statSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { join, resolve } from 'node:path';
import { pathToFileURL } from 'node:url';
import { redactSensitive } from '../ci/failure-manifest.mjs';
import { runValidationCommand } from '../quality/heavy-lease.mjs';
import { verifyBuildAdvisoryMitigations } from './verify-build-advisory-mitigations.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');

const MAX_REPORT_BYTES = 16 * 1024 * 1024;
const npmSeverities = ['info', 'low', 'moderate', 'high', 'critical'];
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const count = (value) => Number.isSafeInteger(value) && value >= 0;

export function analyzeAudit(kind, result, report) {
  if (result.cleanupUnknown || result.remaining?.length)
    return { status: 'invalid', reason: 'owned command cleanup incomplete' };
  if (result.status === 124 || result.signal || result.status === null)
    return { status: 'external-blocked', reason: 'audit interrupted or timed out' };
  if (!object(report))
    return {
      status: result.status === 0 ? 'invalid' : 'external-blocked',
      reason: 'audit did not produce a valid JSON report',
    };
  if (kind === 'npm') {
    const metadata = report.metadata;
    const counts = metadata?.vulnerabilities;
    if (
      !object(metadata) ||
      !['dependencies', 'devDependencies', 'optionalDependencies', 'totalDependencies'].every(
        (key) => count(metadata[key]),
      ) ||
      metadata.devDependencies !== 0 ||
      metadata.totalDependencies <= 0 ||
      metadata.totalDependencies !== metadata.dependencies + metadata.optionalDependencies ||
      !object(counts) ||
      !object(report.advisories) ||
      !npmSeverities.every((severity) => count(counts[severity]))
    )
      return { status: 'invalid', reason: 'unsupported npm advisory report' };
    const total = npmSeverities.reduce((sum, severity) => sum + counts[severity], 0);
    if (total || Object.keys(report.advisories).length)
      return {
        status: 'vulnerable',
        reason: 'production npm advisories found',
        vulnerabilities: total,
      };
    return result.status === 0
      ? { status: 'pass', warnings: [] }
      : {
          status: 'external-blocked',
          reason: 'npm audit failed despite empty vulnerability report',
        };
  }
  const vulnerabilities = report.vulnerabilities;
  const settings = report.settings;
  if (
    !object(report.database) ||
    !count(report.database['advisory-count']) ||
    report.database['advisory-count'] === 0 ||
    !object(report.lockfile) ||
    !count(report.lockfile['dependency-count']) ||
    report.lockfile['dependency-count'] === 0 ||
    !object(vulnerabilities) ||
    typeof vulnerabilities.found !== 'boolean' ||
    !count(vulnerabilities.count) ||
    !Array.isArray(vulnerabilities.list) ||
    !object(report.warnings) ||
    !object(settings)
  )
    return { status: 'invalid', reason: 'unsupported Cargo advisory report' };
  if (
    !['ignore', 'target_arch', 'target_os'].every(
      (key) => Array.isArray(settings[key]) && settings[key].length === 0,
    ) ||
    settings.severity != null ||
    !Array.isArray(settings.informational_warnings) ||
    !['unmaintained', 'unsound', 'notice'].every((kindName) =>
      settings.informational_warnings.includes(kindName),
    )
  )
    return {
      status: 'invalid',
      reason: 'Cargo advisory report used ignores or target/severity/warning filtering',
    };
  if (vulnerabilities.found || vulnerabilities.count || vulnerabilities.list.length)
    return {
      status: 'vulnerable',
      reason: 'Rust vulnerabilities found',
      vulnerabilities: vulnerabilities.count,
    };
  const warnings = [];
  for (const [kindName, entries] of Object.entries(report.warnings)) {
    if (!Array.isArray(entries))
      return { status: 'invalid', reason: 'invalid Cargo warning records' };
    for (const warning of entries) {
      if (
        !object(warning) ||
        !object(warning.package) ||
        typeof warning.package.name !== 'string' ||
        typeof warning.package.version !== 'string'
      )
        return { status: 'invalid', reason: 'invalid Cargo warning identity' };
      warnings.push({
        kind: kindName,
        package: warning.package.name,
        version: warning.package.version,
        advisory: warning.advisory?.id ?? null,
      });
    }
  }
  return result.status === 0
    ? { status: 'pass', warnings }
    : {
        status: 'external-blocked',
        reason: 'Cargo audit failed despite empty vulnerability report',
        warnings,
      };
}

function safeReport(value) {
  if (typeof value === 'string') return redactSensitive(value);
  if (Array.isArray(value)) return value.map(safeReport);
  if (object(value))
    return Object.fromEntries(
      Object.entries(value).map(([key, item]) => [
        key,
        /(?:token|password|secret|authorization|credential|api[_-]?key|private[_-]?key)/i.test(key)
          ? '<redacted>'
          : safeReport(item),
      ]),
    );
  return value;
}

function boundedText(file) {
  if (statSync(file).size > MAX_REPORT_BYTES)
    throw new Error('audit report exceeded the bounded size');
  return readFileSync(file, 'utf8');
}

export function assertNoNpmIgnores(workspace, manifest) {
  for (const config of [workspace, manifest, manifest?.pnpm]) {
    for (const ignores of [
      config?.auditConfig?.ignoreGhsas,
      config?.auditConfig?.ignoreCves,
      config?.audit?.ignore,
    ]) {
      if (ignores !== undefined && (!Array.isArray(ignores) || ignores.length > 0))
        throw new Error('npm advisory ignore configuration is prohibited in this gate');
    }
  }
}

export async function runAdvisoryGate({
  root = process.cwd(),
  output = join(root, 'reports/dependency-advisories'),
  run = runValidationCommand,
} = {}) {
  mkdirSync(output, { recursive: true });
  const scratch = mkdtempSync(join(tmpdir(), 'varve-advisory-gate-'));
  const specifications = [
    {
      id: 'npm-production',
      kind: 'npm',
      lockfile: 'pnpm-lock.yaml',
      argv: ['pnpm', 'audit', '--prod', '--audit-level=low', '--json'],
    },
    {
      id: 'cargo-root',
      kind: 'cargo',
      lockfile: 'Cargo.lock',
      argv: [
        'cargo',
        'audit',
        '--file',
        'Cargo.lock',
        '--db',
        join(scratch, 'advisory-db'),
        '--json',
      ],
    },
    {
      id: 'cargo-desktop',
      kind: 'cargo',
      lockfile: 'apps/desktop/src-tauri/Cargo.lock',
      argv: [
        'cargo',
        'audit',
        '--file',
        'apps/desktop/src-tauri/Cargo.lock',
        '--db',
        join(scratch, 'advisory-db'),
        '--no-fetch',
        '--json',
      ],
    },
  ];
  const summary = { schema: 1, checkedAt: new Date().toISOString(), scopes: [] };
  try {
    assertNoNpmIgnores(
      yaml.load(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8')),
      JSON.parse(readFileSync(join(root, 'package.json'), 'utf8')),
    );
    for (const specification of specifications) {
      const stdoutPath = join(scratch, `${specification.id}.stdout`);
      const stderrPath = join(scratch, `${specification.id}.stderr`);
      const stdout = openSync(stdoutPath, 'wx', 0o600);
      const stderr = openSync(stderrPath, 'wx', 0o600);
      let result;
      try {
        result = await run(specification.argv, {
          cwd: root,
          timeoutMs: 180000,
          stdio: ['ignore', stdout, stderr],
        });
      } finally {
        closeSync(stdout);
        closeSync(stderr);
      }
      let rawText = null;
      let report = null;
      let parseFailure = null;
      try {
        rawText = boundedText(stdoutPath);
        report = JSON.parse(rawText);
      } catch {
        parseFailure = 'missing, malformed, or oversized report';
      }
      const outcome = analyzeAudit(specification.kind, result, report);
      const entry = {
        id: specification.id,
        lockfile: specification.lockfile,
        lockfileSha256: createHash('sha256')
          .update(readFileSync(join(root, specification.lockfile)))
          .digest('hex'),
        exitCode: result.status,
        ...outcome,
        parseFailure,
        rawReportSha256:
          rawText === null ? null : createHash('sha256').update(rawText).digest('hex'),
      };
      const rawSafe = JSON.stringify(safeReport(report)) === JSON.stringify(report);
      if (specification.kind === 'npm' && outcome.status === 'vulnerable') {
        const mitigation = rawSafe
          ? await verifyBuildAdvisoryMitigations({
              root,
              report,
              result,
              rawSha256: entry.rawReportSha256,
              output,
            })
          : { effectiveStatus: 'blocked', reason: 'raw audit required credential redaction' };
        entry.effectiveStatus = mitigation.effectiveStatus;
        entry.rawVulnerabilities = outcome.vulnerabilities;
        entry.rawHigh = report?.metadata?.vulnerabilities?.high ?? null;
        entry.localMitigations = mitigation.localMitigations ?? 0;
        entry.upstreamUnfixed = mitigation.upstreamUnfixed ?? null;
        entry.upstreamReview = mitigation.upstreamReview ?? null;
        writeFileSync(
          join(output, 'npm-local-mitigations.json'),
          `${JSON.stringify(safeReport(mitigation), null, 2)}\n`,
        );
      }
      summary.scopes.push(entry);
      writeFileSync(
        join(output, `${specification.id}.json`),
        specification.kind === 'npm' && rawSafe && rawText !== null
          ? rawText
          : `${JSON.stringify(safeReport(report), null, 2)}\n`,
        { mode: 0o600 },
      );
      let diagnostic;
      try {
        diagnostic = redactSensitive(boundedText(stderrPath));
      } catch {
        diagnostic = 'diagnostic omitted: bounded size exceeded\n';
      }
      writeFileSync(join(output, `${specification.id}.stderr.log`), diagnostic);
      if (entry.effectiveStatus === 'locally-mitigated') {
        console.log(`Raw dependency advisory: ${JSON.stringify(safeReport(entry))}`);
        console.log(
          `Dependency advisory effective: ${JSON.stringify(
            safeReport({
              id: entry.id,
              effectiveStatus: entry.effectiveStatus,
              rawStatus: entry.status,
              rawVulnerabilities: entry.rawVulnerabilities,
              rawHigh: entry.rawHigh,
              localMitigations: entry.localMitigations,
              upstreamUnfixed: entry.upstreamUnfixed,
              upstreamReview: entry.upstreamReview,
            }),
          )}`,
        );
      } else console.log(`Dependency advisory: ${JSON.stringify(safeReport(entry))}`);
    }
  } finally {
    rmSync(scratch, { recursive: true, force: true });
    summary.status =
      summary.scopes.length === specifications.length &&
      summary.scopes.every((scope) => scope.status === 'pass')
        ? 'pass'
        : 'fail';
    summary.effectiveStatus =
      summary.status === 'pass'
        ? 'pass'
        : summary.scopes.length === specifications.length &&
            summary.scopes.every(
              (scope) =>
                scope.status === 'pass' ||
                (scope.id === 'npm-production' &&
                  scope.status === 'vulnerable' &&
                  scope.effectiveStatus === 'locally-mitigated'),
            )
          ? 'locally-mitigated'
          : 'blocked';
    const npm = summary.scopes.find((scope) => scope.id === 'npm-production');
    summary.rawVulnerabilities = npm?.status === 'pass' ? 0 : (npm?.vulnerabilities ?? null);
    summary.rawHigh = npm?.status === 'pass' ? 0 : (npm?.rawHigh ?? null);
    summary.localMitigations = npm?.localMitigations ?? 0;
    summary.upstreamUnfixed = npm?.status === 'pass' ? false : (npm?.upstreamUnfixed ?? null);
    summary.upstreamReview = npm?.upstreamReview ?? null;
    writeFileSync(
      join(output, 'summary.json'),
      `${JSON.stringify(safeReport(summary), null, 2)}\n`,
    );
  }
  return summary;
}

if (process.argv[1] && import.meta.url === pathToFileURL(resolve(process.argv[1])).href) {
  try {
    const summary = await runAdvisoryGate();
    process.exitCode = ['pass', 'locally-mitigated'].includes(summary.effectiveStatus) ? 0 : 1;
  } catch {
    console.error('Dependency advisory gate failed; inspect sanitized retained reports.');
    process.exitCode = 1;
  }
}
