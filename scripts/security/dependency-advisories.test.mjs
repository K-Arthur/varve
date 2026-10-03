import assert from 'node:assert/strict';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { test } from 'node:test';
import { analyzeAudit, assertNoNpmIgnores, runAdvisoryGate } from './dependency-advisories.mjs';

const cleanExit = { status: 0, signal: null, remaining: [], cleanupUnknown: false };
const npm = () => ({
  advisories: {},
  metadata: {
    dependencies: 1,
    devDependencies: 0,
    optionalDependencies: 1,
    totalDependencies: 2,
    vulnerabilities: { info: 0, low: 0, moderate: 0, high: 0, critical: 0 },
  },
});
const cargo = () => ({
  database: { 'advisory-count': 1 },
  lockfile: { 'dependency-count': 1 },
  settings: {
    ignore: [],
    target_arch: [],
    target_os: [],
    severity: null,
    informational_warnings: ['unmaintained', 'unsound', 'notice'],
  },
  vulnerabilities: { found: false, count: 0, list: [] },
  warnings: {},
});

test('clean npm report passes; a real production advisory fails even with exit zero', () => {
  assert.equal(analyzeAudit('npm', cleanExit, npm()).status, 'pass');
  const bad = npm();
  bad.metadata.vulnerabilities.high = 1;
  bad.advisories.GHSA = { severity: 'high' };
  assert.equal(analyzeAudit('npm', cleanExit, bad).status, 'vulnerable');
});
test('npm report cannot pass malformed counts, missing output, or a registry exit failure', () => {
  assert.equal(analyzeAudit('npm', cleanExit, {}).status, 'invalid');
  assert.equal(analyzeAudit('npm', cleanExit, null).status, 'invalid');
  assert.equal(analyzeAudit('npm', { ...cleanExit, status: 1 }, null).status, 'external-blocked');
  assert.equal(analyzeAudit('npm', { ...cleanExit, status: 1 }, npm()).status, 'external-blocked');
});
test('glib unsoundness and maintenance warnings remain visible without hiding vulnerabilities', () => {
  const report = cargo();
  report.warnings.unsound = [
    { package: { name: 'glib', version: '0.18.5' }, advisory: { id: 'RUSTSEC-2024-0429' } },
  ];
  report.warnings.unmaintained = [
    { package: { name: 'rustybuzz', version: '0.20.1' }, advisory: { id: 'RUSTSEC-2026-0206' } },
  ];
  const outcome = analyzeAudit('cargo', cleanExit, report);
  assert.equal(outcome.status, 'pass');
  assert.deepEqual(
    outcome.warnings.map((warning) => warning.advisory),
    ['RUSTSEC-2024-0429', 'RUSTSEC-2026-0206'],
  );
  report.vulnerabilities.list.push({ advisory: { id: 'RUSTSEC-test-vulnerability' } });
  assert.equal(analyzeAudit('cargo', cleanExit, report).status, 'vulnerable');
});
test('filtered or ignored Cargo reports fail closed, and vulnerability fields independently block', () => {
  for (const key of ['ignore', 'target_arch', 'target_os']) {
    const report = cargo();
    report.settings[key].push('hidden');
    assert.equal(analyzeAudit('cargo', cleanExit, report).status, 'invalid');
  }
  const severity = cargo();
  severity.settings.severity = 'high';
  assert.equal(analyzeAudit('cargo', cleanExit, severity).status, 'invalid');
  for (const key of ['found', 'count']) {
    const report = cargo();
    report.vulnerabilities[key] = key === 'found' ? true : 1;
    assert.equal(analyzeAudit('cargo', cleanExit, report).status, 'vulnerable');
  }
});
test('deadline, cancellation, and owned-process cleanup failures cannot pass valid reports', () => {
  assert.equal(
    analyzeAudit('npm', { ...cleanExit, status: 124 }, npm()).status,
    'external-blocked',
  );
  assert.equal(
    analyzeAudit('npm', { ...cleanExit, signal: 'SIGTERM' }, npm()).status,
    'external-blocked',
  );
  assert.equal(
    analyzeAudit('npm', { ...cleanExit, cleanupUnknown: true }, npm()).status,
    'invalid',
  );
});
test('bounded gate runs all three graphs once and retains only sanitized diagnostics after npm failure', async () => {
  const root = mkdtempSync(join(tmpdir(), 'varve-advisory-test-'));
  const fs = await import('node:fs');
  fs.mkdirSync(join(root, 'apps/desktop/src-tauri'), { recursive: true });
  for (const lockfile of ['pnpm-lock.yaml', 'Cargo.lock', 'apps/desktop/src-tauri/Cargo.lock'])
    writeFileSync(join(root, lockfile), lockfile);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(join(root, 'package.json'), '{}\n');
  const calls = [];
  const fixtureValue = 'this-is-a-fixture-secret';
  try {
    const summary = await runAdvisoryGate({
      root,
      log: () => {},
      run: async (argv, options) => {
        calls.push(argv);
        assert.equal(options.timeoutMs, 180000);
        const report = calls.length === 1 ? npm() : cargo();
        if (calls.length === 1) report.metadata.vulnerabilities.high = 1;
        report.registry = `https://user:${fixtureValue}@example.invalid/a?token=${fixtureValue}`;
        report.access_token = fixtureValue;
        writeFileSync(options.stdio[1], JSON.stringify(report));
        writeFileSync(options.stdio[2], `registry ${report.registry}\n`);
        return { ...cleanExit, status: calls.length === 1 ? 1 : 0 };
      },
    });
    assert.equal(summary.status, 'fail');
    assert.equal(calls.length, 3);
    assert.deepEqual(calls[0], ['pnpm', 'audit', '--prod', '--audit-level=low', '--json']);
    assert.equal(calls[1][calls[1].indexOf('--file') + 1], 'Cargo.lock');
    assert.equal(calls[2][calls[2].indexOf('--file') + 1], 'apps/desktop/src-tauri/Cargo.lock');
    assert.ok(calls[2].includes('--no-fetch'));
    assert.equal(calls[1][calls[1].indexOf('--db') + 1], calls[2][calls[2].indexOf('--db') + 1]);
    assert.equal(summary.scopes.length, 3);
    for (const scope of summary.scopes) {
      assert.match(scope.lockfileSha256, /^[a-f0-9]{64}$/);
      assert.ok(
        !readFileSync(
          join(root, 'reports/dependency-advisories', `${scope.id}.json`),
          'utf8',
        ).includes(fixtureValue),
      );
      assert.ok(
        !readFileSync(
          join(root, 'reports/dependency-advisories', `${scope.id}.stderr.log`),
          'utf8',
        ).includes(fixtureValue),
      );
    }
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});

test('both existing pipeline jobs own the strict scanner and its diagnostic upload', async () => {
  const { createRequire } = await import('node:module');
  const { resolve } = await import('node:path');
  const repoRoot = resolve(import.meta.dirname, '../..');
  const yaml = createRequire(join(repoRoot, 'package.json'))('js-yaml');
  for (const file of ['ci.yml', 'release-candidate.yml']) {
    const doc = yaml.load(readFileSync(join(repoRoot, '.github/workflows', file), 'utf8'));
    const steps = doc.jobs['pipeline-validate'].steps;
    const install = steps.find(
      (step) => step.name === 'Install pinned advisory scanner (verified)',
    );
    assert.equal(install.uses, 'taiki-e/install-action@9983c65e42da123ff25d1f78505eb6de315aa172');
    assert.deepEqual(install.with, {
      tool: 'cargo-audit@0.22.2',
      checksum: true,
      fallback: 'none',
    });
    const scan = steps.find(
      (step) => step.run === 'node scripts/security/dependency-advisories.mjs',
    );
    assert.ok(scan);
    assert.equal(scan.if, undefined);
    assert.equal(scan['continue-on-error'], undefined);
    const upload = steps.find((step) => step.with?.path === 'reports/dependency-advisories/');
    assert.equal(upload.if, 'always()');
    assert.match(upload.uses, /^actions\/upload-artifact@[a-f0-9]{40}$/);
    assert.ok(steps.indexOf(install) < steps.indexOf(scan));
    assert.ok(steps.indexOf(scan) < steps.indexOf(upload));
  }
  assert.match(
    readFileSync(join(repoRoot, 'scripts/quality/validation-policy.mjs'), 'utf8'),
    /'scripts\/security\/dependency-advisories\.mjs'/,
  );
  assert.match(
    readFileSync(join(repoRoot, 'package.json'), 'utf8'),
    /node --test scripts\/security\/dependency-advisories\.test\.mjs/,
  );
});

test('production advisory ignores cannot silently hide vulnerable packages', () => {
  assertNoNpmIgnores({ auditConfig: { ignoreGhsas: [] } }, {});
  assert.throws(() => assertNoNpmIgnores({ auditConfig: { ignoreGhsas: ['GHSA-test'] } }, {}));
  assert.throws(() => assertNoNpmIgnores({ audit: { ignore: ['GHSA-test'] } }, {}));
  assert.throws(() =>
    assertNoNpmIgnores({}, { pnpm: { auditConfig: { ignoreGhsas: ['GHSA-test'] } } }),
  );
});

test('partial or empty graph/database reports and disabled warning categories cannot pass', () => {
  const missingNpm = npm();
  delete missingNpm.metadata.totalDependencies;
  assert.equal(analyzeAudit('npm', cleanExit, missingNpm).status, 'invalid');
  const devNpm = npm();
  devNpm.metadata.devDependencies = 1;
  assert.equal(analyzeAudit('npm', cleanExit, devNpm).status, 'invalid');
  for (const field of ['database', 'lockfile']) {
    const missing = cargo();
    delete missing[field];
    assert.equal(analyzeAudit('cargo', cleanExit, missing).status, 'invalid');
  }
  const hiddenWarnings = cargo();
  hiddenWarnings.settings.informational_warnings = ['unmaintained'];
  assert.equal(analyzeAudit('cargo', cleanExit, hiddenWarnings).status, 'invalid');
});

test('raw npm report bytes survive unchanged while an unverified known mitigation remains blocking', async () => {
  const root = mkdtempSync(join(tmpdir(), 'varve-raw-advisory-'));
  const fs = await import('node:fs');
  fs.mkdirSync(join(root, 'apps/desktop/src-tauri'), { recursive: true });
  for (const lockfile of ['pnpm-lock.yaml', 'Cargo.lock', 'apps/desktop/src-tauri/Cargo.lock'])
    writeFileSync(join(root, lockfile), lockfile);
  writeFileSync(join(root, 'pnpm-workspace.yaml'), 'packages: []\n');
  writeFileSync(join(root, 'package.json'), '{}\n');
  const { REVIEWED_MITIGATIONS } = await import('./verify-build-advisory-mitigations.mjs');
  const report = npm();
  report.metadata.vulnerabilities.high = 2;
  report.advisories = Object.fromEntries(
    REVIEWED_MITIGATIONS.map((item) => [
      item.id,
      {
        id: item.id,
        module_name: item.package,
        github_advisory_id: item.advisory,
        severity: 'high',
        vulnerable_versions: `<=${item.version}`,
        url: `https://github.com/advisories/${item.advisory}`,
        findings: [
          {
            version: item.version,
            paths: [...item.paths],
            dev: false,
            optional: false,
            bundled: false,
          },
        ],
      },
    ]),
  );
  const bytes = `\n${JSON.stringify(report, null, 3)}\n\n`;
  let calls = 0;
  try {
    const summary = await runAdvisoryGate({
      root,
      log: () => {},
      run: async (_argv, options) => {
        calls++;
        writeFileSync(options.stdio[1], calls === 1 ? bytes : JSON.stringify(cargo()));
        return { ...cleanExit, status: calls === 1 ? 1 : 0 };
      },
    });
    assert.equal(calls, 3);
    assert.equal(summary.status, 'fail');
    assert.equal(summary.effectiveStatus, 'blocked');
    assert.equal(summary.scopes[0].status, 'vulnerable');
    assert.equal(summary.rawVulnerabilities, 2);
    assert.equal(summary.rawHigh, 2);
    assert.equal(summary.localMitigations, 0);
    assert.equal(
      readFileSync(join(root, 'reports/dependency-advisories/npm-production.json'), 'utf8'),
      bytes,
    );
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
});
