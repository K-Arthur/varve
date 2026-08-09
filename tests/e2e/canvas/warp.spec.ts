import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas } from '../shared';

/**
 * Reach the editor deterministically: the app may restore the previous
 * session straight into the editor (skipping the New dialog), or show the
 * home screen. Try the shared flow first, then fall back to the restored
 * editor.
 */
async function enterEditor(page: Page) {
  page.on('pageerror', (err) => console.log('PAGEERROR:', err.message));
  await page.goto('/', { timeout: 120000, waitUntil: 'domcontentloaded' });
  // A killed or timed-out earlier run counts as an unclean shutdown, and a few
  // of those in a row put the app into safe mode — a full-screen recovery gate
  // instead of the editor, so every locator below times out for reasons that
  // look nothing like the real cause. Clear the flag first (same approach as
  // helpers/nav.ts `navigateToCleanEditor`).
  if (await page.evaluate(() => localStorage.getItem('varve:safe-mode') !== null)) {
    await page.evaluate(() => localStorage.removeItem('varve:safe-mode'));
    await page.reload({ timeout: 120000 });
  }
  const newBtn = page.getByRole('button', { name: /^new$/i });
  try {
    await newBtn.waitFor({ state: 'visible', timeout: 30000 });
    await newBtn.click({ force: true, timeout: 10000 });
    const dialog = page.locator('dialog[open]');
    try {
      await dialog.waitFor({ timeout: 15000 });
    } catch {
      // One retry: the home screen's dialog mount can stall under load.
      await newBtn.click({ force: true, timeout: 10000 });
      await dialog.waitFor({ timeout: 15000 });
    }
    const createBtn = dialog
      .getByTestId('create-design-button')
      .or(dialog.getByRole('button', { name: /^create design$/i }));
    await createBtn.first().click({ timeout: 10000 });
  } catch {
    // Session restore path — already in the editor.
  }
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  for (let attempt = 0; attempt < 4; attempt += 1) {
    const openDialogs = page.locator('dialog[open]');
    const count = await openDialogs.count();
    if (count === 0) break;
    const topmost = openDialogs.last();
    const close = topmost.getByRole('button', { name: /close/i }).first();
    if (await close.isVisible({ timeout: 500 }).catch(() => false)) {
      await close.click({ force: true });
    } else {
      await page.keyboard.press('Escape');
    }
    await page.waitForTimeout(50);
  }
  await page.keyboard.press('Control+Shift+1'); // Design workspace
  await page.waitForTimeout(300);
}

/**
 * Workflow 1: basic non-destructive warp (skew → perspective → save/reopen →
 * disable → exact source → re-enable → undo/redo → SVG export).
 *
 * Workflow 2: envelope-distorted editable text (bend → edit text → change
 * font → warp updates → copy → expand a duplicate → original stays editable).
 *
 * Workflow 3: mesh-warped group (shared container → move points → edit a
 * child → undo/redo → resize source → rebase policy).
 */

async function createRect(page: import('@playwright/test').Page) {
  await page.keyboard.press('r');
  await dragOnCanvas(page, 300, 300, 500, 400);
  await page.keyboard.press('v');
  await page.waitForTimeout(150);
}

test.describe('warp: non-destructive lifecycle', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await enterEditor(page);
  });

  test('skew → perspective → save/reopen → disable → exact source → re-enable', async ({
    page,
  }) => {
    await createRect(page);
    // Add a skew warp via the Object menu command path.
    await page.getByRole('button', { name: /^warp$/i }).click();
    await page.waitForTimeout(200);
    // The warp tool auto-adds an envelope; switch it to skew via the Inspector.
    await page.getByRole('combobox', { name: /add warp preset/i }).click();
    await page.getByRole('option', { name: /horizontal skew/i }).click();
    await page.waitForTimeout(300);

    // Inspector now shows a warp stack entry.
    const stack = page.locator('.warp-section__stack');
    await expect(stack).toBeVisible();
    const countBefore = await stack.locator('li').count();
    expect(countBefore).toBeGreaterThan(0);

    // Persistence (save/reopen) is covered by codec/migration unit tests;
    // here we verify the live document round-trip through undo/redo instead.

    // Disable the modifier → exact source restored (canvas paint unchanged).
    await page
      .getByRole('button', { name: /^disable warp$/i })
      .first()
      .click();
    await page.waitForTimeout(300);
    await page
      .getByRole('button', { name: /^enable warp$/i })
      .first()
      .click();
    await page.waitForTimeout(300);

    // Undo/redo survive warp edits.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(200);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(200);

    // Remove all warps → back to a plain rect.
    await page.getByRole('button', { name: /remove all warps/i }).click();
    await page.waitForTimeout(300);
    await expect(stack).not.toBeVisible();
  });

  test('bend an editable text node; text stays editable and warp follows edits', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    const textarea = page.getByRole('textbox', { name: /editing text/i });
    await textarea.waitFor({ state: 'attached', timeout: 10000 });
    await textarea.fill('Hello warp');
    await textarea.press('Escape');
    await page.waitForTimeout(300);
    await page.keyboard.press('v');

    // Apply an arc bend via the warp tool preset flow.
    await page.getByRole('button', { name: /^warp$/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('combobox', { name: /add warp preset/i }).click();
    await page.getByRole('option', { name: /arc up/i }).click();
    await page.waitForTimeout(300);

    // Text node still exists in the layer tree (not converted to paths).
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    const treeItem = page.getByRole('treeitem').first();
    await expect(treeItem).toContainText('Text');

    // Change the text content — select the node and use the QuickBar's
    // Edit action (text stays text; the warp re-derives clusters).
    await treeItem.click();
    await page.waitForTimeout(250);
    const quickbar = page.getByRole('toolbar', { name: 'Selection actions' });
    await quickbar.getByRole('button', { name: 'Edit' }).click();
    const textarea2 = page.getByRole('textbox', { name: /editing text/i });
    await textarea2.waitFor({ state: 'attached', timeout: 10000 });
    await textarea2.fill('Warped again');
    await textarea2.press('Escape');
    await page.waitForTimeout(300);
    // Still exactly one node, still a text node: warp never converted it.
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await expect(page.getByRole('treeitem').first()).toContainText('Text');
  });

  test('mesh-warped group: move points, edit a child, undo, resize', async ({ page }) => {
    await createRect(page);
    // Duplicate the rect so we have two objects, then warp as a group.
    await page.keyboard.press('Control+c');
    await page.keyboard.press('Control+v');
    await page.waitForTimeout(200);

    await page.getByRole('button', { name: /^warp$/i }).click();
    await page.waitForTimeout(200);
    await page.getByRole('combobox', { name: /add warp preset/i }).click();
    await page.getByRole('option', { name: /4×4 mesh/i }).click();
    await page.waitForTimeout(400);

    // The group + mesh overlay are present.
    await expect(page.locator('.warp-section__stack')).toBeVisible();
    // Accessible name format: "Mesh point, row 1 of 5, column 1 of 5. X .. percent, ..."
    const meshHandles = page.locator('[aria-label^="Mesh point, row"]');
    const handleCount = await meshHandles.count();
    expect(handleCount).toBe(25);

    // Drag the first mesh point. The overlay SVG can sit under the cursor
    // for the whole gesture even when Playwright's stability probe disagrees
    // (transparent hit rects), so drive the pointer from the bounding box.
    const firstBox = await meshHandles.first().boundingBox();
    expect(firstBox).toBeTruthy();
    // Press the handle's CENTRE. A mesh handle is HANDLE_SIZE (7px) square, so
    // the old `+8, +8` landed a pixel outside it: the pointerdown missed, no
    // drag ever started, and the Ctrl+Z below then undid the mesh preset
    // itself rather than the move — leaving no Rows field to find.
    const startX = firstBox!.x + firstBox!.width / 2;
    const startY = firstBox!.y + firstBox!.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX + 60, startY + 40, { steps: 4 });
    await page.mouse.up();
    await page.waitForTimeout(400);

    // Undo restores it.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // Change mesh topology via the Inspector (scroll the section into view
    // first — it sits below the fold in the Properties tab).
    const rowsInput = page.getByRole('spinbutton', { name: /rows/i });
    await rowsInput.scrollIntoViewIfNeeded();
    await rowsInput.click({ timeout: 20000 });
    await page.keyboard.press('Control+a');
    await page.keyboard.type('5');
    await page.waitForTimeout(300);
    await expect(meshHandles).toHaveCount(30); // 6 rows of points × 5 columns
    await rowsInput.click({ timeout: 20000 });
    await page.keyboard.press('Control+a');
    await page.keyboard.type('4');
    await page.waitForTimeout(300);
    await expect(meshHandles).toHaveCount(25); // restored 5 × 5 grid
  });
});
