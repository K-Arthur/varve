import { expect, test } from '@playwright/test';

import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

async function waitForStableCanvas(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    delete (window as Window & { __allToolsCanvasStability?: unknown }).__allToolsCanvasStability;
  });
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector<HTMLCanvasElement>(selector);
      const context = canvas?.getContext('2d');
      if (!canvas || !context || canvas.width === 0 || canvas.height === 0) return false;

      // The content canvas is the rendered-state oracle: require both its CSS
      // geometry and bitmap to remain unchanged across animation frames before
      // taking the visual. A toolbar becoming visible is not proof that the
      // camera/layout and the final canvas frame have settled.
      const rect = canvas.getBoundingClientRect();
      const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
      let hash = 2166136261;
      for (let index = 0; index < pixels.length; index += 4) {
        hash = Math.imul(hash ^ pixels[index]!, 16777619);
        hash = Math.imul(hash ^ pixels[index + 1]!, 16777619);
        hash = Math.imul(hash ^ pixels[index + 2]!, 16777619);
      }
      const signature = [
        rect.x,
        rect.y,
        rect.width,
        rect.height,
        canvas.width,
        canvas.height,
        hash >>> 0,
      ].join(':');
      const target = window as Window & {
        __allToolsCanvasStability?: { signature: string; stableFrames: number };
      };
      if (!target.__allToolsCanvasStability) {
        target.__allToolsCanvasStability = { signature: '', stableFrames: 0 };
      }
      const state = target.__allToolsCanvasStability;
      if (state.signature === signature) state.stableFrames += 1;
      else {
        state.signature = signature;
        state.stableFrames = 0;
      }
      return state.stableFrames >= 3;
    },
    CONTENT_CANVAS,
    { polling: 'raf', timeout: 15000 },
  );
}

async function hideCanvasOverlays(page: import('@playwright/test').Page): Promise<void> {
  // Element screenshots include anything layered over the canvas rectangle.
  // Keep this all-tools image about rendered artwork, not transient selection,
  // hint, or contextual-toolbar placement.
  await page.addStyleTag({
    content: `
      .editor-canvas__grid-layer,
      .editor-canvas__pixel-grid,
      .editor-canvas__overlay-layer,
      .editor-canvas__color-blindness,
      .editor-canvas__zoom-indicator,
      .editor-canvas svg[role="presentation"],
      .micro-hint,
      .floating-toolbar,
      .floating-text-bar__layer,
      .selection-quick-bar,
      .selection-breadcrumb { visibility: hidden !important; }
    `,
  });
}

test.describe('Canvas visual regression', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToCleanEditor(page);
    // The shell can be visible before its first dock/camera measurement has
    // committed. Park the initial camera only after the content surface and
    // its layout/bitmap agree for several animation frames.
    await waitForStableCanvas(page);
  });

  test('all drawing tools render correctly on canvas', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await page.keyboard.press('o');
    await dragOnCanvas(page, 350, 100, 550, 250);
    await page.keyboard.press('f');
    // Stay outside the canvas auto-pan zone. The old y=500 endpoint was only
    // 23px from this 523px canvas edge (inside the 40px edge-scroll zone), so
    // variable animation-frame timing changed the camera by ~12px between
    // otherwise identical captures.
    await dragOnCanvas(page, 100, 280, 400, 420);
    await page.keyboard.press('t');
    // Text activation opens its settings popover. Close it before targeting
    // the canvas so the test doesn't type or click through the overlay.
    const textOptions = page.getByRole('dialog', { name: 'Text tool options', exact: true });
    if (await textOptions.isVisible().catch(() => false)) {
      await page.getByRole('button', { name: 'Tool options', exact: true }).click();
      await expect(textOptions).toHaveCount(0);
    }
    const hint = page.locator('.micro-hint');
    if (await hint.isVisible({ timeout: 1000 }).catch(() => false)) {
      // Dismiss the onboarding overlay before placing text so it cannot eat
      // the canvas click or change which contextual toolbar is captured.
      await hint
        .getByRole('button', { name: 'Dismiss hint' })
        .click({ timeout: 2000 })
        .catch(() => undefined);
      await expect(hint).toHaveCount(0, { timeout: 5000 });
    }
    const canvas = page.locator(CONTENT_CANVAS);
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.move(box.x + 430, box.y + 350);
    await page.mouse.down();
    await page.mouse.move(box.x + 580, box.y + 390);
    await page.mouse.up();
    const textToolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(textToolbar).toBeVisible();
    await page.keyboard.insertText('Varve');
    await page.keyboard.press('Escape');
    await expect(textToolbar).toBeHidden();
    await expect(page.getByRole('treeitem').filter({ hasText: /Varve/i })).toBeVisible();

    await hideCanvasOverlays(page);
    await waitForStableCanvas(page);
    await expect(canvas).toHaveScreenshot('all-tools-canvas.png', {
      animations: 'disabled',
      maxDiffPixels: 200,
    });
  });
});
