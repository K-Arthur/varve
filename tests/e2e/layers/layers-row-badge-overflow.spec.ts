/**
 * A layer row can carry many simultaneous, independently-optional badges: a
 * color tag, a blend-mode/opacity chip, a Layer Effects count, an Object
 * Filter chip, and a mask indicator are all real, ordinary combinations on
 * one decorated layer (e.g. a treated hero image). Every one of those
 * elements was `flex-shrink: 0` in `.layers-row`, and the row itself never
 * wraps — so once their combined width exceeded the row, the always-needed
 * visibility/lock/solo toggles at the row's end were pushed past the panel's
 * right edge and clipped by the tree's `overflow-x: hidden`, making them
 * impossible to click. The Layers panel's minimum supported width (180px,
 * `PANEL_LIMITS.layers.min` in PanelResizeHandle.tsx) reaches this case with
 * a realistic, not pathological, set of badges.
 *
 * Fix: the secondary badges (everything between the name and the toggles)
 * are wrapped in `.layers-row__badges`, a flex item with a very high
 * shrink factor that clips its own overflow — it gives up its width (and
 * visually truncates its own badges) before the toggles are displaced.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

/**
 * Mutate the first seeded node directly through the real EditorContext
 * (found via the React fiber tree, matching the established pattern in
 * layer-workflows.spec.ts) so the row carries a realistic, dense badge set
 * without scripting every Inspector flow that produces each one.
 */
async function decorateNodeWithBadges(page: import('@playwright/test').Page, nodeId: string) {
  return page.evaluate((nodeId) => {
    const container = document.getElementById('root');
    if (!container) return false;
    const fiberKey = Object.keys(container).find(
      (k) => k.startsWith('__reactFiber$') || k.startsWith('__reactContainer$'),
    );
    if (!fiberKey) return false;
    function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
      if (!fiber) return null;
      for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
        const p = props as Record<string, unknown> | undefined;
        if (
          p?.value &&
          typeof p.value === 'object' &&
          'serializeDocument' in (p.value as Record<string, unknown>)
        ) {
          return p.value as Record<string, unknown>;
        }
      }
      return (
        walk(fiber.child as Record<string, unknown> | null) ||
        walk(fiber.sibling as Record<string, unknown> | null)
      );
    }
    const ctx = walk(
      (container as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown> | null,
    );
    const updateNode = ctx?.updateNode as
      | ((id: string, updater: (n: Record<string, unknown>) => Record<string, unknown>) => void)
      | undefined;
    const serializeDocument = ctx?.serializeDocument as (() => string) | undefined;
    if (typeof updateNode !== 'function' || typeof serializeDocument !== 'function') return false;

    updateNode(nodeId, (n) => ({
      ...n,
      name: 'Background hero illustration layer',
      layerColor: 'orange',
      blendMode: 'multiply',
      opacity: 0.5,
      effects: [
        {
          id: 'fx-1',
          type: 'dropShadow',
          x: 0,
          y: 4,
          blur: 8,
          spread: 0,
          color: { space: 'rgb', r: 0, g: 0, b: 0, a: 76 },
          opacity: 0.3,
          blendMode: 'normal',
          visible: true,
        },
      ],
      smartFilters: [
        {
          id: 'sf-1',
          kind: 'brightness',
          visible: true,
          opacity: 1,
          blendMode: 'normal',
          value: 40,
        },
      ],
      mask: {
        type: 'clip',
        visible: true,
        fillRule: 'nonzero',
        vectorMask: {
          points: [
            { x: 0, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 0, handleIn: null, handleOut: null },
            { x: 100, y: 100, handleIn: null, handleOut: null },
            { x: 0, y: 100, handleIn: null, handleOut: null },
          ],
          closed: true,
          fillRule: 'nonzero',
        },
      },
    }));
    const after = JSON.parse(serializeDocument()) as { nodes: Record<string, unknown> };
    return after.nodes[nodeId];
  }, nodeId);
}

test.describe('Layers row badge overflow', () => {
  test('visibility/lock/solo toggles stay inside the panel at minimum width with a fully-badged row', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);

    const row = page.getByRole('treeitem').first();
    await expect(row).toBeVisible();
    const nodeId = await row.getAttribute('data-node-id');
    expect(nodeId).toBeTruthy();

    const decorated = await decorateNodeWithBadges(page, nodeId!);
    expect(decorated).toBeTruthy();
    // Sanity: the badges we just set are actually rendered (proves the
    // scenario is real, not a no-op mutation).
    await expect(row.locator('.layers-row__badge')).toContainText('Multiply');
    await expect(row.locator('.layers-row__mask-badge')).toBeVisible();

    // Drive the panel to its documented minimum width (APG window-splitter:
    // Home jumps to PANEL_LIMITS.layers.min).
    const handle = page.getByRole('separator', { name: 'Resize layers panel' });
    await handle.focus();
    await handle.press('Home');
    await page.waitForTimeout(150);

    const panel = page.locator('.layers-panel');
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeLessThanOrEqual(190); // documented min is 180px

    await row.hover();
    const visToggle = row.locator('button[aria-label*="Hide"], button[aria-label*="Show"]').first();
    const lockToggle = row
      .locator('button[aria-label*="Lock"], button[aria-label*="Unlock"]')
      .first();
    const soloToggle = row
      .locator('button[aria-label*="Solo"], button[aria-label*="Unsolo"]')
      .first();

    for (const toggle of [visToggle, lockToggle, soloToggle]) {
      await expect(toggle).toBeVisible();
      const box = await toggle.boundingBox();
      expect(box).not.toBeNull();
      // Not just "attached" — actually within the panel's own visible bounds,
      // not clipped past its right edge by the tree's overflow-x: hidden.
      expect(box!.x).toBeGreaterThanOrEqual(panelBox!.x);
      expect(box!.x + box!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
      expect(box!.width).toBeGreaterThan(0);
    }

    await panel.screenshot({ path: 'reports/layers-row-badge-overflow-min-width.png' });
  });
});
