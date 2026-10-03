import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  cpSync,
  mkdirSync,
  mkdtempSync,
  readFileSync,
  realpathSync,
  renameSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from 'node:fs';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import { dirname, join, posix, win32 } from 'node:path';
import { test } from 'node:test';
import { isDependencyVulnerability } from '../ci/failure-manifest.mjs';
import {
  assertStrictRuntime,
  inside,
  inspectInstalledMitigations,
  matchReviewedFindings,
  REVIEWED_MITIGATIONS,
  RUNTIME_OWNER,
  UPSTREAM_REVIEW,
  verifyBuildAdvisoryMitigations,
} from './verify-build-advisory-mitigations.mjs';

const yaml = createRequire(import.meta.url)('js-yaml');
const linkType = process.platform === 'win32' ? 'junction' : 'dir';
const sha = (value) => createHash('sha256').update(value).digest('hex');
const auditResult = { status: 1, signal: null, remaining: [], cleanupUnknown: false };
const cleanResult = { ...auditResult, status: 0 };
const tap = `TAP version 13\n${Array.from({ length: 14 }, (_, i) => `ok ${i + 1} - owning case ${i + 1}`).join('\n')}\n1..14\n# tests 14\n# suites 0\n# pass 14\n# fail 0\n# cancelled 0\n# skipped 0\n# todo 0\n`;
function rawReport() {
  return {
    advisories: Object.fromEntries(
      REVIEWED_MITIGATIONS.map((item) => [
        String(item.id),
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
    ),
    metadata: {
      vulnerabilities: { info: 0, low: 0, moderate: 0, high: 2, critical: 0 },
      dependencies: 312,
      optionalDependencies: 136,
      devDependencies: 0,
      totalDependencies: 448,
    },
  };
}
test('strict raw review accounts for all findings without changing the raw report', () => {
  const report = rawReport();
  const before = JSON.stringify(report);
  assert.equal(matchReviewedFindings(report, auditResult).length, 2);
  assert.equal(JSON.stringify(report), before);
});
for (const [name, mutate] of [
  [
    'third advisory',
    (r) => {
      r.advisories.extra = r.advisories[1240991];
    },
  ],
  [
    'unknown dependency path',
    (r) => {
      r.advisories[1240992].findings[0].paths[0] = 'apps__website>unknown>braces';
    },
  ],
  [
    'missing path',
    (r) => {
      r.advisories[1240991].findings[0].paths.pop();
    },
  ],
  [
    'duplicate path',
    (r) => {
      r.advisories[1240991].findings[0].paths[1] = r.advisories[1240991].findings[0].paths[0];
    },
  ],
  [
    'installed version',
    (r) => {
      r.advisories[1240991].findings[0].version = '4.1.0';
    },
  ],
  [
    'severity',
    (r) => {
      r.advisories[1240991].severity = 'critical';
    },
  ],
  [
    'count mismatch',
    (r) => {
      r.metadata.vulnerabilities.high = 1;
    },
  ],
  [
    'partial production graph',
    (r) => {
      r.metadata.totalDependencies = 999;
    },
  ],
  [
    'dev reclassification',
    (r) => {
      r.advisories[1240992].findings[0].dev = true;
    },
  ],
  [
    'unknown report shape',
    (r) => {
      r.ignored = [];
    },
  ],
])
  test(`raw review blocks ${name}`, () => {
    const r = rawReport();
    mutate(r);
    assert.throws(() => matchReviewedFindings(r, auditResult));
  });
for (const [name, result, text] of [
  ['failed case', { ...cleanResult, status: 1 }, tap],
  ['skipped case', cleanResult, tap.replace('# skipped 0', '# skipped 1')],
  ['todo case', cleanResult, tap.replace('# todo 0', '# todo 1')],
  ['case missing', cleanResult, tap.replace('ok 14 - owning case 14\n', '')],
  ['timeout', { ...cleanResult, status: 124 }, tap],
  ['signal', { ...cleanResult, signal: 'SIGTERM' }, tap],
  ['orphan', { ...cleanResult, remaining: [{ pid: 55 }] }, tap],
  ['unknown cleanup', { ...cleanResult, cleanupUnknown: true }, tap],
  ['contradictory zero exit', cleanResult, tap.replace('ok 7 - ', 'not ok 7 - ')],
  ['duplicate summary', cleanResult, `${tap}# pass 14\n`],
])
  test(`runtime evidence blocks ${name}`, () =>
    assert.throws(() => assertStrictRuntime(result, text)));
test('runtime evidence requires the complete fourteen-case history', () =>
  assert.equal(assertStrictRuntime(cleanResult, tap).pass, 14));

// The fixture is assembled from genuine reviewed patched sources, never marker strings.
function installedFixture() {
  const root = mkdtempSync(join(tmpdir(), 'varve-mitigation-owning-'));
  const put = (path, data) => {
    mkdirSync(dirname(join(root, path)), { recursive: true });
    writeFileSync(join(root, path), data);
  };
  put('package.json', '{}');
  put('apps/website/package.json', '{}');
  const workspace = { patchedDependencies: {} };
  const lock = { patchedDependencies: {}, snapshots: {} };
  for (const item of REVIEWED_MITIGATIONS) {
    const identity = `${item.package}@${item.version}`;
    const snapshot = `${identity}(patch_hash=${item.patchSha256})`;
    workspace.patchedDependencies[identity] = item.patch;
    lock.patchedDependencies[identity] = item.patchSha256;
    lock.snapshots[snapshot] = {};
    const packageRoot = join(
      root,
      `node_modules/.pnpm/${identity}_patch_hash=${item.patchSha256}/node_modules/${item.package}`,
    );
    mkdirSync(dirname(packageRoot), { recursive: true });
    const sourceOwner = createRequire(join(import.meta.dirname, '../../apps/website/package.json'));
    const sourceConsumer =
      item.package === 'http-cache-semantics'
        ? createRequire(realpathSync(sourceOwner.resolve('astro')))
        : createRequire(
            createRequire(realpathSync(sourceOwner.resolve('@astrojs/tailwind'))).resolve(
              'tailwindcss',
            ),
          );
    const sourceEntry =
      item.package === 'braces'
        ? createRequire(sourceConsumer.resolve('micromatch')).resolve(item.package)
        : sourceConsumer.resolve(item.package);
    const sourcePackage = dirname(realpathSync(sourceEntry));
    cpSync(sourcePackage, packageRoot, { recursive: true });
    put(item.patch, readFileSync(join(import.meta.dirname, '../..', item.patch)));
    if (item.package === 'braces') {
      const dependency = dirname(realpathSync(createRequire(sourceEntry).resolve('fill-range')));
      mkdirSync(join(root, 'node_modules'), { recursive: true });
      symlinkSync(dependency, join(root, 'node_modules/fill-range'), linkType);
    }
    mkdirSync(join(root, 'apps/website/node_modules'), { recursive: true });
    // npm owner chains are resolved through genuine Node package resolution.
    symlinkSync(packageRoot, join(root, 'apps/website/node_modules', item.package), linkType);
  }
  for (const owner of [
    'astro',
    '@astrojs/tailwind',
    'tailwindcss',
    'chokidar',
    'fast-glob',
    'micromatch',
  ]) {
    put(
      `apps/website/node_modules/${owner}/package.json`,
      JSON.stringify({ name: owner, main: 'index.js' }),
    );
    put(`apps/website/node_modules/${owner}/index.js`, 'module.exports = {};\n');
  }
  put('pnpm-workspace.yaml', yaml.dump(workspace));
  put('pnpm-lock.yaml', yaml.dump(lock));
  put(RUNTIME_OWNER, readFileSync(join(import.meta.dirname, '../..', RUNTIME_OWNER)));
  mkdirSync(join(root, 'reports'), { recursive: true });
  const committed = new Map(
    [
      'package.json',
      'apps/website/package.json',
      'pnpm-workspace.yaml',
      'pnpm-lock.yaml',
      RUNTIME_OWNER,
      ...REVIEWED_MITIGATIONS.map((i) => i.patch),
    ].map((file) => [file, readFileSync(join(root, file))]),
  );
  const git = (_root, args) =>
    args[0] === 'rev-parse' ? Buffer.from('1'.repeat(40)) : committed.get(args[1].slice(41));
  const run = async (_argv, options) => {
    writeFileSync(options.stdio[1], tap);
    return cleanResult;
  };
  return { root, workspace, lock, put, committed, git, run };
}
async function verifyFixture(f, options = {}) {
  return verifyBuildAdvisoryMitigations({
    root: f.root,
    output: join(f.root, 'reports'),
    report: rawReport(),
    result: auditResult,
    rawSha256: sha(JSON.stringify(rawReport())),
    git: f.git,
    run: f.run,
    env: {},
    ...options,
  });
}
test('actual installed source hashes and all five consumer paths produce distinct local evidence', async () => {
  const f = installedFixture();
  try {
    const r = await verifyFixture(f);
    assert.equal(r.effectiveStatus, 'locally-mitigated', r.reason);
    assert.equal(r.rawStatus, 'vulnerable');
    assert.equal(r.rawVulnerabilities, 2);
    assert.equal(r.localMitigations, 2);
    assert.equal(r.upstreamUnfixed, true);
    assert.deepEqual(
      r.modules.map((m) => m.consumers.length),
      [2, 3],
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
for (const [name, modify] of [
  ['patch bytes', (f) => f.put(REVIEWED_MITIGATIONS[0].patch, 'modified patch')],
  [
    'unpatched lock snapshot',
    (f) => {
      f.lock.snapshots['braces@3.0.3'] = {};
      f.put('pnpm-lock.yaml', yaml.dump(f.lock));
    },
  ],
  [
    'missing snapshot',
    (f) => {
      delete f.lock.snapshots[`braces@3.0.3(patch_hash=${REVIEWED_MITIGATIONS[1].patchSha256})`];
      f.put('pnpm-lock.yaml', yaml.dump(f.lock));
    },
  ],
  [
    'lock hash',
    (f) => {
      f.lock.patchedDependencies['braces@3.0.3'] = '0'.repeat(64);
      f.put('pnpm-lock.yaml', yaml.dump(f.lock));
    },
  ],
  [
    'unpatched dependent reference',
    (f) => {
      f.lock.snapshots.owner = { dependencies: { braces: '3.0.3' } };
      f.put('pnpm-lock.yaml', yaml.dump(f.lock));
    },
  ],
  [
    'workspace declaration',
    (f) => {
      delete f.workspace.patchedDependencies['braces@3.0.3'];
      f.put('pnpm-workspace.yaml', yaml.dump(f.workspace));
    },
  ],
  [
    'installed source',
    (f) =>
      f.put(
        `node_modules/.pnpm/braces@3.0.3_patch_hash=${REVIEWED_MITIGATIONS[1].patchSha256}/node_modules/braces/lib/parse.js`,
        'module.exports = () => null',
      ),
  ],
  [
    'unpatched reachable installed copy',
    (f) => {
      const cached = join(f.root, 'node_modules/.pnpm/braces@3.0.3/node_modules/braces');
      mkdirSync(cached, { recursive: true });
      writeFileSync(
        join(cached, 'package.json'),
        JSON.stringify({ name: 'braces', version: '3.0.3', main: 'index.js' }),
      );
      writeFileSync(join(cached, 'index.js'), 'module.exports = {};');
      rmSync(join(f.root, 'apps/website/node_modules/braces'));
      symlinkSync(cached, join(f.root, 'apps/website/node_modules/braces'), linkType);
    },
  ],
  ['missing module', (f) => rmSync(join(f.root, 'apps/website/node_modules/braces'))],
])
  test(`installation inspection blocks ${name}`, () => {
    const f = installedFixture();
    try {
      modify(f);
      assert.throws(() => inspectInstalledMitigations(f.root));
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
for (const name of [
  'VARVE_BUILD_ADVISORY_FIXTURE_ROOT',
  'VARVE_BUILD_ADVISORY_REPO_ROOT',
  'NODE_OPTIONS',
  'NODE_PATH',
])
  test(`effective gate blocks ${name} override`, async () => {
    const f = installedFixture();
    try {
      assert.equal(
        (await verifyFixture(f, { env: { [name]: '/unreviewed' } })).effectiveStatus,
        'blocked',
      );
    } finally {
      rmSync(f.root, { recursive: true, force: true });
    }
  });
test('effective gate blocks uncommitted owner and changes during runtime', async () => {
  const f = installedFixture();
  try {
    f.put(RUNTIME_OWNER, 'modified owner');
    assert.match((await verifyFixture(f)).reason, /uncommitted/);
    f.put(RUNTIME_OWNER, f.committed.get(RUNTIME_OWNER));
    const run = async (...args) => {
      const result = await f.run(...args);
      f.put('pnpm-lock.yaml', '# changed');
      return result;
    };
    assert.equal((await verifyFixture(f, { run })).effectiveStatus, 'blocked');
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('effective gate blocks actual runtime timeout instead of accepting prior green output', async () => {
  const f = installedFixture();
  try {
    assert.equal(
      (
        await verifyFixture(f, {
          run: async (...args) => {
            await f.run(...args);
            return { ...cleanResult, status: 124 };
          },
        })
      ).effectiveStatus,
      'blocked',
    );
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('unreachable old virtual-store cache is inventoried without weakening real consumer checks', () => {
  const f = installedFixture();
  try {
    mkdirSync(join(f.root, 'node_modules/.pnpm/braces@3.0.3'));
    const modules = inspectInstalledMitigations(f.root);
    assert.equal(
      modules[1].virtualStoreInventory.find((copy) => copy.copy === 'braces@3.0.3').reachable,
      false,
    );
    assert.equal(modules[1].consumers.length, 3);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('bounded real consumer runtime executes all fourteen approved assertions with no overrides', async () => {
  const f = installedFixture();
  try {
    const evidence = await verifyFixture(f, { run: undefined });
    assert.equal(evidence.effectiveStatus, 'locally-mitigated', evidence.reason);
    assert.equal(evidence.runtime.tests.tests, 14);
    assert.equal(evidence.runtime.result.status, 0);
    assert.deepEqual(evidence.runtime.result.remaining, []);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});

test('retained raw informational and effective mitigation lines cannot become a later CI vulnerability cause', () => {
  const raw = JSON.stringify({
    id: 'npm-production',
    status: 'vulnerable',
    vulnerabilities: 2,
    effectiveStatus: 'locally-mitigated',
  });
  assert.equal(isDependencyVulnerability(`Raw dependency advisory: ${raw}`), false);
  assert.equal(
    isDependencyVulnerability(
      'Dependency advisory effective: {"id":"npm-production","effectiveStatus":"locally-mitigated","rawStatus":"vulnerable","rawHigh":2}',
    ),
    false,
  );
  assert.equal(
    isDependencyVulnerability(
      `Dependency advisory: ${JSON.stringify({ id: 'npm-production', status: 'vulnerable', effectiveStatus: 'blocked' })}`,
    ),
    true,
  );
});

test('containment rejects Windows cross-drive absolute relative paths on every host', () => {
  assert.equal(win32.isAbsolute(win32.relative('C:\\varve', 'D:\\artifact')), true);
  assert.equal(inside('C:\\varve', 'D:\\artifact', win32), false);
  assert.equal(inside('C:\\varve', 'C:\\outside', win32), false);
  assert.equal(inside('C:\\varve', 'C:\\varve\\patches\\approved.patch', win32), true);
  assert.equal(inside('/repo', '/outside', posix), false);
  assert.equal(inside('/repo', '/repo/patches/approved.patch', posix), true);
});
test('upstream-unfixed evidence is bound to its review timestamp and primary URLs', () => {
  assert.equal(UPSTREAM_REVIEW.reviewedAt, '2026-10-03T01:51:34.559742Z');
  assert.equal(UPSTREAM_REVIEW.sources.length, 2);
  assert.equal(
    UPSTREAM_REVIEW.sources[0].advisory,
    'https://github.com/advisories/GHSA-ch52-4w7c-c8xp',
  );
  assert.equal(UPSTREAM_REVIEW.sources[1].registry, 'https://registry.npmjs.org/braces');
  assert.match(UPSTREAM_REVIEW.statement, /reviewed snapshot/);
});

function shortenStoreNames(f) {
  for (const item of REVIEWED_MITIGATIONS) {
    const original = join(
      f.root,
      `node_modules/.pnpm/${item.package}@${item.version}_patch_hash=${item.patchSha256}`,
    );
    const short = join(
      f.root,
      `node_modules/.pnpm/${item.package}@${item.version}_patch_h_0123456789abcdef0123456789abcdef`,
    );
    renameSync(original, short);
    const link = join(f.root, 'apps/website/node_modules', item.package);
    rmSync(link);
    symlinkSync(join(short, 'node_modules', item.package), link, linkType);
  }
}
test('shortened pnpm Windows store names retain lock, source and all-consumer verification', async () => {
  const f = installedFixture();
  try {
    shortenStoreNames(f);
    const evidence = await verifyFixture(f, { run: undefined });
    assert.equal(evidence.effectiveStatus, 'locally-mitigated', evidence.reason);
    assert.equal(evidence.runtime.tests.pass, 14);
    assert.equal(evidence.modules[1].consumers.length, 3);
    assert.match(evidence.modules[1].canonicalRoots[0], /patch_h_0123/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('shortened store names cannot conceal a tampered source', () => {
  const f = installedFixture();
  try {
    shortenStoreNames(f);
    const source = join(
      f.root,
      'node_modules/.pnpm/braces@3.0.3_patch_h_0123456789abcdef0123456789abcdef/node_modules/braces/lib/parse.js',
    );
    writeFileSync(source, 'unreviewed');
    assert.throws(() => inspectInstalledMitigations(f.root), /source hash mismatch/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('matching approved source outside the canonical store is blocked', () => {
  const f = installedFixture();
  try {
    const item = REVIEWED_MITIGATIONS[1];
    const existing = join(
      f.root,
      `node_modules/.pnpm/braces@3.0.3_patch_hash=${item.patchSha256}/node_modules/braces`,
    );
    const moved = join(f.root, 'outside-store/braces');
    mkdirSync(dirname(moved), { recursive: true });
    cpSync(existing, moved, { recursive: true });
    rmSync(join(f.root, 'apps/website/node_modules/braces'));
    symlinkSync(moved, join(f.root, 'apps/website/node_modules/braces'), linkType);
    assert.throws(() => inspectInstalledMitigations(f.root), /outside the canonical pnpm store/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
test('a matching source symlink escaping its package is blocked', () => {
  const f = installedFixture();
  try {
    const item = REVIEWED_MITIGATIONS[1];
    const source = join(
      f.root,
      `node_modules/.pnpm/braces@3.0.3_patch_hash=${item.patchSha256}/node_modules/braces/lib/parse.js`,
    );
    const external = join(f.root, 'outside-parse.js');
    writeFileSync(external, readFileSync(source));
    rmSync(source);
    // Windows file symlinks require privilege; a directory junction provides the same escape.
    const lib = dirname(source);
    rmSync(lib, { recursive: true, force: true });
    const externalLib = join(f.root, 'outside-lib');
    mkdirSync(externalLib);
    writeFileSync(join(externalLib, 'parse.js'), readFileSync(external));
    symlinkSync(externalLib, lib, linkType);
    assert.throws(() => inspectInstalledMitigations(f.root), /escaped its canonical package/);
  } finally {
    rmSync(f.root, { recursive: true, force: true });
  }
});
