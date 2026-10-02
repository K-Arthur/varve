#!/usr/bin/env node
/**
 * Tests for the public-contact audit.
 *
 * A leak guard that cannot fail is worse than no guard: it produces a green
 * check that means nothing. These tests plant each violation class in a real
 * file inside the repository, run the audit as a subprocess, and assert it
 * exits non-zero and names the offending file — then always clean up.
 *
 * Run: `node scripts/audit-contacts.test.mjs` (part of `pnpm test:ci:tools`).
 */
import assert from 'node:assert/strict';
import { execFileSync } from 'node:child_process';
import { mkdirSync, rmSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';

const ROOT = resolve(new URL('../', import.meta.url).pathname);
const AUDIT = join(ROOT, 'scripts/audit-contacts.mjs');

/**
 * The audit scans `git ls-files`, so a fixture must be tracked to be seen.
 * Files are added to the index only (never committed) and removed after.
 */
function withTrackedFixture(relPath, contents, assertion) {
  const abs = join(ROOT, relPath);
  mkdirSync(dirname(abs), { recursive: true });
  writeFileSync(abs, contents, 'utf8');
  try {
    execFileSync('git', ['add', '--intent-to-add', '--', relPath], { cwd: ROOT });
    assertion();
  } finally {
    try {
      execFileSync('git', ['rm', '--cached', '--force', '--quiet', '--', relPath], {
        cwd: ROOT,
      });
    } catch {
      /* never staged */
    }
    rmSync(abs, { force: true });
  }
}

function runAudit() {
  try {
    const stdout = execFileSync('node', [AUDIT], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
    });
    return { code: 0, output: stdout };
  } catch (error) {
    return {
      code: error.status ?? 1,
      output: `${error.stdout ?? ''}${error.stderr ?? ''}`,
    };
  }
}

let failures = 0;
function test(name, fn) {
  try {
    fn();
    console.log(`  ok  ${name}`);
  } catch (error) {
    failures += 1;
    console.error(`  FAIL ${name}\n       ${error.message}`);
  }
}

console.log('audit-contacts.test.mjs');

test('passes on the repository as it stands', () => {
  const { code, output } = runAudit();
  assert.equal(code, 0, `expected clean, got:\n${output}`);
  assert.match(output, /audit:contacts — clean/);
});

test('fails on a consumer mailbox in an application surface', () => {
  withTrackedFixture(
    'packages/shared/src/__contact_fixture__.ts',
    'export const OOPS = "varve.maintainer@gmail.com";\n',
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1, 'a gmail address must fail the audit');
      assert.match(output, /MAILBOX/);
      assert.match(output, /__contact_fixture__\.ts/);
    },
  );
});

test('fails on a consumer mailbox even inside a historical doc', () => {
  // The NAMING exemption must not become a privacy loophole.
  withTrackedFixture(
    'docs/plans/__contact_fixture__.md',
    'Alias mail lands in someones.inbox@outlook.com today.\n',
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1, 'historical docs are exempt from NAMING, not MAILBOX');
      assert.match(output, /MAILBOX/);
    },
  );
});

test('fails on a retired-brand address in an active surface', () => {
  withTrackedFixture(
    'apps/website/src/__contact_fixture__.astro',
    '<a href="mailto:support@strata.design">mail</a>\n',
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1, 'an @strata.* address must fail outside historical docs');
      assert.match(output, /NAMING/);
    },
  );
});

test('allows a retired-brand git identity in a historical record', () => {
  withTrackedFixture(
    'docs/audits/__contact_fixture__.md',
    'Early commits were authored as `Strata Founder <founder@strata.local>`.\n',
    () => {
      const { code } = runAudit();
      assert.equal(code, 0, 'historical provenance records must stay accurate');
    },
  );
});

test('fails on a misspelled Varve domain that would bounce', () => {
  withTrackedFixture(
    'apps/website/src/__contact_fixture__.astro',
    '<a href="mailto:support@varve.design">mail</a>\n',
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1, 'only varve.studio receives Varve mail');
      assert.match(output, /DOMAIN/);
    },
  );
});

test('accepts the canonical addresses', () => {
  withTrackedFixture(
    'apps/website/src/__contact_fixture__.astro',
    [
      'hello@varve.studio support@varve.studio feedback@varve.studio',
      'security@varve.studio privacy@varve.studio press@varve.studio',
      'partnerships@varve.studio',
      '',
    ].join('\n'),
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 0, `canonical addresses must pass, got:\n${output}`);
    },
  );
});

test('fails when a file documents a concrete forwarding destination', () => {
  withTrackedFixture(
    'docs/development/__contact_fixture__.md',
    'All aliases forward to operator.mailbox@fastmail.com for now.\n',
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1, 'routing destinations must stay out of the repo');
      // MAILBOX or ROUTING may match first; both are correct refusals.
      assert.match(output, /ROUTING|MAILBOX/);
    },
  );
});

const UPSTREAM_NOTICE =
  '// Copyright © 2022-2026 Tobias J. Prisching <tobias.prisching@icloud.com> and CONTRIBUTORS\n';

test('preserves the reviewed upstream source copyright attribution', () => {
  withTrackedFixture('vendor/little_exif/src/__contact_fixture__.rs', UPSTREAM_NOTICE, () => {
    const { code, output } = runAudit();
    assert.equal(code, 0, `upstream attribution must remain intact, got:\n${output}`);
  });
});

test('still rejects a Varve contact added below an upstream copyright notice', () => {
  withTrackedFixture(
    'vendor/little_exif/src/__contact_fixture__.rs',
    `${UPSTREAM_NOTICE}// Varve support: varve.support@gmail.com\n`,
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1);
      assert.match(output, /__contact_fixture__\.rs:2/);
    },
  );
});

test('does not exempt copyright notices in application source or vendor lookalikes', () => {
  for (const path of [
    'packages/shared/src/__contact_fixture__.ts',
    'vendor/little_exif/src-lookalike/__contact_fixture__.rs',
  ]) {
    withTrackedFixture(path, UPSTREAM_NOTICE, () => {
      assert.equal(runAudit().code, 1, `${path} must stay protected`);
    });
  }
});

test('does not exempt contacts or forwarding destinations in vendor documentation', () => {
  withTrackedFixture(
    'vendor/little_exif/__contact_fixture__.md',
    'Varve support forwards to operator.mailbox@fastmail.com.\n',
    () => {
      const { code, output } = runAudit();
      assert.equal(code, 1);
      assert.match(output, /ROUTING/);
    },
  );
});

test('does not exempt an altered copyright notice with another mailbox', () => {
  withTrackedFixture(
    'vendor/little_exif/src/__contact_fixture__.rs',
    UPSTREAM_NOTICE.replace('and CONTRIBUTORS', 'and CONTRIBUTORS <operator@gmail.com>'),
    () => {
      assert.equal(runAudit().code, 1);
    },
  );
});

if (failures > 0) {
  console.error(`\naudit-contacts.test.mjs — ${failures} failing test(s).`);
  process.exit(1);
}
console.log('audit-contacts.test.mjs — all tests passed.');
