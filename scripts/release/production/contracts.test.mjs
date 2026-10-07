/** Cheap adapter regressions; no installed application or GUI qualification. */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { load } from 'js-yaml';

const names = [
  'dialog-forwarding',
  'webdriver-dom',
  'native-quit',
  'native-export-controls',
  'native-pdf',
  'retained-document',
  'macos-ax-controls',
  'published-upgrade',
  'workflow',
  'session-options',
];
const workflow = readFileSync(
  process.env.VARVE_NATIVE_WORKFLOW_FIXTURE || '.github/workflows/release.yml',
  'utf8',
);
// The common local guard and the three owning hosted steps must stay aligned.
const jobs = load(workflow).jobs;
for (const id of ['native-contracts', 'package-smoke', 'platform-smoke']) {
  const steps = jobs[id]?.steps.filter(
    (step) => step.name === 'Native qualification adapter contracts',
  );
  assert.equal(steps?.length, 1, `${id}: one owning native contract step`);
  const actual = [
    ...steps[0].run.matchAll(
      /node release-qualification-tooling\/scripts\/release\/production\/([\w-]+)\.test\.mjs/g,
    ),
  ].map((match) => match[1]);
  const required = id === 'package-smoke' ? [...names, 'appimage-extraction'] : names;
  assert.deepEqual(actual, required, `${id}: local and hosted native adapter coverage must match`);
}
// Reject loss or duplication of a hosted regression before any adapter runs.
const directory = mkdtempSync(join(tmpdir(), 'varve-native-contract-coverage-'));
try {
  const command =
    '          node release-qualification-tooling/scripts/release/production/session-options.test.mjs\n';
  for (const replacement of ['', command + command]) {
    const fixture = join(directory, 'release.yml');
    writeFileSync(fixture, workflow.replace(command, replacement));
    assert.throws(
      () =>
        execFileSync(process.execPath, [fileURLToPath(import.meta.url)], {
          env: { ...process.env, VARVE_NATIVE_WORKFLOW_FIXTURE: fixture },
          stdio: 'pipe',
        }),
      /local and hosted native adapter coverage must match/,
    );
  }
} finally {
  rmSync(directory, { recursive: true, force: true });
}

if (process.platform === 'linux') names.push('appimage-extraction');
for (const name of names) {
  execFileSync(process.execPath, [fileURLToPath(new URL(`./${name}.test.mjs`, import.meta.url))], {
    stdio: 'inherit',
  });
}
console.log(
  `${names.length} native adapter contracts passed; installed qualification remains separate.`,
);
