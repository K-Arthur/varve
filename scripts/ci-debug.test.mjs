#!/usr/bin/env node
/**
 * Unit tests for the failure extraction logic in ci-debug.mjs.
 *
 * Run: node scripts/ci-debug.test.mjs
 */
import assert from 'node:assert';
import {
  buildDebugFailureManifest,
  classifyJobFailure,
  classifyRunFailures,
  extractFailures,
  formatReport,
  githubFetch,
  hasFailedStep,
  hasFailureSourceForJob,
  isFailureLine,
  isStuckQueued,
  localReproductionCommand,
  normalizeLogLine,
  normalizeLogSource,
  rankLine,
  redactSensitive,
} from './ci-debug.mjs';

function assertTrue(condition, message) {
  if (!condition) {
    throw new Error(message);
  }
}

// Positive matches
assertTrue(isFailureLine('Error: something broke'), 'should detect plain Error');
assertTrue(isFailureLine('  ERROR: missing file'), 'should detect uppercase ERROR');
assertTrue(
  isFailureLine('cargo test failed with exit code 101'),
  'should detect failed with exit code',
);
assertTrue(isFailureLine('thread panicked at src/main.rs:10'), 'should detect panic');
assertTrue(isFailureLine('Caused by: network timeout'), 'should detect Caused by');
assertTrue(
  isFailureLine('::error::Compilation failed'),
  'should detect GitHub Actions error annotation',
);
assertTrue(
  isFailureLine('##[error]Unable to resolve action `actions/checkout@abc`'),
  'should detect legacy ##[error] annotation',
);
assertTrue(
  isFailureLine('Unable to resolve action `actions/checkout@xxx`, unable to find version `xxx`'),
  'should detect unresolvable action refs',
);
assertTrue(isFailureLine('npm ERR! code ENOENT'), 'should detect npm error');
assertTrue(isFailureLine('pnpm ERR_123 some error'), 'should detect pnpm error');
assertTrue(
  isFailureLine('AssertionError: expected true to be false'),
  'should detect AssertionError',
);
assertTrue(isFailureLine('test failed: foo'), 'should detect test failed');
assertTrue(
  isFailureLine('Traceback (most recent call last):'),
  'should detect Python traceback failures',
);
assertTrue(isFailureLine('fatal error: vector.hpp not found'), 'should detect C/C++ fatal errors');
assertTrue(
  isFailureLine('ninja: build stopped: subcommand failed'),
  'should detect Ninja build failures',
);

// Negative matches
assertTrue(!isFailureLine('  + exit 0'), 'should ignore exit 0');
assertTrue(!isFailureLine('git status clean'), 'should ignore clean status');
assertTrue(!isFailureLine(''), 'should ignore empty line');
assertTrue(!isFailureLine('Everything is fine'), 'should ignore plain text');
assertTrue(
  !isFailureLine('  printf \'::error::install-action: %s\\n\' "$*"'),
  'should ignore action source that prints an error annotation',
);

// Ranking is an ordering invariant, independent of array indexes.
assertTrue(
  rankLine('error: foo') < rankLine('panicked at foo'),
  'error should rank higher than panic',
);

// extractFailures with context
const log = [
  'normal line',
  'another normal line',
  'Error: expected value, got null',
  'at some_function (file.ts:42)',
  'final line',
].join('\n');

const hits = extractFailures(log, 1);
assert.strictEqual(hits.length, 1, 'should find one failure');
assert.strictEqual(hits[0].line, 3, 'failure line should be 3');
assertTrue(
  hits[0].snippet.includes('another normal line'),
  'context should include preceding line',
);
assertTrue(
  hits[0].snippet.includes('Error: expected value'),
  'snippet should include failing line',
);
assertTrue(hits[0].snippet.includes('at some_function'), 'context should include following line');

const actionSourceLog = [
  '  printf \'::error::install-action: %s\\n\' "$*"',
  '::error::File content differs from formatting output',
].join('\n');
const actionSourceHits = extractFailures(actionSourceLog, 0);
assert.strictEqual(actionSourceHits.length, 1, 'action source must not create a false failure hit');
assert.strictEqual(
  actionSourceHits[0].text,
  '::error::File content differs from formatting output',
  'the extracted hit should point to the actual annotated failure',
);

// GitHub prefixes run-archive job filenames with a numeric index. The report
// must recognise that indexed filename as the same job before adding a false
// "no log text" fallback entry.
assert.strictEqual(
  normalizeLogSource('0_Build (windows-latest).txt'),
  normalizeLogSource('Build (windows-latest)'),
  'indexed archive filename normalises to the job name',
);
assertTrue(
  hasFailureSourceForJob(
    { '0_Build (windows-latest)': [{ line: 42, rank: 1, text: 'Error: boom', snippet: '' }] },
    'Build (windows-latest)',
  ),
  'indexed archive failure source matches job metadata',
);
assertTrue(
  !hasFailureSourceForJob({ '0_Rust (ubuntu-latest)': [] }, 'Build (windows-latest)'),
  'different job names do not match',
);

// Job classification: billing-blocked jobs never start and have zero steps.
const billingAnnotations = [
  {
    annotation_level: 'failure',
    message:
      'The job was not started because recent account payments have failed or your spending limit needs to be increased. Please check the Billing & plans section in your settings',
  },
];
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, billingAnnotations),
  'billing-block',
  'zero-step failed job with billing annotation is a billing block',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, []),
  'never-started',
  'zero-step failed job without annotation is never-started',
);
assertTrue(
  hasFailedStep({
    conclusion: null,
    status: 'in_progress',
    steps: [{ name: 'JS tests', conclusion: 'failure' }],
  }),
  'failed step is visible before GitHub finalizes the job conclusion',
);
assert.strictEqual(
  classifyJobFailure(
    {
      conclusion: null,
      status: 'in_progress',
      steps: [{ name: 'JS tests', conclusion: 'failure' }],
    },
    [],
  ),
  'real-failure',
  'inline diagnostics classify a failed step in an in-progress job',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: 'failure', steps: [{ name: 'cargo clippy', conclusion: 'failure' }] },
    billingAnnotations,
  ),
  'real-failure',
  'failed job with steps is a real failure even with billing annotations',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'success', steps: [] }, []),
  null,
  'successful jobs are not classified',
);
assert.strictEqual(
  classifyJobFailure({ conclusion: 'skipped', steps: [] }, []),
  null,
  'skipped jobs are not classified',
);

const inlineReport = formatReport(
  'K-Arthur/varve',
  { id: 123, name: 'CI', conclusion: null },
  [
    {
      id: 99,
      name: 'JS (pnpm)',
      status: 'in_progress',
      conclusion: null,
      steps: [{ number: 4, name: 'test', conclusion: 'failure' }],
    },
  ],
  {},
);
assertTrue(
  inlineReport.includes('**JS (pnpm)** (in_progress)'),
  'inline report includes the current job using its status when conclusion is pending',
);
assertTrue(
  !inlineReport.includes('No failed jobs detected in run metadata'),
  'inline report must not claim there are no failed jobs when a step already failed',
);

// Runner-unavailable: GitHub never assigned a hosted runner.
const runnerUnavailableAnnotations = [
  {
    annotation_level: 'failure',
    message: 'The job was not acquired by Runner of type hosted even after multiple attempts',
  },
];
assert.strictEqual(
  classifyJobFailure({ conclusion: 'failure', steps: [] }, runnerUnavailableAnnotations),
  'runner-unavailable',
  'zero-step failed job with "not acquired" annotation is runner-unavailable',
);

// Stuck-queued: job accepted but never scheduled past the threshold.
const NOW = Date.parse('2026-08-06T19:00:00Z');
assert.strictEqual(
  classifyJobFailure(
    { conclusion: null, status: 'queued', started_at: '2026-08-06T18:00:00Z', steps: [] },
    [],
    NOW,
  ),
  'stuck-queued',
  'queued > 30 min is stuck-queued',
);
assert.strictEqual(
  classifyJobFailure(
    { conclusion: null, status: 'queued', started_at: '2026-08-06T18:59:00Z', steps: [] },
    [],
    NOW,
  ),
  null,
  'queued < 30 min is not yet stuck',
);
assertTrue(
  isStuckQueued({ status: 'queued', started_at: '2026-08-06T18:00:00Z' }, NOW),
  'isStuckQueued true for old queued run',
);
assertTrue(
  isStuckQueued({ status: 'queued', run_started_at: '2026-08-06T18:00:00Z' }, NOW),
  'isStuckQueued accepts GitHub workflow run timestamps',
);

// classifyRunFailures: probe-mode aggregation.
const probeJobs = [
  { id: 1, name: 'Rust (ubuntu-latest)', conclusion: 'failure', steps: [{ name: 'cargo test' }] },
  {
    id: 2,
    name: 'Build WASM engine',
    conclusion: 'failure',
    steps: [],
  },
  { id: 3, name: 'E2E', status: 'queued', started_at: '2026-08-06T18:00:00Z', steps: [] },
];
const probeAnnotations = new Map([
  [2, runnerUnavailableAnnotations],
  [3, []],
]);
const probed = classifyRunFailures(probeJobs, probeAnnotations);
assert.deepStrictEqual(probed.real, ['Rust (ubuntu-latest)'], 'probe surfaces real failure names');
assert.strictEqual(probed.infra.length, 2, 'probe counts infra blocks');
assertTrue(
  probed.infra.some((b) => b.kind === 'runner-unavailable'),
  'probe attributes runner-unavailable',
);
assertTrue(
  probed.infra.some((b) => b.kind === 'stuck-queued'),
  'probe attributes stuck-queued',
);

const infraOnly = classifyRunFailures(
  [
    {
      id: 4,
      name: 'Manifest verification',
      conclusion: 'failure',
      steps: [],
    },
  ],
  new Map([[4, runnerUnavailableAnnotations]]),
);
assert.deepStrictEqual(infraOnly.real, [], 'infra-only run has no real failures');
assert.strictEqual(infraOnly.infra.length, 1, 'infra-only run keeps the block');

// Redaction canaries: credential-shaped strings in failing logs must never
// reach the report. Values are runtime-constructed so no live-format token
// is committed to source.
const canaryPat = `ghp_${'A'.repeat(36)}`;
const canaryEnv = `APPLE_API_KEY_P8_BASE64=${'B'.repeat(48)}`;
assert.ok(
  !redactSensitive(canaryPat).includes('A'.repeat(36)),
  'GitHub PAT payload must be redacted',
);
assert.ok(
  !redactSensitive(canaryEnv).includes('B'.repeat(48)),
  'signing env values must be redacted',
);
const redactedHits = extractFailures(
  `Error: build failed
secret=${canaryPat}
`,
  1,
);
assert.ok(
  !redactedHits[0].text.includes('A'.repeat(36)),
  'hit text must not contain the canary token payload',
);
assert.ok(
  !redactedHits[0].snippet.includes('A'.repeat(36)),
  'hit snippet must not contain the canary token payload',
);

// Excerpts from sanitized release job logs 110845742234 (macOS) and
// 110845742476 (Windows), release run 37007931934. Terminal colour is added
// at runtime to cover the raw runner form as well as the sanitized archive.
const color = String.fromCharCode(27);
const nativeLog = [
  '2026-10-02T13:02:10.0000000Z   Downloaded wait-timeout v0.2.1',
  '2026-10-02T13:02:11.0000000Z   Compiling wait-timeout v0.2.1',
  '2026-10-02T13:02:12.0000000Z # Run failing gate locally',
  '2026-10-02T13:02:13.0000000Z   echo "error: a shell source template"',
  `2026-10-02T13:03:04.6062960Z ${color}[31merror[E0277]: the trait bound \`u64: std::convert::From<usize>\` is not satisfied${color}[0m`,
  '2026-10-02T13:03:04.6064000Z     --> src/generative_resources.rs:128:30',
  '2026-10-02T13:03:04.6065000Z 128 | let page_size = unsafe { u64::from(libc::vm_page_size) };',
  '2026-10-02T13:03:04.7197740Z error[E0308]: mismatched types',
  '2026-10-02T13:03:04.7200000Z     --> src/lib.rs:470:5',
  '2026-10-02T13:03:05.0000000Z error: could not compile `varve-desktop` (lib) due to 2 previous errors',
  '2026-10-02T13:03:06.0000000Z ##[error]Process completed with exit code 1.',
  '2026-10-02T13:03:07.0000000Z - line 601: `2026-10-02T13:02:10.0000000Z Downloaded wait-timeout v0.2.1`',
].join('\n');
const nativeHits = extractFailures(nativeLog, 2);
assert.deepStrictEqual(
  nativeHits.slice(0, 2).map((hit) => hit.text.match(/^error\[(E\d+)\]/)?.[1]),
  ['E0277', 'E0308'],
);
assert.strictEqual(nativeHits[0].line, 5, 'normalization preserves original archive line numbers');
assert.ok(nativeHits[0].snippet.includes('--> src/generative_resources.rs:128:30'));
assert.ok(!nativeHits.some((hit) => /wait-timeout|shell source|Run failing gate/.test(hit.text)));
assert.ok(
  !nativeHits[0].snippet.includes(color),
  'terminal control bytes are stripped from evidence',
);
assert.strictEqual(
  normalizeLogLine('Build\tCompile\t2026-10-02T13:08:04.9728589Z error[E0308]: mismatched types'),
  'error[E0308]: mismatched types',
);
assert.ok(
  isFailureLine('Download timed out after 30 seconds'),
  'actual network timeouts remain failures',
);
assert.ok(
  isFailureLine('TimeoutError: page.goto timed out'),
  'real browser timeouts remain failures',
);
assert.ok(!isFailureLine('  Checking wait-timeout v0.2.1'));
assert.ok(
  rankLine('error[E0308]: mismatched types') < rankLine('error: could not compile `varve-desktop`'),
);
const windowsHits = extractFailures(
  [
    '2026-10-02T13:08:04.9728589Z error[E0308]: mismatched types',
    '2026-10-02T13:08:04.9734491Z     --> C:\\Users\\runneradmin\\.cargo\\registry\\src\\wgpu-hal-30.0.1\\src\\dx12\\suballocation.rs:83:71',
    '2026-10-02T13:08:04.9926780Z error[E0277]: the trait bound `&ID3D12Heap: Param<ID3D12Heap, InterfaceType>` is not satisfied',
  ].join('\n'),
);
assert.ok(windowsHits[0].text.startsWith('error[E0308]'));
assert.ok(windowsHits[1].text.startsWith('error[E0277]'));

const nativeJob = {
  id: 110845742234,
  name: 'Native desktop E2E (macos)',
  status: 'completed',
  conclusion: 'failure',
  steps: [{ number: 8, name: 'Build desktop', conclusion: 'failure' }],
};
const nativeRun = {
  id: 37007931934,
  head_sha: 'a'.repeat(40),
  name: 'Release',
  status: 'completed',
  conclusion: 'failure',
};
const indexedSources = { '0_Native desktop E2E (macos)': nativeHits };
const nativeManifest = buildDebugFailureManifest({
  run: nativeRun,
  jobs: [nativeJob],
  failuresBySource: indexedSources,
  artifacts: ['build-110845742234-logs'],
});
const nativeFailure = nativeManifest.failures[0];
assert.ok(
  nativeFailure.firstUsefulError.startsWith('error[E0277]'),
  'manifest retains indexed archive compiler cause',
);
assert.deepStrictEqual(
  nativeFailure.logSources,
  ['0_Native desktop E2E (macos)'],
  'manifest retains source provenance',
);
assert.strictEqual(nativeFailure.category, 'product-or-test-regression');
assert.strictEqual(
  nativeFailure.retryWithoutCode,
  false,
  'compiler error never recommends a download retry',
);
assert.deepStrictEqual(nativeFailure.artifacts, ['build-110845742234-logs']);
assert.strictEqual(
  nativeFailure.localReproductionCommand,
  'cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml',
);
const nativeReport = formatReport('K-Arthur/varve', nativeRun, [nativeJob], indexedSources);
assert.ok(nativeReport.includes('cargo check --manifest-path apps/desktop/src-tauri/Cargo.toml'));
assert.ok(nativeReport.includes('same OS/toolchain'));
assert.ok(nativeReport.includes('pnpm verify:plan'));
assert.ok(nativeReport.includes('VARVE_FULL_GATE_REASON'));
assert.ok(!nativeReport.includes('just gate'));
assert.ok(!nativeReport.includes('act-run js'));
const windowsClippy = extractFailures(
  [
    '2026-10-02T13:00:00Z error: these patterns are unneeded as the `..` pattern can match those elements',
    '2026-10-02T13:00:00Z --> crates\\varve-print\\src\\lib.rs:1688:25',
    '2026-10-02T13:00:00Z |',
    '2026-10-02T13:00:00Z = note: `-D clippy::unneeded-struct-pattern` implied by `-D warnings`',
  ].join('\n'),
);
assert.strictEqual(
  localReproductionCommand({ name: 'Rust (windows-latest)' }, windowsClippy),
  'cargo clippy -p varve-print --all-targets -- -D warnings',
  'Windows paths and Clippy diagnostics retain the precise owning lane',
);
const exactCommand = localReproductionCommand(
  { name: 'E2E' },
  [],
  ['tests/e2e/canvas/selection.spec.ts:42'],
);
assert.ok(exactCommand.includes('pnpm typecheck:e2e\nnode scripts/quality/heavy-lease.mjs'));
assert.ok(exactCommand.includes('--workers=1'));
assert.ok(exactCommand.includes('--update-snapshots=none'));
assert.ok(!exactCommand.includes('e2e:all'));
assert.strictEqual(
  localReproductionCommand({ name: 'JS' }, [], ['bad$(danger).spec.ts']),
  'pnpm verify:affected',
  'untrusted path text cannot become shell code',
);

const urlCanary = `credential-${'Q'.repeat(28)}`;
const signedUrl = `https://downloads.example.com/package.zip?X-Amz-Signature=${urlCanary}&X-Amz-Credential=other`;
const queryUrl = `https://downloads.example.com/model.bin?token=${urlCanary}`;
const urlHits = extractFailures(`Error: download failed ${signedUrl}\n${queryUrl}`, 1);
const urlManifest = buildDebugFailureManifest({
  run: nativeRun,
  jobs: [nativeJob],
  failuresBySource: { [nativeJob.name]: urlHits },
});
for (const evidence of [
  JSON.stringify(urlHits),
  JSON.stringify(urlManifest),
  formatReport('K-Arthur/varve', nativeRun, [nativeJob], { [nativeJob.name]: urlHits }),
]) {
  assert.ok(
    !evidence.includes(urlCanary),
    'signed download URL credentials are redacted in every output',
  );
  assert.ok(
    evidence.includes('https://downloads.example.com/'),
    'redaction preserves useful origin/path',
  );
}
assert.strictEqual(
  redactSensitive('https://docs.example.com/help?lang=en'),
  'https://docs.example.com/help?lang=en',
);
const originalFetch = globalThis.fetch;
try {
  let requests = 0;
  globalThis.fetch = async () => {
    requests += 1;
    return requests === 1
      ? { status: 302, headers: new Headers({ location: signedUrl }) }
      : { ok: false, status: 403, statusText: 'Forbidden' };
  };
  await assert.rejects(githubFetch('/repos/owner/repo/actions/jobs/1/logs', 'unused'), (error) => {
    assert.ok(
      error.message.includes(
        'Download from https://downloads.example.com/package.zip?<redacted> failed',
      ),
    );
    assert.ok(
      !error.message.includes(urlCanary),
      'download errors are sanitized before console diagnostics',
    );
    return true;
  });
} finally {
  globalThis.fetch = originalFetch;
}
assert.strictEqual(
  extractFailures(
    'Error: expected true\n at tests/first.spec.ts:4\nError: expected true\n at tests/second.spec.ts:8',
  ).length,
  2,
  'distinct test failures must not be collapsed by shared error text',
);
const queueReport = formatReport(
  'K-Arthur/varve',
  { id: 5, status: 'in_progress' },
  [
    {
      name: 'Rust (Linux)',
      status: 'in_progress',
      conclusion: null,
      steps: [{ name: 'Compile', status: 'in_progress' }],
    },
  ],
  {},
  [{ jobName: 'Windows build', kind: 'stuck-queued' }],
);
assert.ok(queueReport.includes('cause unconfirmed'));
assert.ok(queueReport.includes('Currently in progress: Rust (Linux)'));
assert.ok(queueReport.includes('workflow concurrency'));
assert.ok(
  !queueReport.includes('gh run rerun'),
  'live queue report never recommends rerunning active work',
);
assert.ok(!queueReport.includes('--rerun-stuck --yes'));
const completedInfra = formatReport(
  'K-Arthur/varve',
  { id: 5, status: 'completed', conclusion: 'failure' },
  [],
  {},
  [{ jobName: 'Rust', kind: 'runner-unavailable' }],
);
assert.ok(
  completedInfra.includes('gh run rerun 5 --failed'),
  'completed confirmed infra can be retried after repair',
);

console.log('ci-debug extraction tests passed.');
