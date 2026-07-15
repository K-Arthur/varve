import type { Page } from '@playwright/test';

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

  // Dismiss "Welcome to Strata" modal on first launch. Choose Blank canvas
  // so the dialog actually closes; Get Started starts a tour instead.
  const blankCanvas = page.getByRole('dialog').getByRole('button', { name: /^Blank canvas$/i });
  if (await blankCanvas.isVisible({ timeout: 1000 }).catch(() => false)) {
    await blankCanvas.click();
  } else {
    const welcomeClose = page
      .getByRole('dialog')
      .getByRole('button', { name: /close|get started/i });
    if (
      await welcomeClose
        .first()
        .isVisible({ timeout: 1000 })
        .catch(() => false)
    ) {
      await welcomeClose.first().click();
    }
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
  // The editor mounts hidden thumbnail/offscreen canvases as features become
  // available. Target the owned artwork surface explicitly so engine-specific
  // DOM timing cannot select a zero-sized auxiliary canvas.
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 10_000 });
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
): Promise<NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>>;
export async function dragOnCanvas(
  page: Page,
  fromX: number,
  fromY: number,
  toX: number,
  toY: number,
): Promise<NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>>;
export async function dragOnCanvas(
  page: Page,
  fromOrX: { x: number; y: number } | number,
  toOrY: { x: number; y: number } | number,
  maybeToX?: number,
  maybeToY?: number,
) {
  const fromWorld = typeof fromOrX === 'number' ? { x: fromOrX, y: toOrY as number } : fromOrX;
  const toWorld =
    typeof fromOrX === 'number'
      ? { x: maybeToX as number, y: maybeToY as number }
      : (toOrY as { x: number; y: number });
  const coordinates = [fromWorld.x, fromWorld.y, toWorld.x, toWorld.y];
  if (!coordinates.every(Number.isFinite)) {
    throw new TypeError(`Canvas drag coordinates must be finite: ${coordinates.join(', ')}`);
  }

  // Hidden thumbnail/offscreen canvases may mount before the editor surface.
  // Always target the owned artwork layer so browser-specific DOM timing does
  // not select a zero-sized auxiliary canvas.
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 10_000 });
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
