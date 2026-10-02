#!/usr/bin/env node

/**
 * Runtime containment regression for the locally patched `extract-zip@2.0.1`.
 *
 * GitHub advisory GHSA-7pqw-9j4j-h8q3 (CVE-2026-19693) and the earlier
 * GHSA-jmr9-qjv8-65gv share one root cause: `extract-zip` writes through a
 * symlink planted by the archive. Neither advisory has a patched npm release,
 * so Varve carries `patches/extract-zip@2.0.1.patch`.
 *
 * `scripts/security/dependency-hardening.test.mjs` pins the *contract* of that
 * patch (lockfile hash, patch text). This file proves the *behaviour*: real
 * malicious archives are extracted against a temp directory and an outside
 * canary must never be touched. It loads the exact module the lockfile
 * resolves, so a patch that silently stops applying fails here.
 *
 * Run with: node --test scripts/security/extract-zip-containment.test.mjs
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { lstat, mkdir, mkdtemp, readFile, rm, symlink, writeFile } from 'node:fs/promises';
import { createRequire } from 'node:module';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { crc32 } from 'node:zlib';

const REPO_ROOT = path.resolve(import.meta.dirname, '..', '..');

// ---------------------------------------------------------------------------
// Load exactly the extract-zip the lockfile resolves.
// ---------------------------------------------------------------------------

function resolvePatchedExtractZip() {
  const lockfile = readFileSync(path.join(REPO_ROOT, 'pnpm-lock.yaml'), 'utf8');
  const match = lockfile.match(/extract-zip@2\.0\.1\(patch_hash=([0-9a-f]{64})\)/);
  assert.ok(match, 'pnpm-lock.yaml must resolve extract-zip@2.0.1 through the local patch');
  const modulePath = path.join(
    REPO_ROOT,
    'node_modules',
    '.pnpm',
    `extract-zip@2.0.1_patch_hash=${match[1]}`,
    'node_modules',
    'extract-zip',
    'index.js',
  );
  const require = createRequire(import.meta.url);
  const extract = require(modulePath);
  assert.equal(typeof extract, 'function', 'extract-zip default export must be callable');
  return { extract, modulePath };
}

const { extract } = resolvePatchedExtractZip();

// ---------------------------------------------------------------------------
// Minimal stored-entry ZIP writer (enough for yauzl + extract-zip).
// ---------------------------------------------------------------------------

const MODE_FILE = 0o100644;
const MODE_DIR = 0o040755;
const MODE_SYMLINK = 0o120777;

function buildZip(entries) {
  const chunks = [];
  const central = [];
  let offset = 0;

  for (const entry of entries) {
    const nameBuf = Buffer.from(entry.name, 'utf8');
    const dataBuf = Buffer.isBuffer(entry.data)
      ? entry.data
      : Buffer.from(entry.data ?? '', 'utf8');
    const mode = entry.mode ?? MODE_FILE;
    const crc = crc32(dataBuf) >>> 0;

    const local = Buffer.alloc(30);
    local.writeUInt32LE(0x04034b50, 0);
    local.writeUInt16LE(20, 4); // version needed
    local.writeUInt16LE(0, 6); // flags
    local.writeUInt16LE(0, 8); // method: store
    local.writeUInt16LE(0, 10); // mod time
    local.writeUInt16LE(0x21, 12); // mod date
    local.writeUInt32LE(crc, 14);
    local.writeUInt32LE(dataBuf.length, 18);
    local.writeUInt32LE(dataBuf.length, 22);
    local.writeUInt16LE(nameBuf.length, 26);
    local.writeUInt16LE(0, 28); // extra length

    const centralHeader = Buffer.alloc(46);
    centralHeader.writeUInt32LE(0x02014b50, 0);
    centralHeader.writeUInt16LE(0x031e, 4); // version made by: unix, 30
    centralHeader.writeUInt16LE(20, 6); // version needed
    centralHeader.writeUInt16LE(0, 8); // flags
    centralHeader.writeUInt16LE(0, 10); // method: store
    centralHeader.writeUInt16LE(0, 12); // mod time
    centralHeader.writeUInt16LE(0x21, 14); // mod date
    centralHeader.writeUInt32LE(crc, 16);
    centralHeader.writeUInt32LE(dataBuf.length, 20);
    centralHeader.writeUInt32LE(dataBuf.length, 24);
    centralHeader.writeUInt16LE(nameBuf.length, 28);
    centralHeader.writeUInt16LE(0, 30); // extra length
    centralHeader.writeUInt16LE(0, 32); // comment length
    centralHeader.writeUInt16LE(0, 34); // disk number start
    centralHeader.writeUInt16LE(0, 36); // internal attrs
    centralHeader.writeUInt32LE(((mode & 0xffff) << 16) >>> 0, 38); // external attrs
    centralHeader.writeUInt32LE(offset, 42); // local header offset

    chunks.push(local, nameBuf, dataBuf);
    central.push(centralHeader, nameBuf);
    offset += local.length + nameBuf.length + dataBuf.length;
  }

  const centralBuf = Buffer.concat(central);
  const eocd = Buffer.alloc(22);
  eocd.writeUInt32LE(0x06054b50, 0);
  eocd.writeUInt16LE(0, 4);
  eocd.writeUInt16LE(0, 6);
  eocd.writeUInt16LE(entries.length, 8);
  eocd.writeUInt16LE(entries.length, 10);
  eocd.writeUInt32LE(centralBuf.length, 12);
  eocd.writeUInt32LE(offset, 16);
  eocd.writeUInt16LE(0, 20);

  return Buffer.concat([...chunks, centralBuf, eocd]);
}

async function withTempDir(fn) {
  const dir = await mkdtemp(path.join(tmpdir(), 'ez-containment-'));
  try {
    return await fn(dir);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
}

async function writeZip(dir, name, entries) {
  const zipPath = path.join(dir, name);
  await writeFile(zipPath, buildZip(entries));
  return zipPath;
}

// ---------------------------------------------------------------------------
// Positive controls: the patch must not break legitimate archives.
// ---------------------------------------------------------------------------

test('extracts an ordinary archive', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'dest');
    await mkdir(dest, { recursive: true });
    const zip = await writeZip(tmp, 'benign.zip', [
      { name: 'nested/', mode: MODE_DIR },
      { name: 'nested/hello.txt', data: 'hello world' },
    ]);
    await extract(zip, { dir: dest });
    assert.equal(await readFile(path.join(dest, 'nested', 'hello.txt'), 'utf8'), 'hello world');
  });
});

test('still creates an in-bounds relative symlink', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'dest');
    await mkdir(dest, { recursive: true });
    const zip = await writeZip(tmp, 'symlink.zip', [
      { name: 'target.txt', data: 'target' },
      { name: 'link', data: 'target.txt', mode: MODE_SYMLINK },
    ]);
    await extract(zip, { dir: dest });
    assert.equal(
      await readFile(path.join(dest, 'link'), 'utf8'),
      'target',
      'in-bounds symlink must still resolve to its target',
    );
  });
});

// ---------------------------------------------------------------------------
// GHSA-7pqw-9j4j-h8q3 / GHSA-jmr9-qjv8-65gv.
// ---------------------------------------------------------------------------

test('refuses an out-of-bounds symlink entry (symlink layer)', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'dest');
    await mkdir(dest, { recursive: true });
    const canary = path.join(tmp, 'canary.txt');
    await writeFile(canary, 'ORIGINAL');

    // The advisory's exact shape: a symlink pointing outside followed by a
    // regular file with the identical entry name.
    const zip = await writeZip(tmp, 'symlink-escape.zip', [
      { name: 'pwn', data: '../canary.txt', mode: MODE_SYMLINK },
      { name: 'pwn', data: 'PWNED' },
    ]);

    await assert.rejects(extract(zip, { dir: dest }), /Out of bound symlink target/);
    assert.equal(
      await readFile(canary, 'utf8'),
      'ORIGINAL',
      'file outside the destination must be untouched',
    );
  });
});

test('refuses to write a file through an existing symlink leaf', async () => {
  await withTempDir(async (tmp) => {
    const dest = path.join(tmp, 'dest');
    await mkdir(dest, { recursive: true });
    const canary = path.join(tmp, 'canary.txt');
    await writeFile(canary, 'ORIGINAL');

    // A symlink already occupies the leaf the archive wants to write to.
    await symlink(canary, path.join(dest, 'pwn'));

    const zip = await writeZip(tmp, 'leaf-write-through.zip', [{ name: 'pwn', data: 'PWNED' }]);

    await assert.rejects(extract(zip, { dir: dest }), /Out of bound path/);
    assert.equal(
      await readFile(canary, 'utf8'),
      'ORIGINAL',
      'must not follow a symlink leaf out of the destination',
    );
    assert.ok(
      (await lstat(path.join(dest, 'pwn'))).isSymbolicLink(),
      'the planted leaf must not be replaced',
    );
  });
});
