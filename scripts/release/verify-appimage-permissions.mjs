#!/usr/bin/env node
/**
 * Fail a release AppImage whose SquashFS is not world-traversable.
 *
 * AppImageHub launches with `firejail --appimage`, which kernel-mounts the
 * image and enforces mode bits. `--appimage-extract` and FUSE mounts rewrite
 * or ignore those bits, so this check reads the SquashFS directly:
 *
 *   unsquashfs -lln -o $(./X.AppImage --appimage-offset) X.AppImage
 *
 * Fail if any directory lacks other-read+other-execute, or any owner-
 * executable file lacks other-execute. That is the 0.5.0 AppImageHub
 * failure (root-owned 0700 directories and 0770 AppRun.wrapped).
 *
 *   node scripts/release/verify-appimage-permissions.mjs --appimage X.AppImage
 *   node scripts/release/verify-appimage-permissions.mjs --bundle-dir <bundle>
 *   node scripts/release/verify-appimage-permissions.mjs --listing-file listing.txt
 */
import { execFileSync } from 'node:child_process';
import { existsSync, readdirSync, readFileSync } from 'node:fs';
import { join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const MODE_RE = /^([dlbcps-])([r-][w-][xsS-])([r-][w-][xsS-])([r-][w-][xtT-])\b/;
const TIMESTAMP_RE = /\s(\d{4}-\d{2}-\d{2}\s+\d{2}:\d{2})\s+(.+)$/;

function parseArgs(argv) {
  const args = {};
  for (let i = 0; i < argv.length; i += 1) {
    if (!argv[i].startsWith('--')) throw new Error(`Unexpected argument: ${argv[i]}`);
    const key = argv[i].slice(2);
    const next = argv[i + 1];
    if (next === undefined || next.startsWith('--')) {
      args[key] = true;
      continue;
    }
    args[key] = next;
    i += 1;
  }
  return args;
}

function hasExec(triple) {
  return triple.includes('x') || triple.includes('s') || triple.includes('t');
}

function hasRead(triple) {
  return triple.startsWith('r');
}

export function normalizeListingPath(rawPath) {
  let path = rawPath.trim();
  if (path.startsWith('./')) path = path.slice(2);
  path = path.replace(/\\/g, '/');
  if (path === 'squashfs-root' || path === '.' || path === '' || path === '/') return '/';
  if (path.startsWith('squashfs-root/')) path = path.slice('squashfs-root/'.length);
  if (!path.startsWith('/')) path = `/${path}`;
  return path;
}

/**
 * Parse `unsquashfs -lln` output into { type, mode, user, group, other, path }.
 * Header lines and blank lines are ignored.
 */
export function parseUnsquashfsListing(text) {
  const entries = [];
  for (const line of String(text).split(/\r?\n/)) {
    const mode = line.match(MODE_RE);
    if (!mode) continue;
    const stamp = line.match(TIMESTAMP_RE);
    const rawPath = stamp ? stamp[2] : line.slice(mode[0].length).trim().split(/\s+/).at(-1);
    if (!rawPath) continue;
    entries.push({
      type: mode[1] === 'd' ? 'dir' : mode[1] === 'l' ? 'symlink' : 'file',
      mode: line.slice(0, 10),
      user: mode[2],
      group: mode[3],
      other: mode[4],
      path: normalizeListingPath(rawPath),
    });
  }
  return entries;
}

export function findPermissionViolations(entries) {
  const violations = [];
  for (const entry of entries) {
    if (entry.type === 'symlink') continue;
    if (entry.type === 'dir') {
      if (!hasRead(entry.other) || !hasExec(entry.other)) {
        violations.push({
          path: entry.path,
          mode: entry.mode,
          reason: 'directory is not world-readable/executable',
        });
      }
      continue;
    }
    if (hasExec(entry.user) && !hasExec(entry.other)) {
      violations.push({
        path: entry.path,
        mode: entry.mode,
        reason: 'executable is not world-executable',
      });
    }
  }
  return violations;
}

function findAppImage(bundleDir) {
  const appImageDir = join(bundleDir, 'appimage');
  if (!existsSync(appImageDir)) return null;
  const name = readdirSync(appImageDir).find((file) => file.endsWith('.AppImage'));
  return name ? join(appImageDir, name) : null;
}

export function inspectAppImagePermissions(
  appImagePath,
  { execFile = execFileSync, listingText = null } = {},
) {
  let listing = listingText;
  let offset = null;
  if (listing == null) {
    offset = String(execFile(appImagePath, ['--appimage-offset'], { encoding: 'utf8' })).trim();
    if (!/^\d+$/.test(offset)) {
      throw new Error(`Invalid AppImage squashfs offset from ${appImagePath}: ${offset}`);
    }
    listing = execFile('unsquashfs', ['-lln', '-o', offset, appImagePath], {
      encoding: 'utf8',
      maxBuffer: 16 * 1024 * 1024,
    });
  }
  const entries = parseUnsquashfsListing(listing);
  if (entries.length === 0) {
    throw new Error(`unsquashfs listing for ${appImagePath} contained no file entries`);
  }
  if (!entries.some((entry) => entry.type === 'dir' && entry.path === '/')) {
    throw new Error(`unsquashfs listing for ${appImagePath} is missing the SquashFS root`);
  }
  return {
    offset,
    listing,
    entries,
    violations: findPermissionViolations(entries),
  };
}

export function formatPermissionViolations(violations) {
  return violations.map((item) => `  ${item.mode} ${item.path} — ${item.reason}`).join('\n');
}

export function verifyAppImagePermissions(appImagePath, options = {}) {
  const result = inspectAppImagePermissions(appImagePath, options);
  if (result.violations.length > 0) {
    throw new Error(
      `AppImage SquashFS is not world-readable/executable (firejail --appimage will fail):\n` +
        formatPermissionViolations(result.violations),
    );
  }
  return result;
}

function main() {
  const args = parseArgs(process.argv.slice(2));
  let appImage = args.appimage ? resolve(args.appimage) : null;
  if (!appImage && args['bundle-dir']) {
    appImage = findAppImage(resolve(args['bundle-dir']));
  }
  const listingText = args['listing-file']
    ? readFileSync(resolve(args['listing-file']), 'utf8')
    : null;
  if (!appImage && listingText == null) {
    throw new Error(
      'Pass --appimage <file>, --bundle-dir <tauri bundle>, or --listing-file <txt>.',
    );
  }

  const label = appImage ?? args['listing-file'];
  const result = verifyAppImagePermissions(appImage ?? label, { listingText });
  process.stdout.write(
    `AppImage SquashFS permissions OK (${result.entries.length} entries` +
      (result.offset ? `, offset ${result.offset}` : '') +
      `): ${label}\n`,
  );
}

const isDirectRun =
  process.argv[1] !== undefined && resolve(process.argv[1]) === fileURLToPath(import.meta.url);
if (isDirectRun) {
  try {
    main();
  } catch (error) {
    process.stderr.write(`${error instanceof Error ? error.message : error}\n`);
    process.exitCode = 1;
  }
}
