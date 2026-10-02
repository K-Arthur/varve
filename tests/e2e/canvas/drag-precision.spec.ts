/**
 * Drag precision + auto-pan E2E.
 *
 * Covers the batched multi-node move path (one document update per sample)
 * and the edge auto-pan invariant: while the camera moves under a held
 * pointer, the dragged object must keep following the pointer (no jump, no
 * drift) — the object/world delta must stay locked to the input.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

interface SelectionRect {
  x: number;
  y: number;
  width: number;
  height: number;
}

interface EditorContextHandle {
  groupSelected?: () => unknown;
}

async function callEditor(
  page: import('@playwright/test').Page,
  method: keyof EditorContextHandle,
): Promise<unknown> {
  return page.evaluate((method) => {
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
        if (value && typeof value === 'object' && 'groupSelected' in value) {
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
    const fn = context?.[method] as (() => unknown) | undefined;
    return typeof fn === 'function' ? fn() : null;
  }, method);
}

async function selectionRect(page: import('@playwright/test').Page): Promise<SelectionRect> {
  const overlay = page.locator('svg:has(filter#selection-glow)');
  const rect = overlay.locator('rect').first();
  await expect(rect).toBeVisible();
  return rect.evaluate((element) => {
    const selection = element as SVGRectElement;
    return {
      x: selection.x.baseVal.value,
      y: selection.y.baseVal.value,
      width: selection.width.baseVal.value,
      height: selection.height.baseVal.value,
    };
  });
}

async function selectionClientRect(page: import('@playwright/test').Page): Promise<SelectionRect> {
  const overlay = page.locator('svg:has(filter#selection-glow)');
  const rect = overlay.locator('rect').first();
  await expect(rect).toBeVisible();
  return rect.evaluate((element) => {
    const bounds = element.getBoundingClientRect();
    return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
  });
}

/** Create a rect via the r-tool drag, then return to the select tool. */
async function createRect(
  page: import('@playwright/test').Page,
  canvasBox: { x: number; y: number; width: number; height: number },
  x: number,
  y: number,
  w: number,
  h: number,
) {
  await page.keyboard.press('r');
  await page.mouse.move(canvasBox.x + x, canvasBox.y + y);
  await page.mouse.down();
  await page.mouse.move(canvasBox.x + x + w / 2, canvasBox.y + y + h / 2);
  await page.mouse.move(canvasBox.x + x + w, canvasBox.y + y + h);
  await page.mouse.up();
  await page.keyboard.press('v');
}

test.describe('drag precision', () => {
  test('dragging a selected group moves all of its contents as one object', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 120, 140, 80, 60);
    await createRect(page, canvasBox, 260, 140, 80, 60);
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(2);
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    await expect(
      page
        .getByRole('treeitem')
        .filter({ hasText: /^Group\b/ })
        .first(),
    ).toBeVisible();

    const before = await selectionRect(page);
    expect(before.width).toBeGreaterThan(150);
    await page.waitForTimeout(50);

    // Grab the first child while the group is selected. A drag should retain
    // the group selection and translate its complete bounding box.
    await dragOnCanvas(page, 160, 170, 220, 210);

    const after = await selectionRect(page);
    expect(after.x).toBeGreaterThan(before.x);
    expect(after.y).toBeGreaterThan(before.y);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
  });

  test('multi-select drag moves every node by the exact pointer delta', async ({ page }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 120, 140, 80, 60);
    await createRect(page, canvasBox, 260, 140, 80, 60);
    await expect(page.getByRole('treeitem')).toHaveCount(2);

    // Click rect A, then shift-click rect B to select both.
    await page.mouse.move(canvasBox.x + 160, canvasBox.y + 170);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.down('Shift');
    await page.mouse.move(canvasBox.x + 300, canvasBox.y + 170);
    await page.mouse.down();
    await page.mouse.up();
    await page.keyboard.up('Shift');

    const before = await selectionRect(page);
    // Both rects selected: the union box is wider than either rect alone.
    expect(before.width).toBeGreaterThan(150);

    // Ensure stateRef.current (used by buildToolCtx → canvasToWorld) reflects
    // the committed selection. The SVG overlay reads React state directly, but
    // the tool context reads stateRef which is only updated during render.
    // Without this wait, a race between setState and the next pointer event
    // can cause the drag to see a stale selection.
    await page.waitForTimeout(50);

    // Drag the selection by (60, 40) with Ctrl held to bypass snapping so
    // the final position is pointer-exact. Grab rect A's centre.
    await page.keyboard.down('Control');
    await dragOnCanvas(page, 160, 170, 220, 210);
    await page.keyboard.up('Control');

    const after = await selectionRect(page);
    expect(after.x - before.x).toBeCloseTo(60, 0);
    expect(after.y - before.y).toBeCloseTo(40, 0);
    expect(after.width).toBeCloseTo(before.width, 0);
    expect(after.height).toBeCloseTo(before.height, 0);
  });

  test('auto-pan near the canvas edge keeps the dragged object locked to the pointer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1280, height: 800 });
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('content canvas not found');

    await createRect(page, canvasBox, 200, 200, 80, 60);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // The camera reference: the minimap's viewport indicator. When the main
    // camera pans, the indicator moves, so the minimap canvas content shifts.
    // Color-agnostic (the accent differs per theme): compare sampled pixels.
    const minimapSignature = async () => {
      const minimap = page.locator('canvas.minimap-panel__canvas');
      await minimap.waitFor({ state: 'attached', timeout: 5000 });
      return minimap.evaluate((element) => {
        const surface = element as HTMLCanvasElement;
        const ctx = surface.getContext('2d');
        if (!ctx) return '';
        const img = ctx.getImageData(0, 0, surface.width, surface.height).data;
        const out: number[] = [];
        for (let i = 0; i < img.length; i += 8) out.push(img[i] ?? 0);
        return out.join(',');
      });
    };
    const diffCount = (a: string, b: string) => {
      const aa = a.split(',');
      const bb = b.split(',');
      let n = 0;
      for (let i = 0; i < Math.min(aa.length, bb.length); i++) {
        if (aa[i] !== bb[i]) n++;
      }
      return n;
    };

    const signatureBefore = await minimapSignature();

    // Fit-to-page offsets the world origin, so resolve the real rendered
    // selection bounds instead of assuming world coordinates equal CSS px.
    const initial = await selectionClientRect(page);
    const startX = initial.x + initial.width / 2;
    const startY = initial.y + initial.height / 2;
    const edgeY = canvasBox.y + canvasBox.height - 12;
    // Hold Control so grid snapping does not move the object away from the
    // pointer; this test isolates camera auto-pan pointer lock.
    await page.keyboard.down('Control');
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, edgeY, { steps: 6 });
    await page.waitForTimeout(900);

    // The dragged object stayed locked under the held pointer: its selection
    // box centre matches the pointer's screen position within a few px (the
    // per-tick camera staleness residual; pre-fix this drifted 15-20px).
    const during = await selectionClientRect(page);
    expect(Math.abs(during.y + during.height / 2 - edgeY)).toBeLessThanOrEqual(6);

    await page.mouse.up();
    await page.keyboard.up('Control');
    await page.waitForTimeout(150);
    // Minimap is driven by committed editor camera state, while auto-pan uses
    // a preview camera during the held drag. Compare after pointer-up commits
    // that preview; the selection-box assertion above covers live pointer lock.
    const signatureAfter = await minimapSignature();
    expect(diffCount(signatureBefore, signatureAfter)).toBeGreaterThan(20);
    const after = await selectionClientRect(page);
    // Release may settle a fractional camera tick, but must not cause a
    // visible jump. The active-drag assertion above remains the tighter
    // pointer-lock proof; two CSS px is below the handle's visual footprint.
    expect(
      Math.abs(after.y + after.height / 2 - (during.y + during.height / 2)),
    ).toBeLessThanOrEqual(2);
  });
});
