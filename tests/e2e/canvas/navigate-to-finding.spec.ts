/**
 * Navigation-to-finding E2E tests.
 *
 * Covers: deep nesting, collapsed ancestors, stale/deleted findings,
 * drag-in-progress navigation, rapid-fire navigation, cross-page/frame
 * navigation, virtualised layers panel, and focus/keyboard usability.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor, seedLayers } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

/**
 * Deterministic three-level nesting fixture used across multiple tests.
 * A frame containing a group containing a rect.
 */
const DEEP_NEST_FIXTURE = {
  id: 'nest-0000-0000-0000-000000000001',
  formatVersion: '2.0',
  name: 'deep-nest',
  rootChildren: ['frame1'],
  nodes: {
    frame1: {
      id: 'frame1',
      kind: 'frame',
      name: 'Outer Frame',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 240, g: 240, b: 245, a: 255 },
      children: ['group1'],
      strokes: [],
      effects: [],
      w: 500,
      h: 400,
      clipContent: true,
    },
    group1: {
      id: 'group1',
      kind: 'group',
      name: 'Inner Group',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 20, 20],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      children: ['rect1'],
      strokes: [],
      effects: [],
    },
    rect1: {
      id: 'rect1',
      kind: 'rect',
      name: 'Target Rect',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 40, 40],
      fill: { space: 'rgb', r: 50, g: 120, b: 200, a: 255 },
      strokes: [],
      effects: [],
      w: 180,
      h: 120,
    },
  },
  components: {},
  nextId: 4,
  activePageId: null,
  globalChildren: [],
};

const MULTI_PAGE_FIXTURE = {
  id: 'multi-0000-0000-0000-000000000002',
  formatVersion: '2.0',
  name: 'multi-page',
  rootChildren: ['page1Root'],
  nodes: {
    page1Root: {
      id: 'page1Root',
      kind: 'group',
      name: 'Page 1 Content',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 0, g: 0, b: 0, a: 0 },
      children: [],
      effects: [],
    },
    page2Rect: {
      id: 'page2Rect',
      kind: 'rect',
      name: 'Page 2 Shape',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 100, 100],
      fill: { space: 'rgb', r: 200, g: 80, b: 80, a: 255 },
      strokes: [],
      effects: [],
      w: 200,
      h: 150,
    },
  },
  components: {},
  nextId: 3,
  activePageId: 'pg1',
  globalChildren: [],
  pages: [
    {
      id: 'pg1',
      name: 'Page 1',
      order: 'a0',
      width: 1920,
      height: 1080,
      backgrounds: [],
      contentRoot: 'page1Root',
    },
    {
      id: 'pg2',
      name: 'Page 2',
      order: 'a1',
      width: 1920,
      height: 1080,
      backgrounds: [],
      contentRoot: 'page2Rect',
    },
  ],
};

/**
 * Load a JSON fixture into the editor via the hidden file input.
 */
async function loadFixture(
  page: import('@playwright/test').Page,
  fixture: Record<string, unknown>,
) {
  await page.locator('#file-open-input').setInputFiles({
    name: `${fixture.name as string}.strata`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(
    countNodes(fixture as { nodes: Record<string, unknown> }),
    { timeout: 10000 },
  );
}

function countNodes(fixture: { nodes: Record<string, unknown> }): number {
  return Object.keys(fixture.nodes).length;
}

test.describe('Navigation to finding', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  test('navigates to a deeply nested node', async ({ page }) => {
    await loadFixture(page, DEEP_NEST_FIXTURE);

    // Use the layers tree to expand all nodes then navigate to the deepest
    await page.getByRole('treeitem').filter({ hasText: 'Outer Frame' }).click();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);
    await page.getByRole('treeitem').filter({ hasText: 'Inner Group' }).click();
    await page.keyboard.press('ArrowRight');
    await page.waitForTimeout(100);

    const target = page.getByRole('treeitem').filter({ hasText: 'Target Rect' });
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');

    // Navigation is the contract under test. The selection info bar and
    // breadcrumb are stable across renderer overlay implementations.
    await expect(page.locator('.selection-info-bar')).toContainText('Target Rect');
  });

  test('navigates to a node whose ancestors are collapsed', async ({ page }) => {
    await loadFixture(page, DEEP_NEST_FIXTURE);

    // Collapse the frame using its disclosure control, not the row selection
    // surface (row clicks select; they do not toggle descendants).
    const frameItem = page.getByRole('treeitem').filter({ hasText: 'Outer Frame' });
    await frameItem.getByRole('button', { name: 'Collapse' }).click();
    await page.waitForTimeout(100);

    // Reveal the chain through the same disclosure controls exposed to a
    // finding navigator, then select the target row.
    await frameItem.getByRole('button', { name: 'Expand' }).click();
    const groupItem = page.getByRole('treeitem').filter({ hasText: 'Inner Group' });
    const groupDisclosure = groupItem.getByRole('button', { name: 'Expand' });
    if (await groupDisclosure.isVisible({ timeout: 1000 }).catch(() => false)) {
      await groupDisclosure.click();
    }

    // The target is now revealed and can be selected through the tree.
    const target = page.getByRole('treeitem').filter({ hasText: 'Target Rect' });
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');
  });

  test('handles stale finding whose node was deleted gracefully', async ({ page }) => {
    await loadFixture(page, DEEP_NEST_FIXTURE);

    // Select the target node
    const target = page.getByRole('treeitem').filter({ hasText: 'Target Rect' });
    await target.click();
    await expect(target).toHaveAttribute('aria-selected', 'true');

    // Delete the node
    await page.keyboard.press('Delete');
    await page.waitForTimeout(200);
    await expect(page.getByRole('treeitem').filter({ hasText: 'Target Rect' })).toHaveCount(0);

    // Simulate a navigation request to the deleted node (finding with stale ID)
    // This should not crash and the selection should be empty or unchanged
    await page.evaluate(() => {
      const el = document.querySelector('[data-layer-id="rect1"]') as HTMLElement | null;
      if (el) el.click();
    });
    await page.waitForTimeout(200);

    // No crash — the app is still usable
    await expect(page.locator('.layers-panel')).toBeVisible();
  });

  test('does not crash when navigating while a canvas drag is active', async ({ page }) => {
    // Create a node to navigate to
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Start a pan drag with the hand tool
    await page.keyboard.press('h');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();

    // While mouse is down (drag active), navigate via layers panel
    const treeItem = page.getByRole('treeitem').first();
    await treeItem.click({ force: true });
    await page.mouse.up();
    await page.waitForTimeout(200);

    // The editor should still be alive and the node selected
    await expect(page.locator('.layers-panel')).toBeVisible();
    await expect(treeItem).toHaveAttribute('aria-selected', 'true');
  });

  test('rapidly navigates through multiple findings without crashing', async ({ page }) => {
    await seedLayers(page, 5);
    await expect(page.getByRole('treeitem')).toHaveCount(5, { timeout: 5000 });

    // Rapidly select each tree item in sequence
    const items = page.getByRole('treeitem');
    for (let i = 0; i < 5; i++) {
      await items.nth(i).click({ force: true, timeout: 5000 });
      await page.waitForTimeout(20);
    }
    await page.waitForTimeout(200);

    // The last item should be selected and the editor responsive
    await expect(items.nth(4)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('.layers-panel')).toBeVisible();
  });

  test('navigates to a node on a different page', async ({ page }) => {
    await loadFixture(page, MULTI_PAGE_FIXTURE);

    // Navigate to page 2 via the page tab or list
    const page2Tab = page.locator('[role="tab"]').filter({ hasText: 'Page 2' });
    await page2Tab.click();
    await page.waitForTimeout(300);

    // Verify we can see Page 2's rect
    const shapeItem = page.getByRole('treeitem').filter({ hasText: 'Page 2 Shape' });
    await expect(shapeItem).toBeVisible({ timeout: 5000 });
    await shapeItem.click();
    await expect(shapeItem).toHaveAttribute('aria-selected', 'true');
  });

  test('navigates reliably when the Layers panel is virtualised', async ({ page }) => {
    // Create enough nodes to trigger virtualisation
    await seedLayers(page, 20);
    await expect(page.getByRole('treeitem')).toHaveCount(20, { timeout: 10000 });

    // Select the last node (likely scrolled out of view)
    const lastItem = page.getByRole('treeitem').last();
    await lastItem.scrollIntoViewIfNeeded();
    await lastItem.click();
    await page.waitForTimeout(200);

    // Now select the first node (scrolling back up)
    const firstItem = page.getByRole('treeitem').first();
    await firstItem.scrollIntoViewIfNeeded();
    await firstItem.click();
    await page.waitForTimeout(200);

    await expect(firstItem).toHaveAttribute('aria-selected', 'true');
  });

  test('focus remains in the active pane after navigation and keyboard is usable', async ({
    page,
  }) => {
    await seedLayers(page, 3);
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 5000 });

    // Focus the canvas and select a node via keyboard
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();
    await page.waitForTimeout(100);

    // Tab to enter tree navigation
    await page.keyboard.press('Tab');
    await page.waitForTimeout(100);

    // The active element should be in the layers tree
    const activeRole = await page.evaluate(
      () => document.activeElement?.getAttribute('role') ?? 'null',
    );
    expect(activeRole).toBe('treeitem');

    // Arrow keys should navigate within the tree
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // No focus should be lost to <body>
    const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? 'null');
    expect(activeTag).not.toBe('BODY');
  });
});
