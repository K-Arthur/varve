/** Exact reviewed local backports; upstream audit classification stays vulnerable. */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import {
  closeSync,
  mkdtempSync,
  openSync,
  readdirSync,
  readFileSync,
  realpathSync,
  statSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { dirname, isAbsolute, join, relative, sep } from 'node:path';
import { runValidationCommand } from '../quality/heavy-lease.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
export const RUNTIME_OWNER = 'scripts/security/build-dependency-mitigations.test.mjs';
const RUNTIME_SHA256 = 'eb9577e92c082718ad5b508634bf7e38266d93be935bd7cae25ed74498f26eac';
export const REVIEWED_MITIGATIONS = Object.freeze([
  Object.freeze({
    id: 1240991,
    advisory: 'GHSA-ch52-4w7c-c8xp',
    package: 'http-cache-semantics',
    version: '4.2.0',
    patch: 'patches/http-cache-semantics@4.2.0.patch',
    patchSha256: '00081c28f0de3c02cf9f13225009b869ec536e1d0928ae022f20af5b517cf6eb',
    source: 'index.js',
    sourceSha256: 'f65c2399853aa1c0b96d5319c9c5da0617ce56430ba3e2bf0fec0af7baf79191',
    paths: Object.freeze([
      'apps__website>@astrojs/tailwind>astro>http-cache-semantics',
      'apps__website>astro>http-cache-semantics',
    ]),
  }),
  Object.freeze({
    id: 1240992,
    advisory: 'GHSA-vfj7-8cjw-p6xm',
    package: 'braces',
    version: '3.0.3',
    patch: 'patches/braces@3.0.3.patch',
    patchSha256: 'a6e05b72366c236c173e82dfdb1ef4062020f7ef190f9fdd72955ae33a8ec874',
    source: 'lib/parse.js',
    sourceSha256: '71ad1027c2ae4bc149dc5d2d5444227e6904ac6e6001c234af0cdd98d15dfffa',
    paths: Object.freeze([
      'apps__website>@astrojs/tailwind>tailwindcss>chokidar>braces',
      'apps__website>@astrojs/tailwind>tailwindcss>fast-glob>micromatch>braces',
      'apps__website>@astrojs/tailwind>tailwindcss>micromatch>braces',
    ]),
  }),
]);
export const UPSTREAM_REVIEW = Object.freeze({
  reviewedAt: '2026-10-03T01:51:34.559742Z',
  statement:
    'No published upstream fix was available at this review timestamp; this is a reviewed snapshot, not an evergreen registry claim.',
  sources: Object.freeze(
    REVIEWED_MITIGATIONS.map((item) =>
      Object.freeze({
        advisory: `https://github.com/advisories/${item.advisory}`,
        registry: `https://registry.npmjs.org/${item.package}`,
      }),
    ),
  ),
});
const sha256 = (bytes) => createHash('sha256').update(bytes).digest('hex');
const requireThat = (condition, message) => {
  if (!condition) throw new Error(message);
};
const object = (value) => value !== null && typeof value === 'object' && !Array.isArray(value);
const exactKeys = (value, keys) =>
  object(value) && Object.keys(value).sort().join('|') === [...keys].sort().join('|');
const goodResult = (result, status) =>
  result?.status === status &&
  !result.signal &&
  !result.cleanupUnknown &&
  !result.remaining?.length;
const closureFiles = [
  'pnpm-workspace.yaml',
  'pnpm-lock.yaml',
  'package.json',
  'apps/website/package.json',
  RUNTIME_OWNER,
  ...REVIEWED_MITIGATIONS.map((item) => item.patch),
];

/** No removal of findings: the complete raw production graph must match exactly. */
export function matchReviewedFindings(report, result) {
  requireThat(
    goodResult(result, 1),
    'raw audit did not complete with expected advisory exit status',
  );
  requireThat(exactKeys(report, ['advisories', 'metadata']), 'unsupported raw npm report shape');
  const metadata = report.metadata;
  requireThat(
    exactKeys(metadata, [
      'vulnerabilities',
      'dependencies',
      'devDependencies',
      'optionalDependencies',
      'totalDependencies',
    ]),
    'unsupported raw npm metadata',
  );
  requireThat(
    ['dependencies', 'optionalDependencies', 'totalDependencies'].every(
      (key) => Number.isSafeInteger(metadata[key]) && metadata[key] >= 0,
    ) &&
      metadata.dependencies > 0 &&
      metadata.devDependencies === 0 &&
      metadata.totalDependencies === metadata.dependencies + metadata.optionalDependencies,
    'incomplete production dependency graph',
  );
  requireThat(
    exactKeys(metadata.vulnerabilities, ['info', 'low', 'moderate', 'high', 'critical']) &&
      ['info', 'low', 'moderate', 'critical'].every((key) => metadata.vulnerabilities[key] === 0) &&
      metadata.vulnerabilities.high === 2,
    'raw vulnerability counts do not match two reviewed HIGH advisories',
  );
  requireThat(
    exactKeys(
      report.advisories,
      REVIEWED_MITIGATIONS.map((item) => String(item.id)),
    ),
    'unreviewed or missing advisory',
  );
  for (const item of REVIEWED_MITIGATIONS) {
    const advisory = report.advisories[item.id];
    requireThat(
      object(advisory) &&
        advisory.id === item.id &&
        advisory.github_advisory_id === item.advisory &&
        advisory.module_name === item.package &&
        advisory.severity === 'high' &&
        advisory.vulnerable_versions === `<=${item.version}` &&
        advisory.url === `https://github.com/advisories/${item.advisory}`,
      'advisory identity, severity or affected range mismatch',
    );
    requireThat(
      Array.isArray(advisory.findings) && advisory.findings.length === 1,
      'unexpected advisory finding count',
    );
    const finding = advisory.findings[0];
    requireThat(
      exactKeys(finding, ['version', 'paths', 'dev', 'optional', 'bundled']) &&
        finding.version === item.version &&
        finding.dev === false &&
        finding.optional === false &&
        finding.bundled === false,
      'advisory installed version or owner classification mismatch',
    );
    requireThat(
      Array.isArray(finding.paths) &&
        finding.paths.length === item.paths.length &&
        finding.paths.every((path) => typeof path === 'string') &&
        [...finding.paths].sort().join('|') === [...item.paths].sort().join('|'),
      'unreviewed or missing dependency path',
    );
  }
  return REVIEWED_MITIGATIONS.map((item) => ({
    advisory: item.advisory,
    package: item.package,
    version: item.version,
    paths: [...item.paths],
  }));
}

function gitRead(root, args) {
  const result = spawnSync('git', args, {
    cwd: root,
    encoding: null,
    timeout: 5000,
    maxBuffer: 16 * 1024 * 1024,
  });
  requireThat(
    result.status === 0 && !result.signal && !result.error,
    'committed source identity could not be read',
  );
  return result.stdout;
}
function committedClosure(root, git = gitRead) {
  const sourceSha = git(root, ['rev-parse', 'HEAD']).toString().trim();
  requireThat(/^[a-f0-9]{40}$/.test(sourceSha), 'invalid committed source SHA');
  const files = {};
  for (const file of closureFiles) {
    const bytes = readFileSync(join(root, file));
    requireThat(
      bytes.equals(git(root, ['show', `${sourceSha}:${file}`])),
      `uncommitted mitigation input: ${file}`,
    );
    files[file] = sha256(bytes);
  }
  requireThat(
    files[RUNTIME_OWNER] === RUNTIME_SHA256,
    'runtime owner does not match reviewed test source',
  );
  return { sourceSha, files };
}
export function inside(root, path, pathApi = { relative, isAbsolute, sep }) {
  const value = pathApi.relative(root, path);
  return value !== '..' && !value.startsWith(`..${pathApi.sep}`) && !pathApi.isAbsolute(value);
}

/** Verify every reachable package source through all five consumers; store names may be shortened. */
export function inspectInstalledMitigations(root) {
  root = realpathSync(root);
  const workspace = yaml.load(readFileSync(join(root, 'pnpm-workspace.yaml'), 'utf8'));
  const lock = yaml.load(readFileSync(join(root, 'pnpm-lock.yaml'), 'utf8'));
  requireThat(
    object(lock?.snapshots) && object(lock?.patchedDependencies),
    'missing pnpm patch snapshots or metadata',
  );
  const store = realpathSync(join(root, 'node_modules/.pnpm'));
  requireThat(inside(root, store), 'pnpm store lies outside reviewed checkout');
  const modules = [];
  for (const item of REVIEWED_MITIGATIONS) {
    const identity = `${item.package}@${item.version}`;
    const snapshot = `${identity}(patch_hash=${item.patchSha256})`;
    const patch = realpathSync(join(root, item.patch));
    requireThat(
      inside(root, patch) && sha256(readFileSync(patch)) === item.patchSha256,
      'reviewed patch bytes mismatch',
    );
    requireThat(
      workspace?.patchedDependencies?.[identity] === item.patch &&
        lock.patchedDependencies[identity] === item.patchSha256,
      'workspace or lock patch declaration mismatch',
    );
    const snapshots = Object.keys(lock.snapshots).filter(
      (key) => key === identity || key.startsWith(`${identity}(`),
    );
    requireThat(
      snapshots.length === 1 && snapshots[0] === snapshot,
      'missing patched snapshot or unpatched same-version snapshot',
    );
    for (const entry of Object.values(lock.snapshots)) {
      for (const kind of ['dependencies', 'optionalDependencies']) {
        const version = entry?.[kind]?.[item.package];
        requireThat(
          version === undefined ||
            (typeof version === 'string' &&
              (!(version === item.version || version.startsWith(`${item.version}(`)) ||
                version === `${item.version}(patch_hash=${item.patchSha256})`)),
          'unpatched same-version dependency reference',
        );
      }
    }
    const copies = readdirSync(store).filter(
      (name) =>
        name === identity || name.startsWith(`${identity}_`) || name.startsWith(`${identity}(`),
    );
    const canonical = new Set();
    const reachableCopies = new Set();
    const consumers = [];
    for (const path of item.paths) {
      let owner = createRequire(join(root, 'apps/website/package.json'));
      const chain = path.split('>').slice(1);
      let entry;
      for (const dependency of chain) {
        entry = realpathSync(owner.resolve(dependency));
        requireThat(inside(root, entry), 'consumer dependency resolved outside reviewed checkout');
        owner = createRequire(entry);
      }
      const packageRoot = dirname(entry);
      const parts = relative(store, packageRoot).split(sep);
      requireThat(
        inside(store, packageRoot) &&
          parts.length === 3 &&
          parts[1] === 'node_modules' &&
          parts[2] === item.package,
        'consumer package is outside the canonical pnpm store',
      );
      const packageMetadata = JSON.parse(readFileSync(join(packageRoot, 'package.json'), 'utf8'));
      requireThat(
        packageMetadata.name === item.package && packageMetadata.version === item.version,
        'installed package name or version mismatch',
      );
      const source = realpathSync(join(packageRoot, item.source));
      requireThat(
        inside(packageRoot, source),
        'installed modified source escaped its canonical package',
      );
      const sourceSha256 = sha256(readFileSync(source));
      requireThat(sourceSha256 === item.sourceSha256, 'installed modified source hash mismatch');
      canonical.add(packageRoot);
      reachableCopies.add(parts[0]);
      consumers.push({ path, entry: relative(root, entry), sourceSha256 });
    }
    modules.push({
      advisory: item.advisory,
      package: item.package,
      version: item.version,
      patchSha256: item.patchSha256,
      sourceSha256: item.sourceSha256,
      consumers,
      canonicalRoots: [...canonical].map((packageRoot) => relative(root, packageRoot)),
      virtualStoreInventory: [...new Set([...copies, ...reachableCopies])].sort().map((copy) => ({
        copy,
        reachable: reachableCopies.has(copy),
        status: reachableCopies.has(copy)
          ? 'reviewed-local-patch'
          : 'unused-cache-outside-locked-consumers',
      })),
    });
  }
  return modules;
}

export function assertStrictRuntime(result, text) {
  requireThat(
    goodResult(result, 0),
    'runtime regression failed, timed out, or left owned processes',
  );
  const numbers = {};
  for (const line of text.split(/\r?\n/)) {
    const match = /^# (tests|suites|pass|fail|cancelled|skipped|todo) (\d+)$/.exec(line);
    if (match) {
      requireThat(numbers[match[1]] === undefined, 'duplicate runtime summary');
      numbers[match[1]] = Number(match[2]);
    }
  }
  requireThat(
    /^TAP version 13\r?$/m.test(text) &&
      /^1\.\.14\r?$/m.test(text) &&
      numbers.tests === 14 &&
      numbers.pass === 14 &&
      ['suites', 'fail', 'cancelled', 'skipped', 'todo'].every((key) => numbers[key] === 0) &&
      !/^not ok\b/m.test(text) &&
      !/^(?:not )?ok \d+.*#\s*(?:SKIP|TODO)\b/im.test(text),
    'runtime report did not prove all fourteen first-attempt cases',
  );
  requireThat(
    (text.match(/^ok \d+ - /gm) ?? []).length === 14,
    'runtime case history is incomplete',
  );
  return numbers;
}

/** No CLI override for approval hashes, consumer roots, runtime tests or process cleanup. */
export async function verifyBuildAdvisoryMitigations({
  root,
  report,
  result,
  rawSha256,
  output,
  run = runValidationCommand,
  git = gitRead,
  env = process.env,
}) {
  const counts = report?.metadata?.vulnerabilities;
  const evidence = {
    schema: 1,
    checkedAt: new Date().toISOString(),
    effectiveStatus: 'blocked',
    rawStatus: 'vulnerable',
    rawVulnerabilities:
      object(counts) && Object.values(counts).every(Number.isSafeInteger)
        ? Object.values(counts).reduce((total, value) => total + value, 0)
        : null,
    rawHigh: Number.isSafeInteger(counts?.high) ? counts.high : null,
    localMitigations: 0,
    upstreamUnfixed: null,
    upstreamReview: UPSTREAM_REVIEW,
    rawReportSha256: rawSha256,
  };
  try {
    evidence.findings = matchReviewedFindings(report, result);
    evidence.upstreamUnfixed = true;
    requireThat(/^[a-f0-9]{64}$/.test(rawSha256), 'missing original raw report hash');
    for (const key of [
      'VARVE_BUILD_ADVISORY_FIXTURE_ROOT',
      'VARVE_BUILD_ADVISORY_REPO_ROOT',
      'NODE_OPTIONS',
      'NODE_PATH',
    ])
      requireThat(!env[key], 'module or fixture environment override is prohibited');
    const before = committedClosure(root, git);
    evidence.source = before;
    evidence.modules = inspectInstalledMitigations(root);
    const runtimeOutput = mkdtempSync(join(output, 'npm-mitigation-runtime-'));
    const stdoutPath = join(runtimeOutput, 'stdout.log');
    const stderrPath = join(runtimeOutput, 'stderr.log');
    const stdout = openSync(stdoutPath, 'wx', 0o600);
    const stderr = openSync(stderrPath, 'wx', 0o600);
    const argv = [process.execPath, '--test', '--test-reporter=tap', RUNTIME_OWNER];
    const childEnv = { ...env };
    for (const key of [
      'VARVE_BUILD_ADVISORY_FIXTURE_ROOT',
      'VARVE_BUILD_ADVISORY_REPO_ROOT',
      'NODE_OPTIONS',
      'NODE_PATH',
    ])
      delete childEnv[key];
    let runtime;
    try {
      runtime = await run(argv, {
        cwd: root,
        timeoutMs: 30000,
        env: childEnv,
        stdio: ['ignore', stdout, stderr],
      });
    } finally {
      closeSync(stdout);
      closeSync(stderr);
    }
    requireThat(
      statSync(stdoutPath).size <= 1024 * 1024 && statSync(stderrPath).size <= 1024 * 1024,
      'runtime diagnostics exceeded bound',
    );
    evidence.runtime = {
      argv: ['node', ...argv.slice(1)],
      result: runtime,
      output: relative(root, runtimeOutput),
      tests: assertStrictRuntime(runtime, readFileSync(stdoutPath, 'utf8')),
      stdoutSha256: sha256(readFileSync(stdoutPath)),
      stderrSha256: sha256(readFileSync(stderrPath)),
    };
    requireThat(
      JSON.stringify(before) === JSON.stringify(committedClosure(root, git)) &&
        JSON.stringify(evidence.modules) === JSON.stringify(inspectInstalledMitigations(root)),
      'mitigation inputs changed during runtime validation',
    );
    evidence.effectiveStatus = 'locally-mitigated';
    evidence.localMitigations = 2;
  } catch (error) {
    evidence.reason = error.message;
  }
  return evidence;
}
