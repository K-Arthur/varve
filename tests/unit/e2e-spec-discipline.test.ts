import { readdirSync, readFileSync } from 'node:fs';
import { join, relative, resolve } from 'node:path';
import { describe, expect, it } from 'vitest';

/**
 * E2E specs execute inside the real worktree on CI runners. Two failure
 * classes have no other guard and both turn a passing shard into a red one
 * for reasons unrelated to the product:
 *
 * 1. A spec that writes outside Playwright's own output dirties the worktree.
 *    `scripts/quality/browser-inventory.mjs#requireInventorySource` refuses to
 *    discover an inventory while `git status --porcelain` is non-empty, so the
 *    shard-1 production-demo lane aborts after the E2E cases have already
 *    passed (CI run 37261275694: `tests/e2e/caf/expand-real-photo.spec.ts`
 *    resolved the bare `VARVE_E2E_OUTPUT_DIR` name against the repo root).
 *
 * 2. A native dialog (the app arms a real `beforeunload` guard on an unsaved
 *    document) is dismissed by Playwright by default, which cancels the
 *    navigation. `page.reload()` then never commits and the test burns its
 *    whole budget waiting for `domcontentloaded` (CI run 37261275694: shard 7,
 *    `tests/e2e/canvas/toolbar-followup.spec.ts`).
 */

const E2E_ROOT = resolve(import.meta.dirname, '..', 'e2e');

function specFiles(directory = E2E_ROOT): string[] {
  const found: string[] = [];
  for (const entry of readdirSync(directory, { withFileTypes: true })) {
    const path = join(directory, entry.name);
    if (entry.isDirectory()) found.push(...specFiles(path));
    else if (entry.name.endsWith('.spec.ts')) found.push(path);
  }
  return found;
}

const SPECS = specFiles().sort();

describe('E2E spec filesystem discipline', () => {
  it('discovers the E2E corpus', () => {
    expect(SPECS.length).toBeGreaterThan(50);
  });

  it('never resolves VARVE_E2E_OUTPUT_DIR into a filesystem path', () => {
    // The variable carries a bare directory NAME used for report grouping
    // (scripts/quality/playwright-run-output.mjs). Treating it as a path
    // writes an untracked `run-<pid>-<port>/` directory at the repo root.
    const offenders = SPECS.filter((file) =>
      /path\.(?:resolve|join)\([^)]*VARVE_E2E_OUTPUT_DIR/.test(readFileSync(file, 'utf8')),
    ).map((file) => relative(resolve(import.meta.dirname, '..', '..'), file));
    expect(offenders, 'use test.info().outputPath() instead').toEqual([]);
  });

  it('never awaits reload while waiting for a dialog event', () => {
    // `waitForEvent('dialog')` followed by an awaited `reload()` deadlocks
    // when the dialog is only raised BY the navigation. Register a
    // `page.on('dialog', ...)` handler before the navigation instead.
    const offenders: string[] = [];
    for (const file of SPECS) {
      const source = readFileSync(file, 'utf8');
      if (!/waitForEvent\(\s*['"]dialog['"]/.test(source)) continue;
      if (!/\.reload\(/.test(source)) continue;
      offenders.push(relative(resolve(import.meta.dirname, '..', '..'), file));
    }
    expect(offenders, "use page.on('dialog', ...) before navigating").toEqual([]);
  });
});
