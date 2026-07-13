import { type Page, expect } from '@playwright/test';

/**
 * Navigate from the home screen to the editor.
 * Shared across all E2E specs — fix one place, not 15.
 *
 * Sequence:
 *   / → [New] → dialog → [Create] → wait for .layers-panel → dismiss welcome
 */
export async function navigateToEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });

  // Dismiss "Welcome to Strata" modal on first launch.
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

/**
 * Navigate to the home screen and wait for it to render.
 */
export async function navigateToHome(page: Page) {
  await page.goto('/');
  await page.waitForSelector('.strata-home');
}

/**
 * Seed the canvas with `count` distinct rectangles so the layers tree is
 * populated.  Uses the Rect tool shortcut (r) + drag across the canvas.
 */
export async function seedLayers(page: Page, count: number) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  for (let i = 0; i < count; i++) {
    const x1 = 100 + i * 120;
    const y1 = 100 + i * 60;
    await page.keyboard.press('r');
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    await page.mouse.move(box.x + x1 + 40, box.y + y1 + 40);
    await page.mouse.move(box.x + x1 + 80, box.y + y1 + 80);
    await page.mouse.up();
  }
  await page.getByRole('treeitem').first().waitFor({ timeout: 5000 });
}

/**
 * Drag on the canvas at world-space coordinates (relative to the artboard
 * origin).  Intermediate midpoint ensures the 3px drag threshold is crossed.
 *
 * @returns the canvas bounding box at the time of the drag, for assertions.
 */
export async function dragOnCanvas(
  page: Page,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
) {
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  const sx = box.x + fromWorld.x;
  const sy = box.y + fromWorld.y;
  const ex = box.x + toWorld.x;
  const ey = box.y + toWorld.y;

  await page.mouse.move(sx, sy);
  await page.mouse.down();
  await page.mouse.move(Math.round((sx + ex) / 2), Math.round((sy + ey) / 2));
  await page.mouse.move(ex, ey);
  await page.mouse.up();

  return box;
}

/**
 * Wait for a dialog with the `[open]` attribute to be visible.
 * Always scope to `dialog[open]` — the app mounts all dialogs upfront and
 * toggles `open` rather than conditionally rendering them.
 */
export async function waitForOpenDialog(page: Page) {
  return page.locator('dialog[open]').waitFor({ state: 'visible', timeout: 5000 });
}

/**
 * Helper: click the sidebar navigation button with the given label text.
 */
export async function sidebarNavClick(page: Page, label: string) {
  await page
    .locator('nav[aria-label="File navigation"]')
    .getByRole('button', { name: new RegExp(label, 'i') })
    .click();
}

/**
 * Locate the artboard canvas element.  Used for shape creation and selection.
 */
export function canvasLocator(page: Page) {
  return page.locator('canvas').first();
}
