#!/usr/bin/env node
/**
 * Regression tests for the AppImage library-prune plan.
 *
 * Context: v0.2.1's published AppImages shipped without the bundled native
 * ONNX Runtime because the prune step removed all of `usr/lib`, including
 * Tauri's resource directory `usr/lib/<productName>`. These tests pin the
 * plan that keeps resources while removing the bundled GTK/WebKit closure.
 */
import assert from 'node:assert/strict';
import { existsSync, mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { dirname, join, resolve } from 'node:path';
import { collectPrunePlan, resolveLinuxResourceDirName } from './prune-appimage-bundled-libs.mjs';

const root = resolve(import.meta.dirname, '../..');
const fixture = mkdtempSync(join(tmpdir(), 'varve-prune-plan-'));

function write(path, contents = 'x') {
  mkdirSync(dirname(path), { recursive: true });
  writeFileSync(path, contents);
}

function relative(squashfsRoot, path) {
  return path.slice(squashfsRoot.length + 1);
}

try {
  // ── 1. Resource directory survives; library entries are removed ──────────
  const appRoot = join(fixture, 'appdir');
  write(join(appRoot, 'usr', 'bin', 'varve-desktop'));
  write(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'libwebkit2gtk-4.1.so.0'));
  write(
    join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu', 'gtk-3.0', 'modules', 'libprintbackend.so'),
  );
  write(join(appRoot, 'usr', 'lib', 'libgtk-3.so.0'));
  write(
    join(appRoot, 'usr', 'lib', 'Varve', 'onnxruntime-libs', 'linux-aarch64', 'libonnxruntime.so'),
  );
  write(join(appRoot, 'usr', 'lib64', 'lib64leftover.so'));

  const plan = collectPrunePlan(appRoot, 'Varve');
  assert.deepEqual(
    plan.keep.map((p) => relative(appRoot, p)),
    ['usr/lib/Varve'],
    'the product resource directory must be the only kept entry',
  );
  assert.deepEqual(
    plan.remove.map((p) => relative(appRoot, p)).sort(),
    ['usr/lib/aarch64-linux-gnu', 'usr/lib/libgtk-3.so.0', 'usr/lib64/lib64leftover.so'].sort(),
    'every library entry must be selected for removal',
  );

  for (const entry of plan.remove) rmSync(entry, { recursive: true, force: true });
  assert.ok(
    existsSync(
      join(
        appRoot,
        'usr',
        'lib',
        'Varve',
        'onnxruntime-libs',
        'linux-aarch64',
        'libonnxruntime.so',
      ),
    ),
    'the bundled ONNX Runtime must survive pruning',
  );
  assert.ok(
    !existsSync(join(appRoot, 'usr', 'lib', 'aarch64-linux-gnu')),
    'system lib dirs must go',
  );
  assert.ok(!existsSync(join(appRoot, 'usr', 'lib64', 'lib64leftover.so')), 'lib64 must be pruned');

  // ── 2. Missing resource directory: everything under the lib trees goes ──
  const bareRoot = join(fixture, 'bare');
  write(join(bareRoot, 'usr', 'lib', 'x86_64-linux-gnu', 'libwebkit2gtk-4.1.so.0'));
  const barePlan = collectPrunePlan(bareRoot, 'Varve');
  assert.equal(barePlan.keep.length, 0, 'no resource directory means nothing is kept');
  assert.equal(barePlan.remove.length, 1, 'the bundled library is still removed');
  assert.ok(
    !barePlan.remove.includes(join(bareRoot, 'usr', 'lib', 'Varve')),
    'a non-existent resource directory is never part of the plan',
  );

  // ── 3. Missing usr/lib trees are tolerated ───────────────────────────────
  const emptyRoot = join(fixture, 'empty');
  mkdirSync(emptyRoot, { recursive: true });
  assert.deepEqual(collectPrunePlan(emptyRoot, 'Varve'), { remove: [], keep: [] });

  // ── 4. Resource directory name comes from the real Tauri config ─────────
  const productName = resolveLinuxResourceDirName(
    join(root, 'apps', 'desktop', 'src-tauri', 'tauri.conf.json'),
  );
  assert.equal(
    productName,
    'Varve',
    'tauri.conf.json productName must match the deb resource path',
  );
  assert.equal(resolveLinuxResourceDirName(join(fixture, 'missing', 'tauri.conf.json')), null);

  const confFixture = join(fixture, 'conf', 'tauri.conf.json');
  write(confFixture, JSON.stringify({ productName: 'FixtureApp' }));
  assert.equal(resolveLinuxResourceDirName(confFixture), 'FixtureApp');
  write(confFixture, JSON.stringify({ productName: '' }));
  assert.equal(resolveLinuxResourceDirName(confFixture), null);

  console.log('prune-appimage-bundled-libs tests passed');
} finally {
  rmSync(fixture, { recursive: true, force: true });
}
