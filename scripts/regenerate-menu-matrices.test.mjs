#!/usr/bin/env node
/**
 * Unit tests for scripts/regenerate-menu-matrices.mjs
 *
 * Run: node scripts/regenerate-menu-matrices.test.mjs
 * Wired into the regression suite (pnpm test:ci:tools). Also acts as a
 * drift gate: if defs.ts changed and the committed matrices were not
 * regenerated, the final assertion fails with the regeneration command.
 */
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import { generate, parseDefs, parseLabels, resolveLabel } from './regenerate-menu-matrices.mjs';

const ROOT = join(dirname(fileURLToPath(import.meta.url)), '..');
const defsText = readFileSync(join(ROOT, 'packages/editor/src/menu/defs.ts'), 'utf8');
const locText = readFileSync(join(ROOT, 'packages/editor/src/menu/localization.ts'), 'utf8');

// ── Structure ────────────────────────────────────────────────────────────────
const menus = parseDefs(defsText);
assert.deepEqual(
  Object.keys(menus),
  ['file', 'edit', 'text', 'view', 'object', 'arrange', 'page', 'help'],
  'menubar menus in canonical order',
);

const counts = Object.fromEntries(Object.entries(menus).map(([k, v]) => [k, v.length]));
assert.deepEqual(
  counts,
  {
    file: 29,
    edit: 16,
    text: 12,
    view: 51,
    object: 40,
    arrange: 19,
    page: 3,
    help: 6,
  },
  'item counts per menu (drift here means defs.ts grew — regenerate)',
);

const ids = Object.values(menus)
  .flat()
  .map((i) => i.id);
for (const required of [
  'workspaceCodegen',
  'setFileThumbnail',
  'imageTrace',
  'quitApp',
  'linkTextFrames',
  'expandStroke',
  'alignLeft',
  'auditSelection',
  'createLogoConcept',
  'openRecent',
]) {
  assert.ok(ids.includes(required), `missing ${required} — defs.ts changed?`);
}

// Deliberate exclusions: top-level menu containers, canvas context menu,
// dynamic recent-files internals.
for (const excluded of [
  'file',
  'edit',
  'text',
  'view',
  'object',
  'arrange',
  'page',
  'help',
  'ctx-cut',
  'ctx-group',
  'noRecent',
  'clearRecent',
]) {
  assert.ok(!ids.includes(excluded), `${excluded} should not appear in the matrices`);
}

// ── Capability extraction ────────────────────────────────────────────────────
const byId = new Map(
  Object.values(menus)
    .flat()
    .map((i) => [i.id, i]),
);
assert.deepEqual(byId.get('archiveBackup').cap, { name: 'archive', negated: false });
assert.deepEqual(byId.get('downloadSnapshot').cap, { name: 'archive', negated: true });
assert.equal(byId.get('quitApp').cap, 'os-not-mac');
assert.deepEqual(byId.get('installDesktopApp').cap, { name: 'nativeMenu', negated: true });

// ── Workspace filters ────────────────────────────────────────────────────────
assert.deepEqual(byId.get('softProof').workspaces, ['print', 'image']);
assert.deepEqual(byId.get('toggleFacingPages').workspaces, ['print']);
assert.deepEqual(byId.get('textToOutlines').workspaces, ['design', 'print', 'drawing']);
assert.equal(byId.get('new').workspaces, null, 'no filter means visible everywhere');

// ── Label resolution ─────────────────────────────────────────────────────────
const labels = parseLabels(locText);
assert.equal(resolveLabel('menu.file.new', labels), 'New');
assert.equal(resolveLabel('Set File Thumbnail…', labels), 'Set File Thumbnail…');
assert.equal(resolveLabel('menu.view.toggleSnap', labels), 'Snap');
assert.equal(resolveLabel('menu.view.someUnregisteredKey', labels), 'Some Unregistered Key');

// ── Determinism + drift gate ─────────────────────────────────────────────────
const first = generate();
const second = generate();
assert.equal(first.capability, second.capability, 'capability matrix must be deterministic');
assert.equal(first.workspace, second.workspace, 'workspace matrix must be deterministic');

const capFile = readFileSync(join(ROOT, 'docs/menu-capability-matrix.md'), 'utf8');
assert.equal(
  capFile,
  first.capability,
  'docs/menu-capability-matrix.md is stale — run: node scripts/regenerate-menu-matrices.mjs',
);
const wsFile = readFileSync(join(ROOT, 'docs/menu-workspace-matrix.md'), 'utf8');
assert.equal(
  wsFile,
  first.workspace,
  'docs/menu-workspace-matrix.md is stale — run: node scripts/regenerate-menu-matrices.mjs',
);

console.log('regenerate-menu-matrices: ok (176 menubar items, drift-checked)');
