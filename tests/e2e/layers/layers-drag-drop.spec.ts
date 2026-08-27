import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Real pointer-driven drag & drop through the Layers panel.
 *
 * The existing layers-dnd.spec.ts only checks that handles/rows exist — it
 * never performs an actual drag. Per the repo's UI-testing rule, canvas/
 * pointer interactions must be driven through real PointerEvents.
 *
 * Every test also fails on ANY uncaught page error or crash-consent dialog,
 * so a regression that surfaces as "a crash report opened" is caught here.
 */

async function collectErrors(page: Page): Promise<string[]> {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  return errors;
}

async function expectNoCrashDialog(page: Page) {
  const crashDialog = page
    .locator('dialog[open]')
    .filter({ hasText: /closed unexpectedly|trouble starting/i });
  const visible = await crashDialog
    .first()
    .isVisible({ timeout: 500 })
    .catch(() => false);
  if (visible) {
    const text = await crashDialog
      .first()
      .innerText()
      .catch(() => '<unreadable>');
    throw new Error(`Crash dialog appeared during DnD:\n${text}`);
  }
}

async function rowNames(page: Page): Promise<string[]> {
  return page.getByRole('treeitem').evaluateAll((rows) =>
    rows.map((r) => {
      const label =
        r.querySelector('.layers-row__name')?.textContent ??
        r.querySelector('[class*="name"]')?.textContent ??
        r.textContent ??
        '';
      return label.trim();
    }),
  );
}

function rowByName(page: Page, name: string): Locator {
  return page.locator('[role="treeitem"]').filter({ hasText: name }).first();
}

/** Drag one row onto another with real pointer events. offsetFraction -0.35
 *  targets the before band, +0.35 the after band, 0 the into (middle) band. */
async function dragRowToRow(
  page: Page,
  fromName: string,
  toName: string,
  offsetFraction: number,
  screenshotName?: string,
  expectedIndicator?: string,
) {
  const from = rowByName(page, fromName);
  await from.scrollIntoViewIfNeeded();
  const fromBox = await from.boundingBox();
  if (!fromBox) throw new Error(`source row ${fromName} not visible`);
  // Grab by the labeled handle; dnd-kit PointerSensor needs >5px travel.
  const startX = fromBox.x + 8;
  const startY = fromBox.y + fromBox.height / 2;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX, startY - 12);

  const to = rowByName(page, toName);
  await to.scrollIntoViewIfNeeded();
  const toBox = await to.boundingBox();
  if (!toBox) throw new Error(`target row ${toName} not visible`);
  const targetY = toBox.y + toBox.height * (0.5 + offsetFraction);
  const targetX = toBox.x + toBox.width / 2;
  for (let i = 1; i <= 6; i++) {
    await page.mouse.move(
      startX + ((targetX - startX) * i) / 6,
      startY - 12 + ((targetY - (startY - 12)) * i) / 6,
    );
  }
  await page.waitForTimeout(120);
  if (screenshotName) {
    await page.getByTestId('layers-panel').screenshot({
      path: `test-results/${screenshotName}.png`,
    });
  }
  if (expectedIndicator) await expect(page.locator(`.${expectedIndicator}`)).toBeVisible();
  await page.mouse.up();
}

test.describe('Layers Panel — real drag & drop', () => {
  let errors: string[];

  test.beforeEach(async ({ page }) => {
    errors = await collectErrors(page);
    await navigateToEditor(page);
    // Seed three sibling rectangles via the canvas.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15_000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    for (let i = 0; i < 3; i++) {
      await page.keyboard.press('r');
      await page.waitForTimeout(80);
      await page.mouse.move(box.x + 100 + i * 140, box.y + 100 + i * 40);
      await page.mouse.down();
      await page.mouse.move(box.x + 160 + i * 140, box.y + 160 + i * 40);
      await page.mouse.move(box.x + 220 + i * 140, box.y + 220 + i * 40);
      await page.mouse.up();
      await page.waitForTimeout(80);
    }
    await page.getByRole('treeitem').first().waitFor({ timeout: 8000 });
  });

  test.afterEach(async ({ page }) => {
    await expectNoCrashDialog(page);
    expect(errors, 'uncaught page errors during DnD').toEqual([]);
  });

  test('dragging a row above another reorders the tree', async ({ page }) => {
    const names = await rowNames(page);
    expect(names.length).toBeGreaterThanOrEqual(3);
    // Panel shows front-most first: last created ("Rectangle 3") on top.
    const lastName = names[names.length - 1];
    const firstName = names[0];
    if (!lastName || !firstName) throw new Error('missing row names');

    await dragRowToRow(page, lastName, firstName, -0.35, 'layers-dnd-visual-before');
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    expect(after[0]).toBe(lastName);
  });

  test('dragging a row below another shows the after target and reorders the tree', async ({
    page,
  }) => {
    const names = await rowNames(page);
    const firstName = names[0];
    const secondName = names[1];
    if (!firstName || !secondName) throw new Error('missing row names');

    await dragRowToRow(page, firstName, secondName, 0.35, 'layers-dnd-visual-after');
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    expect(after[1]).toBe(firstName);
  });

  test('dropping into a frame reparents the layer', async ({ page }) => {
    // Create an empty frame off to the side of the seeded shapes.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('f');
    await page.waitForTimeout(80);
    await page.mouse.move(box.x + 600, box.y + 480);
    await page.mouse.down();
    await page.mouse.move(box.x + 760, box.y + 600);
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');

    const frameRow = rowByName(page, 'Frame');
    await frameRow.waitFor({ timeout: 5000 });

    const rectBefore = rowByName(page, 'Rectangle');
    const levelBefore = await rectBefore.getAttribute('aria-level');

    await dragRowToRow(page, 'Rectangle', 'Frame', 0, 'layers-dnd-visual-into');
    await page.waitForTimeout(300);

    const namesAfter = await rowNames(page);
    const frameIdx = namesAfter.findIndex((n) => n.includes('Frame'));
    const rectIdx = namesAfter.findIndex((n) => n.includes('Rectangle'));
    expect(frameIdx).toBeGreaterThanOrEqual(0);
    expect(rectIdx).toBeGreaterThan(frameIdx);

    // Reparent must deepen the row's tree level exactly once.
    const levelAfter = await rowByName(page, 'Rectangle').getAttribute('aria-level');
    const before = Number(levelBefore ?? 1);
    const after = Number(levelAfter ?? 1);
    expect(after).toBe(before + 1);
  });

  test('multi-selection drag moves both rows together', async ({ page }) => {
    const names = await rowNames(page);
    expect(names.length).toBeGreaterThanOrEqual(3);
    const top = names[0];
    const second = names[1];
    const bottom = names[names.length - 1];
    if (!top || !second || !bottom) throw new Error('missing row names');

    await rowByName(page, top).click();
    await rowByName(page, second).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);

    await dragRowToRow(page, top, bottom, 0.35);
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    // Visual order is front-most-first: dragging [top, second] preserves that
    // stacking, so they land as [top, second] at the end.
    expect(after.slice(-2)).toEqual([top, second]);
  });

  test('escape-cancelled drag leaves order untouched and no stuck indicator', async ({ page }) => {
    const names = await rowNames(page);
    const firstName = names[0];
    const secondName = names[1];
    if (!firstName || !secondName) throw new Error('missing row names');

    const from = rowByName(page, firstName);
    const fromBox = await from.boundingBox();
    if (!fromBox) throw new Error('row not visible');
    const startX = fromBox.x + 8;
    const startY = fromBox.y + fromBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 12);
    const to = rowByName(page, secondName);
    const toBox = await to.boundingBox();
    if (!toBox) throw new Error('target row not visible');
    await page.mouse.move(toBox.x + toBox.width / 2, toBox.y + toBox.height / 2);
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await page.waitForTimeout(300);

    expect(await rowNames(page)).toEqual(names);
    const stuck = await page
      .locator('.layers-row--drop-before, .layers-row--drop-after, .layers-row--drop-into')
      .count();
    expect(stuck).toBe(0);
  });

  test('locked row cannot be reparented through the Layers panel', async ({ page }) => {
    const rows = page.getByRole('treeitem');
    const source = rows.nth(0);
    const before = await rowNames(page);
    await source.locator('[class*="toggle--locked-off"]').click();
    await dragRowToRow(page, before[0]!, before[1]!, 0.35, 'layers-dnd-visual-locked');
    expect(await rowNames(page)).toEqual(before);
  });

  test('locked row skips rename and delete but still toggles visibility', async ({ page }) => {
    const row = page.getByRole('treeitem').first();
    const originalName = (await row.locator('.layers-row__name').textContent())?.trim();
    if (!originalName) throw new Error('locked row name unavailable');
    await row.locator('[class*="toggle--locked-off"]').click();

    await row.click();
    await page.keyboard.press('F2');
    const renameInput = row.locator('input[aria-label^="Rename "]');
    await expect(renameInput).toBeVisible();
    await renameInput.fill('Should Not Rename');
    await renameInput.press('Enter');
    await expect(row.locator('.layers-row__name')).toHaveText(originalName);

    await row.click();
    await page.keyboard.press('Delete');
    await expect(page.getByRole('treeitem')).toHaveCount(3);

    const visibility = row.locator('.layers-row__toggle--visibility-on');
    await visibility.click();
    await expect(row).toHaveClass(/layers-row--hidden/);
    await row.locator('.layers-row__toggle--visibility-off').click();
    await expect(row).not.toHaveClass(/layers-row--hidden/);
  });

  test('auto-scrolls a virtualized tree while dragging at the panel edge', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('canvas not found');
    for (let i = 0; i < 40; i++) {
      await page.keyboard.press('r');
      await page.mouse.move(canvasBox.x + 80 + (i % 4) * 110, canvasBox.y + 80 + (i % 5) * 70);
      await page.mouse.down();
      await page.mouse.move(canvasBox.x + 120 + (i % 4) * 110, canvasBox.y + 120 + (i % 5) * 70);
      await page.mouse.up();
      await page.waitForTimeout(100);
    }
    await expect(page.getByText('43 layers', { exact: true })).toBeVisible({ timeout: 10000 });
    expect(await page.getByRole('treeitem').count()).toBeLessThan(43);
    const tree = page.getByRole('tree', { name: /layers/i });
    const source = page.getByRole('treeitem').first();
    const sourceBox = await source.boundingBox();
    const treeBox = await tree.boundingBox();
    if (!sourceBox || !treeBox) throw new Error('virtualized drag geometry unavailable');

    await page.mouse.move(sourceBox.x + 8, sourceBox.y + sourceBox.height / 2);
    await page.mouse.down();
    await page.mouse.move(sourceBox.x + 8, sourceBox.y + sourceBox.height / 2 - 12);
    for (let i = 0; i < 18; i++) {
      await page.mouse.move(treeBox.x + treeBox.width / 2, treeBox.y + treeBox.height - 4);
      await page.waitForTimeout(45);
    }
    expect(await tree.evaluate((el) => el.scrollTop)).toBeGreaterThan(0);
    await page
      .getByTestId('layers-panel')
      .screenshot({ path: 'test-results/layers-dnd-visual-autoscroll.png' });
    await page.mouse.up();
  });

  test('rejects a cycle with visible invalid feedback', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('f');
    await page.mouse.move(box.x + 600, box.y + 480);
    await page.mouse.down();
    await page.mouse.move(box.x + 760, box.y + 600);
    await page.mouse.up();
    await page.waitForTimeout(250);
    await page.keyboard.press('Escape');

    const frame = rowByName(page, 'Frame');
    await frame.waitFor({ timeout: 5000 });
    await dragRowToRow(page, 'Rectangle', 'Frame', 0);
    const child = rowByName(page, 'Rectangle');
    const before = await rowNames(page);
    await dragRowToRow(
      page,
      'Frame',
      'Rectangle',
      0,
      'layers-dnd-visual-invalid',
      'layers-row--drop-invalid',
    );
    expect(await rowNames(page)).toEqual(before);
    await expect(child).toHaveAttribute('aria-level', '2');
  });
});
