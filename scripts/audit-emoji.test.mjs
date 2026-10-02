#!/usr/bin/env node
/** Root report output must not exempt authored source or nested reports. */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { copyFileSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import test from 'node:test';

function withAuditFixture(files, assertion) {
  const root = mkdtempSync(join(tmpdir(), 'varve emoji fixture ü '));
  try {
    const audit = join(root, 'scripts/audit-emoji.mjs');
    mkdirSync(dirname(audit), { recursive: true });
    copyFileSync(new URL('./audit-emoji.mjs', import.meta.url), audit);
    writeFileSync(join(root, '.gitignore'), '/reports/\n');
    for (const [path, contents] of Object.entries(files)) {
      const output = join(root, path);
      mkdirSync(dirname(output), { recursive: true });
      writeFileSync(output, contents);
    }
    const result = spawnSync(process.execPath, [audit], { cwd: root, encoding: 'utf8' });
    assert.ifError(result.error);
    assertion({ code: result.status, output: `${result.stdout}${result.stderr}` });
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

const generatedReport = {
  'reports/release-current-browser/controls-affected-html/index.html':
    '<script>const reportIcon = "\u{1f680}";</script>\n',
};

test('ignores third-party emoji in the generated root reports directory', () => {
  withAuditFixture(
    { ...generatedReport, 'packages/example/src/index.ts': 'export const label = "Varve";\n' },
    ({ code, output }) => {
      assert.equal(code, 0, output);
      assert.match(output, /clean \(scanned 1 files\)/);
    },
  );
});

test('still rejects pictographic emoji in authored source beside generated reports', () => {
  withAuditFixture(
    { ...generatedReport, 'apps/example/src/index.ts': 'export const label = "\u{1f680}";\n' },
    ({ code, output }) => {
      assert.equal(code, 1, output);
      assert.match(output, /EMOJI: apps\/example\/src\/index\.ts:1:/);
      assert.doesNotMatch(output, /EMOJI: reports\//);
    },
  );
});

test('still rejects emoji and text icons in nested authored reports directories', () => {
  withAuditFixture(
    {
      ...generatedReport,
      'packages/example/reports/index.ts': 'export const label = "\u{1f680}";\n',
      'packages/example/reports/Report.tsx': 'export const Report = () => <span>\u2192</span>;\n',
    },
    ({ code, output }) => {
      assert.equal(code, 1, output);
      assert.match(output, /EMOJI: packages\/example\/reports\/index\.ts:1:/);
      assert.match(output, /ICON: {2}packages\/example\/reports\/Report\.tsx:1:/);
      assert.doesNotMatch(output, /EMOJI: reports\//);
    },
  );
});

test('does not exempt other root directories merely prefixed with reports', () => {
  withAuditFixture(
    { ...generatedReport, 'reports-source/index.html': '<p>\u{1f680}</p>\n' },
    ({ code, output }) => {
      assert.equal(code, 1, output);
      assert.match(output, /EMOJI: reports-source\/index\.html:1:/);
      assert.doesNotMatch(output, /EMOJI: reports\//);
    },
  );
});
