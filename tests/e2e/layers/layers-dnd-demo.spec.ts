/**
 * Layers drag and drop on the browser demo (`/try`).
 *
 * The demo serves the same editor frontend, so correctness should match the
 * desktop path — but it boots through a different entry (`useDemoEntry` seeds
 * and opens a sample document), runs with demo gating applied, and in
 * production is a separately built bundle. Verify the drag independently
 * rather than assuming shared code implies shared behaviour.
 *
 * In dev the demo is reachable as `?try=1` on the same Vite server; the real
 * `/try/` path only exists once `stage-demo.mjs` copies the built bundle into
 * the website output (see docs/architecture/browser-demo.md).
 */

import { expect, type Page, test } from '@playwright/test';

/**
 * The demo has its own entry: `useDemoEntry` seeds a sample document and opens
 * it directly, so there is no "New" button and no create dialog to click
 * through. The shared `navigateToEditor` helper drives that normal flow and
 * therefore cannot be used here.
 */
async function openDemo(page: Page) {
  await page.goto('/?try=1', { timeout: 300_000, waitUntil: 'domcontentloaded' });

  // A previously crashed run can leave safe mode latched, which gates the
  // whole UI. Same handling as the shared helper.
  if (await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null)) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 300_000 });
  }
  const continueStartup = page.getByRole('button', { name: /continue normal startup/i });
  if (await continueStartup.isVisible({ timeout: 3000 }).catch(() => false)) {
    await continueStartup.click({ timeout: 10_000 });
  }
  const recovery = page
    .locator('dialog[open]')
    .filter({ hasText: /closed unexpectedly|recover/i })
    .first();
  if (await recovery.isVisible({ timeout: 2000 }).catch(() => false)) {
    await page
      .getByRole('button', { name: /review my documents|don't send/i })
      .first()
      .click({ timeout: 10_000 })
      .catch(() => undefined);
  }

  await page.getByRole('tree', { name: /layers/i }).waitFor({ state: 'visible', timeout: 240_000 });

  // The demo notice sits above the editor and carries a usage-measurement
  // prompt that resolves asynchronously. Both change the page's height, which
  // moves every row between measuring a bounding box and driving the pointer
  // to it. Settle them before any geometry is read.
  const usagePrompt = page.getByRole('button', { name: /^no thanks$/i });
  if (await usagePrompt.isVisible({ timeout: 5000 }).catch(() => false)) {
    await usagePrompt.click({ timeout: 10_000 }).catch(() => undefined);
  }
  const dismiss = page.getByRole('button', { name: /dismiss demo notice/i });
  if (await dismiss.isVisible({ timeout: 5000 }).catch(() => false)) {
    await dismiss.click({ timeout: 10_000 }).catch(() => undefined);
    await dismiss.waitFor({ state: 'hidden', timeout: 10_000 }).catch(() => undefined);
  }
  // Let the resulting reflow land before anything measures a row.
  await page.waitForTimeout(500);
}

async function readRows(page: Page) {
  return page.getByRole('treeitem').evaluateAll((rows) =>
    rows.map((r) => ({
      id: r.getAttribute('data-node-id') ?? '',
      level: Number(r.getAttribute('aria-level') ?? '1'),
    })),
  );
}

async function readIndicator(page: Page) {
  return page.evaluate(() => {
    for (const zone of ['before', 'after', 'into'] as const) {
      const el = document.querySelector(`.layers-row--drop-${zone}`);
      if (el) {
        return {
          nodeId: el.querySelector('[data-node-id]')?.getAttribute('data-node-id') ?? null,
          zone,
          invalid: el.classList.contains('layers-row--drop-invalid'),
        };
      }
    }
    return null;
  });
}

test.describe('Layers DnD — browser demo', () => {
  test('the seeded demo document reorders to the previewed target', async ({ page }) => {
    test.setTimeout(300_000);
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(e.message));

    await page.setViewportSize({ width: 1280, height: 900 });
    await openDemo(page);

    // The demo seeds its own sample document, so there is content to drag
    // without driving the canvas first.
    const rows = page.getByRole('treeitem');
    await expect(rows.first()).toBeVisible({ timeout: 60_000 });
    await expect.poll(async () => rows.count(), { timeout: 30_000 }).toBeGreaterThanOrEqual(2);

    const before = await readRows(page);
    // Pick two adjacent rows at one nesting level so the assertion is a plain
    // sibling reorder rather than a reparent. Adjacent rows fit the demo
    // panel's short scroll viewport together, which a wider pick would not —
    // and a row that is clipped by the viewport cannot receive the pointer.
    const levels = new Map<number, typeof before>();
    for (const row of before) levels.set(row.level, [...(levels.get(row.level) ?? []), row]);
    const siblings = [...levels.values()].find((rows) => rows.length >= 2);
    if (!siblings) throw new Error('demo document exposes no sibling pair to reorder');
    const target = siblings[0]!;
    const source = siblings[1]!;

    const sourceRow = page.locator(`[role="treeitem"][data-node-id="${source.id}"]`);
    const targetRow = page.locator(`[role="treeitem"][data-node-id="${target.id}"]`);
    // The demo's notice and usage prompt settle asynchronously and reflow the
    // panel. Bring the source into view and re-measure immediately before
    // driving the pointer so the coordinates cannot go stale mid-gesture.
    await sourceRow.scrollIntoViewIfNeeded();
    const handleBox = await sourceRow.locator('.layers-row__drag-handle').boundingBox();
    if (!handleBox) throw new Error('source drag handle geometry unavailable');
    const tgtBox = await targetRow.boundingBox();
    if (!tgtBox) throw new Error('target row geometry unavailable');

    const startX = handleBox.x + handleBox.width / 2;
    const startY = handleBox.y + handleBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 8);
    await page.mouse.move(tgtBox.x + tgtBox.width / 2, tgtBox.y + 2, { steps: 8 });
    await expect(page.locator('.drag-overlay')).toBeVisible({ timeout: 10_000 });

    const preview = await readIndicator(page);
    expect(preview).toEqual({ nodeId: target.id, zone: 'before', invalid: false });
    await page
      .getByTestId('layers-panel')
      .screenshot({ path: 'test-results/layers-demo-before-drop.png' });
    await page.mouse.up();

    // Same invariant as the desktop path: the previewed slot is the committed
    // slot.
    await expect
      .poll(async () => {
        const after = await readRows(page);
        const si = after.findIndex((r) => r.id === source.id);
        const ti = after.findIndex((r) => r.id === target.id);
        return si >= 0 && ti >= 0 ? si - ti : null;
      })
      .toBe(-1);

    expect(errors, 'uncaught page errors during demo DnD').toEqual([]);
  });
});
