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
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

const ROOT = fileURLToPath(new URL('../', import.meta.url));
const AUDIT = join(ROOT, 'scripts/audit-contacts.mjs');

/**
 * The audit scans `git ls-files`, so fixtures must be tracked to be seen.
 * Stage each batch once and run the full repository scan once per policy
 * class; repeating the 9k-file scan for every individual fixture made this
 * portability test needlessly slow on macOS runners.
 */
function withTrackedFixtures(fixtures, assertion) {
  const paths = fixtures.map(({ path }) => path);
  try {
    for (const { path, contents } of fixtures) {
      const abs = join(ROOT, path);
      mkdirSync(dirname(abs), { recursive: true });
      writeFileSync(abs, contents, 'utf8');
    }
    execFileSync('git', ['add', '--intent-to-add', '--', ...paths], {
      cwd: ROOT,
      timeout: 30_000,
    });
    assertion();
  } finally {
    try {
      execFileSync('git', ['rm', '--cached', '--force', '--quiet', '--', ...paths], {
        cwd: ROOT,
        timeout: 30_000,
      });
    } catch {
      /* never staged */
    }
    for (const path of paths) rmSync(join(ROOT, path), { force: true });
  }
}

function runAudit() {
  try {
    const stdout = execFileSync('node', [AUDIT], {
      cwd: ROOT,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      timeout: 5 * 60_000,
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

const UPSTREAM_NOTICE =
  '// Copyright © 2022-2026 Tobias J. Prisching <tobias.prisching@icloud.com> and CONTRIBUTORS\n';

test('passes on the repository and preserves allowed historical and upstream contacts', () => {
  const allowedFixtures = [
    {
      path: 'docs/audits/__contact_historical__.md',
      contents: 'Early commits were authored as `Strata Founder <founder@strata.local>`.\n',
    },
    {
      path: 'apps/website/src/__contact_canonical__.astro',
      contents: [
        'hello@varve.studio support@varve.studio feedback@varve.studio',
        'security@varve.studio privacy@varve.studio press@varve.studio',
        'partnerships@varve.studio',
        '',
      ].join('\n'),
    },
    {
      path: 'vendor/little_exif/src/__contact_upstream__.rs',
      contents: UPSTREAM_NOTICE,
    },
  ];

  withTrackedFixtures(allowedFixtures, () => {
    const { code, output } = runAudit();
    assert.equal(code, 0, `expected clean, got:\n${output}`);
    assert.match(output, /audit:contacts — clean/);
  });
});

test('rejects contact leaks across application, history, and vendor surfaces', () => {
  const violatingFixtures = [
    {
      path: 'packages/shared/src/__contact_application__.ts',
      contents: 'export const OOPS = "varve.maintainer@gmail.com";\n',
    },
    {
      // The NAMING exemption must not become a privacy loophole.
      path: 'docs/plans/__contact_historical_mailbox__.md',
      contents: 'Alias mail lands in someones.inbox@outlook.com today.\n',
    },
    {
      path: 'apps/website/src/__contact_retired_brand__.astro',
      contents: '<a href="mailto:support@strata.design">mail</a>\n',
    },
    {
      path: 'apps/website/src/__contact_wrong_domain__.astro',
      contents: '<a href="mailto:support@varve.design">mail</a>\n',
    },
    {
      path: 'docs/development/__contact_routing__.md',
      contents: 'All aliases forward to operator.mailbox@fastmail.com for now.\n',
    },
    {
      path: 'vendor/little_exif/src/__contact_below_attribution__.rs',
      contents: `${UPSTREAM_NOTICE}// Varve support: varve.support@gmail.com\n`,
    },
    {
      path: 'packages/shared/src/__contact_application_notice__.ts',
      contents: UPSTREAM_NOTICE,
    },
    {
      path: 'vendor/little_exif/src-lookalike/__contact_vendor_lookalike__.rs',
      contents: UPSTREAM_NOTICE,
    },
    {
      path: 'vendor/little_exif/__contact_vendor_routing__.md',
      contents: 'Varve support forwards to operator.mailbox@fastmail.com.\n',
    },
    {
      path: 'vendor/little_exif/src/__contact_altered_attribution__.rs',
      contents: UPSTREAM_NOTICE.replace(
        'and CONTRIBUTORS',
        'and CONTRIBUTORS <operator@gmail.com>',
      ),
    },
  ];

  withTrackedFixtures(violatingFixtures, () => {
    const { code, output } = runAudit();
    assert.equal(code, 1, 'all planted contact leaks must fail the audit');
    for (const path of violatingFixtures.map(({ path }) => path)) {
      assert.ok(output.includes(path), `expected audit output to identify ${path}:\n${output}`);
    }
    assert.match(output, /\[MAILBOX\]/);
    assert.match(output, /\[NAMING\]/);
    assert.match(output, /\[DOMAIN\]/);
    assert.match(output, /\[ROUTING\]/);
    assert.match(output, /__contact_below_attribution__\.rs:2/);
    assert.doesNotMatch(output, /__contact_below_attribution__\.rs:1/);
  });
});

if (failures > 0) {
  console.error(`\naudit-contacts.test.mjs — ${failures} failing test(s).`);
  process.exit(1);
}
console.log('audit-contacts.test.mjs — all tests passed.');
