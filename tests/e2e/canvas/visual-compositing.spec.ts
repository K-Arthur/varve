/**
 * Full-editor visual coverage for the orchestration layer above replayIr.
 *
 * The replay visual harness intentionally stays flat. These tests exercise
 * the real CanvasArea/replaySubtreeToCtx path so group isolation, container
 * opacity, and structural clipping cannot regress while the primitive replay
 * snapshots remain green.
 */
import { expect, test } from '@playwright/test';
import { dropImageOnCanvas } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

const CANVAS = 'canvas.editor-canvas__content-layer';

async function createRect(
  page: import('@playwright/test').Page,
  x: number,
  y: number,
  w: number,
  h: number,
): Promise<void> {
  await page.keyboard.press('r');
  await dragOnCanvas(page, x, y, x + w, y + h);
  await page.keyboard.press('v');
}

async function waitForArtwork(page: import('@playwright/test').Page): Promise<void> {
  await page.waitForFunction(
    (selector) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas || canvas.width === 0 || canvas.height === 0) return false;
      const ctx = canvas.getContext('2d');
      if (!ctx) return false;
      const pixels = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      for (let i = 0; i < pixels.length; i += 4) {
        if (pixels[i] !== 255 || pixels[i + 1] !== 255 || pixels[i + 2] !== 255) return true;
      }
      return false;
    },
    CANVAS,
    { timeout: 15000 },
  );
}

async function hideEditorChromeForCanvasCapture(
  page: import('@playwright/test').Page,
): Promise<void> {
  // Playwright element screenshots capture the canvas' page rectangle. The
  // production selection overlay, floating toolbar, and contextual hint can
  // overlap that rectangle without being pixels in the content canvas. Hide
  // only those presentation layers so this assertion is about compositor
  // output; the layers-panel screenshot below still covers the user-visible
  // hierarchy and selection state.
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
      .selection-breadcrumb { visibility: hidden !important; }
    `,
  });
}

async function callEditor(
  page: import('@playwright/test').Page,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ method, args }) => {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return null;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'serializeDocument' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const fn = context?.[method] as ((...values: unknown[]) => unknown) | undefined;
      return typeof fn === 'function' ? fn(...(args as unknown[])) : null;
    },
    { method, args },
  );
}

test.describe('full-editor visual compositing', () => {
  test.describe.configure({ mode: 'serial' });

  test('nested groups preserve isolated opacity and container compositing', async ({ page }) => {
    await navigateToCleanEditor(page);

    // Overlap the three shapes so group opacity is observable as one isolated
    // surface instead of three independent child alpha operations.
    await createRect(page, 100, 100, 180, 120);
    await createRect(page, 160, 140, 180, 120);
    await createRect(page, 220, 180, 180, 120);
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10000 });

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await expect(group).toBeVisible();

    // Select the new group and the remaining top-level rectangle, then group
    // again. This creates the nested container path that the flat harness
    // cannot represent.
    await group.click();
    await page
      .getByRole('treeitem')
      .filter({ hasText: /^Rectangle\b/ })
      .last()
      .click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    const outerGroup = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await expect(outerGroup).toBeVisible();
    await outerGroup.click();
    expect(await callEditor(page, 'setSelectedOpacity', 0.72)).not.toBeNull();

    await waitForArtwork(page);
    await hideEditorChromeForCanvasCapture(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveScreenshot('nested-groups-isolated-opacity.png', {
      maxDiffPixels: 350,
    });
    await expect(page.getByTestId('layers-panel')).toHaveScreenshot(
      'nested-groups-layer-tree.png',
      {
        maxDiffPixels: 180,
      },
    );
  });

  test('clip mask is visible in the real canvas and layer hierarchy', async ({ page }) => {
    await navigateToCleanEditor(page);
    await dropImageOnCanvas(page, 'photo-fixture.jpg', 380, 120);
    await createRect(page, 100, 100, 260, 240);
    await page.keyboard.press('Control+a');
    await page.keyboard.press('Control+7');
    await expect(page.getByRole('treeitem').filter({ hasText: /clip/i }).first()).toBeVisible({
      timeout: 10000,
    });
    await waitForArtwork(page);

    await hideEditorChromeForCanvasCapture(page);
    const canvas = page.locator(CANVAS);
    await expect(canvas).toHaveScreenshot('clip-mask-canvas-output.png', {
      maxDiffPixels: 650,
    });
    await expect(page.getByTestId('layers-panel')).toHaveScreenshot(
      'clip-mask-layer-hierarchy.png',
      {
        maxDiffPixels: 220,
      },
    );
  });
});
