#!/usr/bin/env node
/**
 * Unit + CLI tests for the AppImage SquashFS permission gate.
 *
 * The listing fixture is the 0.5.0 AppImageHub failure: every directory is
 * 0700 and AppRun.wrapped is 0770. `--appimage-extract` rewrites those bits,
 * so the checker must parse `unsquashfs -lln` output, not an extracted tree.
 */
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  findPermissionViolations,
  inspectAppImagePermissions,
  parseUnsquashfsListing,
  verifyAppImagePermissions,
} from './verify-appimage-permissions.mjs';

const script = fileURLToPath(import.meta.url);
const checker = join(dirname(script), 'verify-appimage-permissions.mjs');

const FAILING_0_5_0 = `
Parallel unsquashfs: Using 2 processors
12 inodes (12 blocks) to write

drwx------ 0/0              27 2026-10-09 04:41 squashfs-root
-rwxr-xr-x 0/0             274 2026-10-09 04:41 squashfs-root/AppRun
-rwxrwx--- 0/0         1234567 2026-10-09 04:41 squashfs-root/AppRun.wrapped
drwx------ 0/0              45 2026-10-09 04:41 squashfs-root/apprun-hooks
drwx------ 0/0              33 2026-10-09 04:41 squashfs-root/usr
drwx------ 0/0              28 2026-10-09 04:41 squashfs-root/usr/bin
-rwxr-xr-x 0/0         2345678 2026-10-09 04:41 squashfs-root/usr/bin/varve-desktop
drwx------ 0/0              29 2026-10-09 04:41 squashfs-root/usr/lib
-rw-r--r-- 0/0             512 2026-10-09 04:41 squashfs-root/usr/share/applications/Varve.desktop
`;

const PASSING = `
drwxr-xr-x 0/0              27 2026-10-09 04:41 squashfs-root
-rwxr-xr-x 0/0             274 2026-10-09 04:41 squashfs-root/AppRun
-rwxr-xr-x 0/0         1234567 2026-10-09 04:41 squashfs-root/AppRun.wrapped
drwxr-xr-x 0/0              33 2026-10-09 04:41 squashfs-root/usr
drwxr-xr-x 0/0              28 2026-10-09 04:41 squashfs-root/usr/bin
-rwxr-xr-x 0/0         2345678 2026-10-09 04:41 squashfs-root/usr/bin/varve-desktop
lrwxrwxrwx 0/0              40 2026-10-09 04:41 squashfs-root/dev.varve.desktop.desktop -> usr/share/applications/dev.varve.desktop.desktop
-rw-r--r-- 0/0             512 2026-10-09 04:41 squashfs-root/usr/share/applications/dev.varve.desktop.desktop
`;

{
  const entries = parseUnsquashfsListing(FAILING_0_5_0);
  assert.equal(entries[0].path, '/');
  assert.equal(entries[0].type, 'dir');
  assert.equal(entries.find((entry) => entry.path === '/AppRun.wrapped')?.mode, '-rwxrwx---');
  const violations = findPermissionViolations(entries);
  const paths = violations.map((item) => item.path).sort();
  assert.deepEqual(paths, [
    '/',
    '/AppRun.wrapped',
    '/apprun-hooks',
    '/usr',
    '/usr/bin',
    '/usr/lib',
  ]);
  assert.ok(
    violations.some(
      (item) => item.path === '/AppRun.wrapped' && item.reason.includes('world-executable'),
    ),
  );
  assert.ok(violations.some((item) => item.path === '/' && item.reason.includes('directory')));
}

{
  const entries = parseUnsquashfsListing(PASSING);
  assert.deepEqual(findPermissionViolations(entries), []);
  assert.equal(
    entries.find((entry) => entry.path === '/dev.varve.desktop.desktop')?.type,
    'symlink',
  );
}

{
  const result = inspectAppImagePermissions('/tmp/Varve-0.5.0-linux-x86_64.AppImage', {
    execFile(cmd, args) {
      if (args?.includes('--appimage-offset')) return '944632\n';
      if (cmd === 'unsquashfs') {
        assert.deepEqual(args, ['-lln', '-o', '944632', '/tmp/Varve-0.5.0-linux-x86_64.AppImage']);
        return FAILING_0_5_0;
      }
      throw new Error(`unexpected exec ${cmd} ${args}`);
    },
  });
  assert.equal(result.offset, '944632');
  assert.ok(result.violations.length > 0);
  assert.throws(
    () =>
      verifyAppImagePermissions('/tmp/Varve-0.5.0-linux-x86_64.AppImage', {
        listingText: FAILING_0_5_0,
      }),
    /AppRun\.wrapped/,
  );
}

{
  const result = verifyAppImagePermissions('fixture.AppImage', { listingText: PASSING });
  assert.equal(result.violations.length, 0);
}

{
  const work = mkdtempSync(join(tmpdir(), 'varve-appimage-perm-'));
  try {
    const failing = join(work, 'failing.txt');
    const passing = join(work, 'passing.txt');
    writeFileSync(failing, FAILING_0_5_0);
    writeFileSync(passing, PASSING);

    const failed = spawnSync(process.execPath, [checker, '--listing-file', failing], {
      encoding: 'utf8',
    });
    assert.equal(failed.status, 1);
    assert.match(failed.stderr, /not world-readable\/executable/);
    assert.match(failed.stderr, /AppRun\.wrapped/);

    const ok = spawnSync(process.execPath, [checker, '--listing-file', passing], {
      encoding: 'utf8',
    });
    assert.equal(ok.status, 0, ok.stderr);
    assert.match(ok.stdout, /permissions OK/);
  } finally {
    rmSync(work, { recursive: true, force: true });
  }
}

{
  const workflow = readFileSync(
    join(dirname(script), '../../.github/workflows/release.yml'),
    'utf8',
  );
  assert.match(
    workflow,
    /unsquashfs -lln/,
    'release.yml must document the squashfs-direct permission check',
  );
  assert.match(workflow, /verify-appimage-permissions\.mjs \\\n\s+--bundle-dir/);
  assert.match(workflow, /verify-appimage-permissions\.mjs --appimage/);
}

console.log('verify-appimage-permissions tests passed');
