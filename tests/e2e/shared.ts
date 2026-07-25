import type { Page } from '@playwright/test';

/**
 * Navigate from the home screen to the editor.
 * Shared across all E2E specs — fix one place, not 15.
 *
 * Sequence:
 *   / → [New] → dialog → [Create] → wait for .layers-panel → dismiss welcome
 */
export async function navigateToEditor(page: Page) {
  // Generous timeouts: under heavy concurrent dev-server load (many watched
  // files recompiling at once), first paint can take much longer than a
  // quiet dev server without indicating any real problem.
  await page.goto('/', { timeout: 45000, waitUntil: 'domcontentloaded' });
  const newBtn = page.getByRole('button', { name: /^new$/i });
  await newBtn.waitFor({ state: 'visible', timeout: 45000 });
  await newBtn.click({ force: true, timeout: 15000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create$/i })
    .click({ timeout: 10000 });
  await page.locator('.layers-panel').waitFor({ timeout: 15000 });

  // Dismiss "Welcome to Strata" modal on first launch
  const blankCanvas = page.getByRole('dialog').getByRole('button', { name: /^blank canvas$/i });
  if (await blankCanvas.isVisible({ timeout: 1000 }).catch(() => false)) {
    await blankCanvas.click({ timeout: 5000 });
  } else {
    const close = page
      .getByRole('dialog')
      .getByRole('button', { name: /close|get started/i })
      .first();
    if (await close.isVisible({ timeout: 1000 }).catch(() => false)) {
      await close.click({ timeout: 5000 });
    }
  }

  // Dismiss the in-editor onboarding checklist panel if present.
  const dismiss = page.locator('.onboarding-checklist__dismiss');
  if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
    await dismiss.click({ timeout: 5000 });
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
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  for (let i = 0; i < count; i++) {
    const x1 = 100 + i * 120;
    const y1 = 100 + i * 60;
    await page.keyboard.press('r');
    await page.waitForTimeout(100);
    // Move to start, then drag step by step crossing the 3px threshold
    await page.mouse.move(box.x + x1, box.y + y1);
    await page.mouse.down();
    // Move in two stages to cross the 3px drag threshold without
    // the overhead of steps= events that can trigger PointerEvent
    // coalescing backpressure under parallel workers.
    await page.mouse.move(box.x + x1 + 40, box.y + y1 + 40);
    await page.mouse.move(box.x + x1 + 80, box.y + y1 + 80);
    await page.mouse.up();
    await page.waitForTimeout(100);
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
  // Use 'attached' not 'visible' — the canvas may render off-screen after
  // extreme pan (floating-origin test pans -900px in both axes). As long as
  // it exists in the DOM we can compute screen-space coordinates from its
  // bounding box.
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) {
    // Fallback: try the any-visible-canvas strategy for panned views
    const anyCanvas = page.locator('canvas').first();
    const fallbackBox = await anyCanvas.boundingBox();
    if (!fallbackBox) throw new Error('canvas not found');
    return dragOnCanvasFallback(page, fallbackBox, fromWorld, toWorld);
  }

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
 * Fallback drag helper used when the primary canvas has no bounding box
 * (e.g. after extreme pan).  Uses any available canvas and its bounding
 * box to compute screen coordinates.
 */
async function dragOnCanvasFallback(
  page: Page,
  box: NonNullable<Awaited<ReturnType<ReturnType<Page['locator']>['boundingBox']>>>,
  fromWorld: { x: number; y: number },
  toWorld: { x: number; y: number },
) {
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
