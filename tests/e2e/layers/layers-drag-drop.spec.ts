import { expect, test, type Locator, type Page } from '@playwright/test';
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
  const visible = await crashDialog.first().isVisible({ timeout: 500 }).catch(() => false);
  if (visible) {
    const text = await crashDialog.first().innerText().catch(() => '<unreadable>');
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
  return page
    .locator('[role="treeitem"]')
    .filter({ hasText: name })
    .first();
}

/** Drag one row onto another with real pointer events. offsetFraction -0.35
 *  targets the before band, +0.35 the after band, 0 the into (middle) band. */
async function dragRowToRow(
  page: Page,
  fromName: string,
  toName: string,
  offsetFraction: number,
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

    await dragRowToRow(page, lastName, firstName, -0.35);
    await page.waitForTimeout(250);

    const after = await rowNames(page);
    expect(after[0]).toBe(lastName);
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

    await dragRowToRow(page, 'Rectangle', 'Frame', 0);
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

  test('escape-cancelled drag leaves order untouched and no stuck indicator', async ({
    page,
  }) => {
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
      .locator(
        '.layers-row--drop-before, .layers-row--drop-after, .layers-row--drop-into',
      )
      .count();
    expect(stuck).toBe(0);
  });
});
