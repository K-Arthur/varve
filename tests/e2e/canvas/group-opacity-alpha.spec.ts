/**
 * Group opacity isolation — numerical browser regression.
 *
 * The mission-level contract (W3C Compositing and Blending Level 1 §8): a
 * group's opacity applies to the already-composited group surface, not to each
 * child independently. Two overlapping opaque shapes inside an isolated group
 * at opacity 0.5 therefore have the SAME alpha (0.5) in the singly covered and
 * doubly covered regions. Multiplying child opacity instead produces 0.75
 * (191/255) in the overlap, which is the classic "group opacity looks wrong"
 * bug users complain about across design tools.
 *
 * This runs against the real CanvasArea replay path in Chromium and reads the
 * actual Canvas2D pixels, because the vitest jsdom canvas is a no-op mock.
 */
import { expect, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';
import { dragOnCanvas } from '../shared';

const CANVAS = 'canvas.editor-canvas__content-layer';
const EVIDENCE_DIR = 'reports/layer-fidelity';

interface EditorContextHandle {
  groupSelected?: () => unknown;
  setSelectedFill?: (color: unknown) => unknown;
}

/**
 * Find the live editor context. Discriminates on `groupSelected` (the command
 * surface), not on the persistence object: several mounted values expose
 * `serializeDocument`, and picking a stale one silently no-ops edits.
 */
async function callEditor(
  page: import('@playwright/test').Page,
  method: keyof EditorContextHandle,
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
      const fn = context?.[method] as ((...values: unknown[]) => unknown) | undefined;
      return typeof fn === 'function' ? fn(...(args as unknown[])) : null;
    },
    { method, args },
  );
}

/**
 * Patch a node directly by id through the editor's `updateNode`. Avoids
 * depending on which context object the fiber walk reaches or on selection
 * having flushed, both of which made the opacity step race-prone.
 */
async function updateNode(
  page: import('@playwright/test').Page,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const updated = await page.evaluate(
    ({ nodeId, patch }) => {
      const root = document.getElementById('root');
      if (!root) return false;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return false;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'updateNode' in value) {
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
      const update = context?.updateNode as
        | ((
            id: string,
            updater: (node: Record<string, unknown>) => Record<string, unknown>,
          ) => void)
        | undefined;
      if (typeof update !== 'function') return false;
      update(nodeId, (node) => ({ ...node, ...patch }));
      return true;
    },
    { nodeId, patch },
  );
  expect(updated).toBe(true);
}

/** Read canvas-backing-store pixels at canvas-relative CSS points. */
async function samplePixels(
  page: import('@playwright/test').Page,
  points: ReadonlyArray<readonly [number, number]>,
): Promise<number[][]> {
  return page.evaluate(
    ({ selector, points: samplePoints }) => {
      const canvas = document.querySelector(selector) as HTMLCanvasElement | null;
      if (!canvas) throw new Error('content canvas missing');
      const ctx = canvas.getContext('2d');
      if (!ctx) throw new Error('2d context missing');
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / rect.width;
      const scaleY = canvas.height / rect.height;
      return samplePoints.map(([x, y]) => {
        const data = ctx.getImageData(Math.round(x * scaleX), Math.round(y * scaleY), 1, 1).data;
        return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
      });
    },
    { selector: CANVAS, points },
  );
}

/** Poll until at least one sampled point has painted pixels. */
async function waitForPaint(
  page: import('@playwright/test').Page,
  points: ReadonlyArray<readonly [number, number]>,
  timeoutMs = 30000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pixels = await samplePixels(page, points);
    if (pixels.some((pixel) => (pixel[3] ?? 0) > 0)) return;
    await page.waitForTimeout(250);
  }
}

/**
 * Poll until the sampled pixels differ from `baseline`. Canvas repaints are
 * asynchronous (worker bitmap promotion, rAF scheduling), and a fixed delay
 * sampled the pre-update frame under load.
 */
async function waitForPaintChange(
  page: import('@playwright/test').Page,
  points: ReadonlyArray<readonly [number, number]>,
  baseline: number[][],
  timeoutMs = 30000,
): Promise<void> {
  const deadline = Date.now() + timeoutMs;
  while (Date.now() < deadline) {
    const pixels = await samplePixels(page, points);
    const changed = pixels.some((pixel, index) => {
      const base = baseline[index];
      return !(
        base &&
        pixel.length === base.length &&
        pixel.every((value, channel) => value === (base[channel] ?? 0))
      );
    });
    if (changed) return;
    await page.waitForTimeout(250);
  }
}

test.describe('group opacity isolation', () => {
  test('overlapping shapes keep one group alpha in single and double coverage', async ({
    page,
  }) => {
    await navigateToCleanEditor(page);

    // Two opaque rectangles overlapping in [160,280] x [140,220].
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 280, 220);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 140, 340, 260);
    await page.keyboard.press('v');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    const points = [
      [120, 130],
      [200, 180],
      [300, 240],
    ] as const;

    await waitForPaint(page, points);
    // Baseline before grouping/opacity: fully opaque coverage.
    const before = await samplePixels(page, points);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();

    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    const groupId = await group.getAttribute('data-node-id');
    expect(groupId).toBeTruthy();
    await updateNode(page, groupId!, { opacity: 0.5 });
    await waitForPaintChange(page, points, before);

    const [onlyA, overlap, onlyB] = await samplePixels(page, points);

    const alphaOf = (pixel: number[] | undefined) => pixel?.[3] ?? -1;
    const channelClose = (a: number[] | undefined, b: number[] | undefined, tol: number) =>
      a && b && a.every((value, i) => Math.abs(value - (b[i] ?? 0)) <= tol);

    const singleAlpha = alphaOf(onlyA);
    const overlapAlpha = alphaOf(overlap);

    // 0) The authored opacity must actually have applied. Without this guard a
    // fully opaque frame would make "single equals overlap" trivially true.
    for (let i = 0; i < points.length; i += 1) {
      expect(channelClose(before[i], [onlyA, overlap, onlyB][i], 0)).toBe(false);
    }

    // Guard against sampling empty canvas (would make all values equal 0).
    expect(singleAlpha).toBeGreaterThan(0);
    expect(overlapAlpha).toBeGreaterThan(0);

    // 1) Group opacity must not compound in the overlap: 0.75*255 = 191.
    expect(Math.abs(overlapAlpha - 191)).toBeGreaterThan(10);
    expect(Math.abs(alphaOf(onlyB) - 191)).toBeGreaterThan(10);

    // 2) Every covered region has the same composited group alpha/color.
    expect(Math.abs(overlapAlpha - singleAlpha)).toBeLessThanOrEqual(3);
    expect(Math.abs(alphaOf(onlyB) - singleAlpha)).toBeLessThanOrEqual(3);
    for (let channel = 0; channel < 4; channel += 1) {
      expect(Math.abs((overlap?.[channel] ?? 0) - (onlyA?.[channel] ?? 0))).toBeLessThanOrEqual(3);
    }

    // 3) On a transparent page the alpha is the authored 0.5 (± rounding).
    if (singleAlpha < 250) {
      expect(Math.abs(singleAlpha - 128)).toBeLessThanOrEqual(6);
    }

    await page.locator(CANVAS).screenshot({
      path: `${EVIDENCE_DIR}/group-opacity-alpha.png`,
    });
  });

  test('group opacity stays isolated over a colored backdrop', async ({ page }) => {
    await navigateToCleanEditor(page);

    // Opaque backdrop rectangle first, recolored so isolation is observable
    // against a different backdrop (all shapes otherwise share one default
    // fill, which makes a compounded group look identical).
    await page.keyboard.press('r');
    await dragOnCanvas(page, 80, 80, 380, 300);
    expect(
      await callEditor(page, 'setSelectedFill', { space: 'rgb', r: 30, g: 60, b: 200, a: 255 }),
    ).not.toBeNull();
    // Two overlapping group members.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 120, 120, 260, 220);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 160, 320, 260);
    await page.keyboard.press('v');
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10000 });

    const points = [
      [95, 95],
      [140, 150],
      [210, 190],
      [300, 240],
    ] as const;
    await waitForPaint(page, points);
    const before = await samplePixels(page, points);
    // The backdrop recolor must have landed (blue channel above red).
    expect(before[0]?.[2] ?? 0).toBeGreaterThan(before[0]?.[0] ?? 255);

    const rows = page.getByRole('treeitem');
    // Layers list top-first: rows 0 and 1 are the two foreground rects, the
    // backdrop is the bottom row and must stay outside the group.
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    expect(await callEditor(page, 'groupSelected')).not.toBeNull();
    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    const groupId = await group.getAttribute('data-node-id');
    expect(groupId).toBeTruthy();
    await updateNode(page, groupId!, { opacity: 0.5 });
    await waitForPaintChange(page, points, before);
    const [backdropOnly, onlyA, overlap, onlyB] = await samplePixels(page, points);

    const channelClose = (a: number[] | undefined, b: number[] | undefined, tol: number) =>
      a && b && a.every((value, i) => Math.abs(value - (b[i] ?? 0)) <= tol);

    // Opacity applied: the foreground no longer matches its pre-group color,
    // and differs from the untouched backdrop.
    expect(channelClose(before[1], onlyA, 0)).toBe(false);
    expect(channelClose(backdropOnly, onlyA, 0)).toBe(false);
    // Isolation over the colored backdrop: single and double coverage match.
    expect(channelClose(onlyA, overlap, 3)).toBe(true);
    expect(channelClose(onlyA, onlyB, 3)).toBe(true);

    await page.locator(CANVAS).screenshot({
      path: `${EVIDENCE_DIR}/group-opacity-colored-backdrop.png`,
    });
  });
});
