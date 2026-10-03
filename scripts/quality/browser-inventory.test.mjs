import assert from 'node:assert/strict';
import { createHash } from 'node:crypto';
import {
  createBrowserInventory,
  discoverBrowserInventory,
  explainedRuntimeSkip,
  inventoryCommand,
  inventoryCoverageErrors,
  inventoryErrors,
} from './browser-inventory.mjs';

const source = {
  commitSha: 'a'.repeat(40),
  treeSha: 'b'.repeat(40),
  planHash: 'c'.repeat(64),
  policyHash: 'd'.repeat(64),
};
const cleanSource = () => ({ ...source, clean: true });
const argv = [
  'pnpm',
  'exec',
  'playwright',
  'test',
  '--project=chromium',
  '--shard=3/8',
  '--workers=1',
  '--retries=0',
  '--trace=retain-on-failure',
  '--max-failures=5',
];
const json = {
  config: { projects: [{ name: 'chromium' }], shard: null },
  errors: [],
  suites: [
    {
      title: 'selection.spec.ts',
      specs: [
        {
          file: 'canvas/selection.spec.ts',
          title: 'moves a group',
          tests: [{ projectName: 'chromium', expectedStatus: 'passed', annotations: [] }],
        },
        {
          file: 'canvas/selection.spec.ts',
          title: 'moves a selection',
          tests: [{ projectName: 'chromium', expectedStatus: 'passed', annotations: [] }],
        },
      ],
    },
  ],
};
const manifest = createBrowserInventory(json, { lane: 'e2e:all', argv, source });
assert.equal(manifest.caseCount, 2);
assert.ok(manifest.cases.every((entry) => entry.durationMs === null));
assert.deepEqual(inventoryErrors(manifest, source), []);
const demoCommand = [
  'pnpm',
  'exec',
  'playwright',
  'test',
  '--config',
  'playwright.demo-dist.config.mts',
];
const demoManifest = createBrowserInventory(json, {
  lane: 'e2e:demo-dist',
  argv: demoCommand,
  source,
});
assert.deepEqual(inventoryErrors(demoManifest, source), []);
for (const invalidCommand of [
  [...demoCommand, 'tests/e2e/browser/try-demo.spec.ts'],
  [...demoCommand.slice(0, 5), 'playwright.website.config.ts'],
  demoCommand.slice(0, 4),
])
  assert.throws(
    () => createBrowserInventory(json, { lane: 'e2e:demo-dist', argv: invalidCommand, source }),
    /canonical lane/,
    'built-demo inventory requires its complete dedicated configuration',
  );
const actual = manifest.cases.map((entry) => ({
  ...entry,
  status: 'expected',
  annotations: [],
  attempts: [{ status: 'passed', retry: 0 }],
}));
assert.deepEqual(inventoryCoverageErrors(manifest, actual), []);
assert.deepEqual(
  inventoryCoverageErrors(manifest, actual.slice(0, 1), { complete: false }),
  [],
  'one shard may execute a subset of the complete inventory',
);
for (const cases of [
  actual.slice(0, 1),
  [...actual, actual[0]],
  [...actual, { ...actual[0], caseId: '0'.repeat(64) }],
])
  assert.ok(
    inventoryCoverageErrors(manifest, cases).length,
    'missing, duplicate and unexpected execution cannot cover the inventory',
  );
assert.ok(inventoryCoverageErrors(null, actual).length);
assert.ok(inventoryErrors(null).length);
assert.ok(inventoryErrors({ ...manifest, cases: [null] }).length);
for (const key of Object.keys(source))
  assert.ok(
    inventoryErrors(manifest, { ...source, [key]: '0'.repeat(source[key].length) }).length,
    `bind ${key}`,
  );
assert.ok(inventoryErrors({ ...manifest, caseCount: 1 }).length);
assert.ok(
  inventoryCoverageErrors(
    manifest,
    actual.map((entry) => ({ ...entry, status: 'skipped' })),
  ).length,
  'an all-skipped suite is not green coverage',
);
assert.ok(
  inventoryCoverageErrors(manifest, [
    {
      ...actual[0],
      status: 'skipped',
      annotations: [{ type: 'skip', description: 'missing toolbar' }],
    },
    actual[1],
  ]).length,
  'missing product controls cannot become supported capability skips',
);
const gpu = { ...manifest.cases[0], file: 'webgpu/rect-buffer-reuse.spec.ts' };
assert.equal(
  explainedRuntimeSkip(gpu, {
    annotations: [
      { type: 'skip', description: 'No hardware WebGPU adapter is exposed by this browser' },
    ],
  }),
  true,
);
assert.equal(explainedRuntimeSkip(gpu, { annotations: [{ type: 'skip' }] }), false);
assert.equal(
  explainedRuntimeSkip(
    { ...gpu, file: 'canvas/selection.spec.ts' },
    { annotations: [{ type: 'skip', description: 'no WebGPU adapter' }] },
  ),
  false,
);
assert.equal(
  explainedRuntimeSkip(
    { ...gpu, expectedStatus: 'skipped', skipReasons: ['requires optional model pack'] },
    {},
  ),
  true,
);
assert.deepEqual(inventoryCommand(argv), [
  'pnpm',
  'exec',
  'playwright',
  'test',
  '--project=chromium',
  '--list',
  '--reporter=json',
]);
for (const option of [
  '--grep=smoke',
  '--last-failed',
  '--only-changed',
  '--test-list=short.txt',
  '--repeat-each=2',
])
  assert.throws(() => inventoryCommand([...argv, option]), /filtered or repeated/);
assert.throws(
  () =>
    createBrowserInventory(json, { lane: 'e2e:all', source, argv: [...argv, 'tests/e2e/canvas'] }),
  /canonical lane/,
);
assert.throws(
  () => createBrowserInventory({ ...json, errors: [{}] }, { lane: 'e2e:all', argv, source }),
  /runner errors/,
);
assert.throws(
  () => createBrowserInventory({ ...json, suites: [] }, { lane: 'e2e:all', argv, source }),
  /omitted a selected project/,
);
assert.throws(
  () =>
    createBrowserInventory(
      { ...json, config: { ...json.config, shard: { current: 1, total: 8 } } },
      { lane: 'e2e:all', argv, source },
    ),
  /unsharded/,
);
assert.throws(
  () =>
    createBrowserInventory(json, { lane: 'e2e:all', argv: [...argv, '--project=firefox'], source }),
  /omitted a selected project/,
);
let executed;
const discovered = discoverBrowserInventory({
  lane: 'e2e:all',
  argv,
  source,
  readSource: cleanSource,
  execute: (command, args, options) => {
    executed = { command, args, options };
    return { status: 0, stdout: JSON.stringify(json) };
  },
});
assert.equal(discovered.sha256, manifest.sha256);
assert.equal(executed.options.shell, false);
assert.ok(executed.options.timeout <= 120000);
assert.ok(!executed.args.some((arg) => arg.startsWith('--shard')));
for (const result of [
  { status: 0, stdout: '{secret' },
  { status: 0, signal: 'SIGTERM' },
  { status: 1 },
])
  assert.throws(() =>
    discoverBrowserInventory({
      lane: 'e2e:all',
      argv,
      source,
      execute: () => result,
      readSource: cleanSource,
    }),
  );
for (const invalid of [
  { ...source, clean: false },
  { ...source, clean: true, commitSha: 'e'.repeat(40) },
  { ...source, clean: true, treeSha: 'f'.repeat(40) },
]) {
  let calls = 0;
  assert.throws(
    () =>
      discoverBrowserInventory({
        lane: 'e2e:all',
        argv,
        source,
        execute: () => {
          calls++;
          return { status: 0, stdout: JSON.stringify(json) };
        },
        readSource: () => invalid,
      }),
    /unchanged clean source/,
  );
  assert.equal(calls, 0, 'dirty or different source must fail before discovery');
  let reads = 0;
  assert.throws(
    () =>
      discoverBrowserInventory({
        lane: 'e2e:all',
        argv,
        source,
        execute: () => ({ status: 0, stdout: JSON.stringify(json) }),
        readSource: () => (++reads === 1 ? cleanSource() : invalid),
      }),
    /unchanged clean source/,
    'source mutation during discovery invalidates evidence',
  );
}
const changed = { ...manifest, cases: [...manifest.cases, manifest.cases[0]], caseCount: 3 };
const { sha256: _ignored, ...body } = changed;
changed.sha256 = createHash('sha256').update(JSON.stringify(body)).digest('hex');
assert.ok(
  inventoryErrors(changed).includes('invalid or duplicate inventory case'),
  'a recomputed digest cannot hide duplicate IDs',
);
console.log('browser inventory coverage tests passed');
