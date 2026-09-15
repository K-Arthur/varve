/**
 * The Layers panel header packs a title/count group and up to five action
 * buttons (settings, auto-reveal, collapse-all, a conditional "Exit Solo"
 * text button, detach) onto one non-wrapping flex row. Solo mode's "Exit
 * Solo" button is the one action-row item that is text plus an icon, not
 * just an icon — with it present, the action row's own natural width alone
 * can exceed the panel's documented minimum width (180px,
 * `PANEL_LIMITS.layers.min`). Neither side of the header shrank or wrapped,
 * and `.layers-panel__title` had no overflow containment, so the "Layers"
 * label rendered past its allotted space and visually overlapped the first
 * icon button instead of being clipped or reflowed — a real, user-visible
 * defect, not just a hairline clipping case.
 *
 * Fix: `.layers-panel__title` now truncates with ellipsis, and a container
 * query mirroring the existing bulk-bar pattern wraps `.layers-panel__header`
 * so the action row gets its own line under the title once the container
 * narrows past 340px.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

async function soloFirstNode(page: import('@playwright/test').Page, nodeId: string) {
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
          'setNodeSolo' in (p.value as Record<string, unknown>)
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
    const setNodeSolo = ctx?.setNodeSolo as ((id: string, solo: boolean) => void) | undefined;
    if (typeof setNodeSolo !== 'function') return false;
    setNodeSolo(nodeId, true);
    return true;
  }, nodeId);
}

test.describe('Layers header overflow during solo', () => {
  test('title does not overlap header actions, and every action stays inside the panel at minimum width', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);

    const row = page.getByRole('treeitem').first();
    const nodeId = await row.getAttribute('data-node-id');
    expect(nodeId).toBeTruthy();
    expect(await soloFirstNode(page, nodeId!)).toBe(true);

    const exitSolo = page.getByRole('button', { name: 'Exit solo view' });
    await expect(exitSolo).toBeVisible();

    // Drive the panel to its documented minimum width.
    const handle = page.getByRole('separator', { name: 'Resize layers panel' });
    await handle.focus();
    await handle.press('Home');
    await page.waitForTimeout(150);

    const panel = page.locator('.layers-panel');
    const panelBox = await panel.boundingBox();
    expect(panelBox).not.toBeNull();
    expect(panelBox!.width).toBeLessThanOrEqual(190);

    // The title must not overlap the first header action button — each
    // element's box should be disjoint from the other's.
    const title = panel.locator('.layers-panel__title');
    const firstHeaderBtn = panel.locator('.layers-panel__header-btn').first();
    const titleBox = await title.boundingBox();
    const firstBtnBox = await firstHeaderBtn.boundingBox();
    expect(titleBox).not.toBeNull();
    expect(firstBtnBox).not.toBeNull();
    const overlaps =
      titleBox!.x < firstBtnBox!.x + firstBtnBox!.width &&
      titleBox!.x + titleBox!.width > firstBtnBox!.x &&
      titleBox!.y < firstBtnBox!.y + firstBtnBox!.height &&
      titleBox!.y + titleBox!.height > firstBtnBox!.y;
    expect(overlaps).toBe(false);

    // Every header action (including the wide "Exit Solo" button and the
    // detach button) stays within the panel's own bounds.
    const actionButtons = panel.locator(
      '.layers-panel__header-btn, .layers-panel__solo-exit-btn, .panel-detach-btn',
    );
    const count = await actionButtons.count();
    expect(count).toBeGreaterThan(0);
    for (let i = 0; i < count; i++) {
      const box = await actionButtons.nth(i).boundingBox();
      expect(box).not.toBeNull();
      expect(box!.width).toBeGreaterThan(0);
      expect(box!.x).toBeGreaterThanOrEqual(panelBox!.x - 1);
      expect(box!.x + box!.width).toBeLessThanOrEqual(panelBox!.x + panelBox!.width + 1);
    }

    await panel.screenshot({ path: 'reports/layers-header-solo-min-width.png' });
  });
});
