/**
 * Numeric field integrity — real-photo interaction coverage.
 *
 * Uses a licensed real photograph (tests/e2e/fixtures/real-life-still-life.jpg)
 * because the numeric edit path touches image-node geometry, and the master
 * brief requires real-world scenarios rather than synthetic shape fixtures.
 *
 * Evidence for docs/research/numeric-input-interaction-research-2026-09-14.md:
 * - NF-1 wheel must step a focused field without scrolling the inspector
 * - NF-2 modifier changes mid-drag must not rescale earlier travel
 * - NF-4 Escape must cancel an in-progress scrub
 * - NF-6 a completed scrub is one undoable step, and cancel creates none
 */
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

const REAL_PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');

async function importRealPhoto(page: Page): Promise<void> {
  await page.locator('#file-import-input').setInputFiles(REAL_PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
}

function inspectorPanel(page: Page): Locator {
  return page.locator('.editor__inspector-panel');
}

function inspectorScroller(page: Page): Locator {
  return page.locator('.editor-inspector > .insp-panel');
}

/** Position & Size owns the editable X; Image Placement has a disabled X too. */
function positionSizeGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Position & Size' });
}

function xField(page: Page): Locator {
  return positionSizeGroup(page).getByLabel('X (px)');
}

function xLabel(page: Page): Locator {
  return positionSizeGroup(page).locator('label.insp-field__label', { hasText: 'X (px)' });
}

async function readValue(field: Locator): Promise<number> {
  return Number.parseFloat(await field.inputValue());
}

// Real-photo imports and model-free imaging work make first navigation
// expensive; the shared dev-server warm-up occasionally exceeds the 60s
// canvas wait under concurrent heavy tasks. One retry absorbs that without
// masking a product failure (the assertions still run on every attempt).
test.describe.configure({ retries: 1 });

test.describe('Inspector numeric field integrity (real photo)', () => {
  test('wheel over the focused X field steps the value without scrolling the inspector', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1180, height: 600 });
    await navigateToEditor(page);
    await importRealPhoto(page);

    const field = xField(page);
    await expect(field).toBeVisible();
    const scroller = inspectorScroller(page);
    await expect(scroller).toBeVisible();

    // The inspector must offer a scrollable region for this test to mean
    // anything: an image selection renders many sections.
    const scrollable = await scroller.evaluate((el) => el.scrollHeight > el.clientHeight + 20);
    expect(scrollable).toBe(true);

    await scroller.evaluate((el) => {
      el.scrollTop = 60;
    });
    const scrollBefore = await scroller.evaluate((el) => el.scrollTop);
    const before = await readValue(field);

    await field.click();
    await expect(field).toBeFocused();
    await field.hover();

    // Deterministic regression signal: a cancelable wheel event over the
    // focused field must be default-prevented by a non-passive listener
    // (React's delegated wheel listener is passive, so pre-fix this returns
    // true and the panel scrolls out from under the pointer).
    const prevented = await field.evaluate(
      (el) =>
        !el.dispatchEvent(
          new WheelEvent('wheel', { deltaY: -120, bubbles: true, cancelable: true }),
        ),
    );
    expect(prevented, 'wheel-to-step must prevent the browser default scroll').toBe(true);

    await page.mouse.wheel(0, -400);

    await expect.poll(async () => readValue(field), { timeout: 5000 }).not.toBe(before);
    const after = await readValue(field);
    expect(after).toBeGreaterThan(before);

    const scrollAfter = await scroller.evaluate((el) => el.scrollTop);
    expect(scrollAfter, 'wheel-to-step must not also scroll the inspector').toBe(scrollBefore);
  });

  test('a modifier pressed mid-drag does not rescale earlier travel', async ({ page }) => {
    await navigateToEditor(page);
    await importRealPhoto(page);

    const field = xField(page);
    const label = xLabel(page);
    await expect(field).toBeVisible();
    const start = await readValue(field);
    const box = await label.boundingBox();
    expect(box).not.toBeNull();

    // 10 CSS px at x1, then Shift, then 10 CSS px at x10 (shiftStep) → +110.
    await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 20, box!.y + box!.height / 2);
    await page.keyboard.down('Shift');
    await page.mouse.move(box!.x + 30, box!.y + box!.height / 2);
    await page.mouse.up();
    await page.keyboard.up('Shift');

    expect(await readValue(field)).toBe(start + 110);
  });

  test('Escape cancels an in-progress scrub and restores the starting value', async ({ page }) => {
    await navigateToEditor(page);
    await importRealPhoto(page);

    const field = xField(page);
    const label = xLabel(page);
    await expect(field).toBeVisible();
    const start = await readValue(field);
    const box = await label.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 40, box!.y + box!.height / 2, { steps: 5 });
    expect(await readValue(field)).not.toBe(start);
    await page.keyboard.press('Escape');
    await page.mouse.up();

    expect(await readValue(field)).toBe(start);
  });

  test('a completed scrub is exactly one undo step', async ({ page }) => {
    await navigateToEditor(page);
    await importRealPhoto(page);

    const field = xField(page);
    const label = xLabel(page);
    await expect(field).toBeVisible();
    const start = await readValue(field);
    const box = await label.boundingBox();
    expect(box).not.toBeNull();

    await page.mouse.move(box!.x + 10, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + 50, box!.y + box!.height / 2, { steps: 5 });
    await page.mouse.up();
    const moved = await readValue(field);
    expect(moved).not.toBe(start);

    // Use the real command surface: the Edit menu's Undo must be enabled by
    // the completed gesture and restore the starting value in one step.
    await openMenu(page, 'Edit');
    const undoItem = page.getByRole('menuitem', { name: /^Undo/ });
    await expect(undoItem).toBeEnabled();
    await undoItem.click();

    await expect.poll(async () => readValue(field), { timeout: 5000 }).toBe(start);
  });

  test('visual states for the numeric field on a real photo', async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1180, height: 800 });
    await navigateToEditor(page);
    await importRealPhoto(page);

    const inspector = inspectorPanel(page);
    await expect(xField(page)).toBeVisible();
    // Durable review artifacts (reports/ is gitignored), mirroring the
    // masking-system convention; testInfo paths are cleared on green runs.
    const reviewDir = 'reports/numeric-field-review';

    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((nextTheme) => {
        document.documentElement.setAttribute('data-theme', nextTheme);
      }, theme);
      await inspector.screenshot({ path: testInfo.outputPath(`numeric-${theme}.png`) });
      await inspector.screenshot({ path: `${reviewDir}/numeric-${theme}.png` });
    }

    await page.evaluate(() => {
      document.documentElement.setAttribute('data-theme', 'dark');
    });
    const field = xField(page);
    await field.click();
    await expect(field).toBeFocused();
    await field.screenshot({ path: testInfo.outputPath('numeric-focused-dark.png') });
    await field.screenshot({ path: `${reviewDir}/numeric-focused-dark.png` });

    // Deterministic mixed-value state: two photos with different X values.
    await field.fill('100');
    await page.keyboard.press('Enter');
    await page.locator('#file-import-input').setInputFiles(REAL_PHOTO);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 15000 });
    const secondX = positionSizeGroup(page).getByLabel('X (px)');
    await secondX.fill('200');
    await page.keyboard.press('Enter');
    await page.evaluate(() => (document.activeElement as HTMLElement)?.blur?.());
    await page.keyboard.press('Control+a');
    await expect(secondX).toHaveAttribute('aria-valuetext', 'Mixed values', { timeout: 5000 });
    await inspector.screenshot({ path: `${reviewDir}/numeric-mixed-dark.png` });
  });
});
