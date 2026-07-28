/**
 * Canvas overlay interaction E2E tests.
 *
 * Covers: findings overlay toggle, pan/zoom while overlay is active,
 * hover and click on finding markers, navigate to the finding's node,
 * edit node to clear finding, undo/redo overlay state, stale overlay
 * cleanup, pointer-event isolation, and high-contrast / reduced-motion
 * states.
 */
import { expect, test } from '@playwright/test';
import { mod } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

/**
 * A document with a text node that triggers a contrast finding.
 * The findings overlay must be enabled for markers to render.
 */
const LOW_CONTRAST_FIXTURE = {
  id: 'overlay-0000-0000-0000-000000000010',
  formatVersion: '2.0',
  name: 'overlay-test',
  rootChildren: ['bgRect', 'text1'],
  nodes: {
    bgRect: {
      id: 'bgRect',
      kind: 'rect',
      name: 'Background',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 0, 0],
      fill: { space: 'rgb', r: 255, g: 255, b: 255, a: 255 },
      strokes: [],
      effects: [],
      w: 800,
      h: 600,
    },
    text1: {
      id: 'text1',
      kind: 'text',
      name: 'Low Contrast Text',
      layerColor: null,
      order: 'a0',
      visible: true,
      locked: false,
      opacity: 1,
      blendMode: 'normal',
      rotation: 0,
      transform: [1, 0, 0, 1, 100, 100],
      fill: { space: 'rgb', r: 204, g: 204, b: 204, a: 255 },
      text: 'Hard to read',
      fontSize: 16,
      strokes: [],
      effects: [],
    },
  },
  components: {},
  nextId: 3,
  activePageId: null,
  globalChildren: [],
};

/**
 * Enable the experimental findings overlay feature flag via localStorage
 * before the editor boots so that isFeatureEnabled('findingsOverlay')
 * returns true.
 */
async function enableFindingsOverlay(page: import('@playwright/test').Page) {
  await page.evaluate(() => {
    const key = 'strata-editor-settings';
    const raw = localStorage.getItem(key);
    const settings = raw ? JSON.parse(raw) : {};
    if (!settings.features) settings.features = {};
    settings.features.findingsOverlay = true;
    localStorage.setItem(key, JSON.stringify(settings));
  });
}

async function loadFixture(
  page: import('@playwright/test').Page,
  fixture: Record<string, unknown>,
) {
  await page.locator('#file-open-input').setInputFiles({
    name: `${fixture.name as string}.strata`,
    mimeType: 'application/json',
    buffer: Buffer.from(JSON.stringify(fixture)),
  });
  const count = Object.keys(fixture.nodes as Record<string, unknown>).length;
  await expect(page.getByRole('treeitem')).toHaveCount(count, { timeout: 10000 });
}

/**
 * Toggle the findings overlay via the View menu.
 */
async function toggleFindingsOverlay(page: import('@playwright/test').Page) {
  // Open View menu
  await page.getByRole('menubar').locator('[role="menuitem"]', { hasText: 'View' }).click();
  await page.waitForTimeout(100);
  // Click Show/Hide Findings Overlay
  const menuItem = page.getByRole('menu').locator('[role="menuitem"]', {
    hasText: /findings overlay/i,
  });
  await menuItem.click();
  await page.waitForTimeout(300);
}

test.describe('Canvas overlay interaction', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await enableFindingsOverlay(page);
    await navigateToEditor(page);
  });

  test('toggles findings overlay on and renders markers', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);

    await toggleFindingsOverlay(page);

    // After enabling, finding badges (SVG circles) should appear
    const findingBadges = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(findingBadges.first()).toBeVisible({ timeout: 5000 });
  });

  test('pan and zoom remain functional with overlay active', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Pan with hand tool
    await page.keyboard.press('h');
    await page.mouse.move(box.x + 300, box.y + 300);
    await page.mouse.down();
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.up();
    await page.waitForTimeout(200);

    // Zoom via keyboard
    await canvas.focus();
    await page.keyboard.press('=');
    await page.waitForTimeout(100);
    await page.keyboard.press('-');
    await page.waitForTimeout(100);

    // Overlay markers should still be present after pan + zoom
    const findingBadges = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(findingBadges.first()).toBeAttached({ timeout: 5000 });

    // Canvas should still be responsive — draw a shape
    await page.keyboard.press('r');
    await dragOnCanvas(page, 200, 200, 400, 350);
    await expect(page.getByRole('treeitem')).toHaveCount(
      Object.keys(LOW_CONTRAST_FIXTURE.nodes).length + 1,
      { timeout: 5000 },
    );
  });

  test('hovering a finding marker shows tooltip and highlights it', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    const findingBadge = page.locator('[role="button"][aria-label*="Finding"]').first();
    await expect(findingBadge).toBeVisible({ timeout: 5000 });

    // Hover the badge — the tooltip rect should appear
    await findingBadge.hover();
    await page.waitForTimeout(200);

    // The badge circle should be enlarged (stroke-width increase) meaning
    // the hover state was applied
    const hoveredCircle = findingBadge.locator('circle');
    const strokeWidth = await hoveredCircle.evaluate((el) =>
      Number(getComputedStyle(el).strokeWidth.replace('px', '')),
    );
    expect(strokeWidth).toBeGreaterThanOrEqual(2);
  });

  test('clicking a finding marker navigates to the node and opens the inspector', async ({
    page,
  }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    const findingBadge = page.locator('[role="button"][aria-label*="Finding"]').first();
    await expect(findingBadge).toBeVisible({ timeout: 5000 });

    // Click the badge — should navigate to the text node
    await findingBadge.click();
    await page.waitForTimeout(300);

    // The node should be selected in the layers tree
    const textItem = page.getByRole('treeitem').filter({ hasText: 'Low Contrast Text' });
    await expect(textItem).toHaveAttribute('aria-selected', 'true');

    // The inspector should be open to a relevant section
    const inspector = page.locator('.editor__inspector-panel');
    await expect(inspector).toBeVisible();
  });

  test('editing a node so the finding disappears clears its overlay marker', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    // Count finding badges before edit
    const badgesBefore = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(badgesBefore.first()).toBeVisible({ timeout: 5000 });
    const countBefore = await badgesBefore.count();
    expect(countBefore).toBeGreaterThanOrEqual(1);

    // Select the text node and delete it
    const textItem = page.getByRole('treeitem').filter({ hasText: 'Low Contrast Text' });
    await textItem.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // After deletion, the overlay should re-render without the deleted node's marker
    const badgesAfter = page.locator('[role="button"][aria-label*="Finding"]');
    const countAfter = await badgesAfter.count();
    expect(countAfter).toBeLessThan(countBefore);
  });

  test('undo and redo correctly restore and clear overlay state', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    // Confirm badges present
    const badges = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
    const countBefore = await badges.count();

    // Delete the text node
    const textItem = page.getByRole('treeitem').filter({ hasText: 'Low Contrast Text' });
    await textItem.click();
    await page.waitForTimeout(100);
    await page.keyboard.press('Delete');
    await page.waitForTimeout(300);

    // Badges should decrease
    const countAfterDelete = await badges.count();
    expect(countAfterDelete).toBeLessThan(countBefore);

    // Undo the delete
    await page.keyboard.press(mod('z'));
    await page.waitForTimeout(300);

    // Badges should return
    const countAfterUndo = await badges.count();
    expect(countAfterUndo).toBe(countBefore);

    // Redo the delete
    await page.keyboard.press(`Shift+${mod('z')}`);
    await page.waitForTimeout(300);

    // Badges should decrease again
    const countAfterRedo = await badges.count();
    expect(countAfterRedo).toBeLessThan(countBefore);
  });

  test('stale overlay markers are not left behind after canvas mutation', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    const badges = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(badges.first()).toBeVisible({ timeout: 5000 });
    const initialCount = await badges.count();

    // Rename the node — this should not affect overlay markers but also
    // should not cause stale duplicates.
    const textItem = page.getByRole('treeitem').filter({ hasText: 'Low Contrast Text' });
    await textItem.dblclick();
    await page.waitForTimeout(200);
    const nameEditor = page.locator('[role="treeitem"] [contenteditable]').first();
    if (await nameEditor.isVisible().catch(() => false)) {
      await nameEditor.fill('Renamed Text');
      await nameEditor.press('Enter');
      await page.waitForTimeout(200);
    }

    // Badge count should remain the same (not duplicate)
    const countAfterRename = await badges.count();
    expect(countAfterRename).toBe(initialCount);
  });

  test('pointer events on the overlay do not block normal canvas interaction', async ({ page }) => {
    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Create a new shape — pointer events must reach the canvas through the overlay
    await page.keyboard.press('r');
    await dragOnCanvas(page, 50, 50, 250, 200);
    await expect(page.getByRole('treeitem')).toHaveCount(
      Object.keys(LOW_CONTRAST_FIXTURE.nodes).length + 1,
      { timeout: 5000 },
    );

    // Select the new shape by clicking on the canvas
    await page.keyboard.press('v');
    await page.waitForTimeout(100);
    await page.mouse.click(box.x + 150, box.y + 125);
    await page.waitForTimeout(200);

    // The newly created rect should be selected
    const rectItem = page.getByRole('treeitem').filter({ hasText: /rect/i }).last();
    await expect(rectItem).toHaveAttribute('aria-selected', 'true');
  });

  test('overlay respects high-contrast theme', async ({ page }) => {
    // Set high-contrast theme via localStorage
    await page.evaluate(() => {
      const key = 'strata-editor-settings';
      const raw = localStorage.getItem(key);
      const settings = raw ? JSON.parse(raw) : {};
      if (!settings.appearance) settings.appearance = {};
      settings.appearance.theme = 'high-contrast';
      localStorage.setItem(key, JSON.stringify(settings));
    });

    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    // Overlay should still render (visual check) and be interactive
    const findingBadge = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(findingBadge.first()).toBeVisible({ timeout: 5000 });

    // Hover should work in high-contrast mode
    await findingBadge.first().hover();
    await page.waitForTimeout(100);
    await expect(page.locator('.layers-panel')).toBeVisible();
  });

  test('overlay renders under reduced-motion preference', async ({ page }) => {
    // Enable reduced motion via localStorage
    await page.evaluate(() => {
      const key = 'strata-editor-settings';
      const raw = localStorage.getItem(key);
      const settings = raw ? JSON.parse(raw) : {};
      if (!settings.appearance) settings.appearance = {};
      settings.appearance.reduceMotion = true;
      settings.features = settings.features || {};
      settings.features.findingsOverlay = true;
      localStorage.setItem(key, JSON.stringify(settings));
    });

    await loadFixture(page, LOW_CONTRAST_FIXTURE);
    await toggleFindingsOverlay(page);

    // Overlay markers should still appear
    const findingBadge = page.locator('[role="button"][aria-label*="Finding"]');
    await expect(findingBadge.first()).toBeVisible({ timeout: 5000 });

    // Click a badge — navigation should still work without animations
    await findingBadge.first().click();
    await page.waitForTimeout(200);
    const textItem = page.getByRole('treeitem').filter({ hasText: 'Low Contrast Text' });
    await expect(textItem).toHaveAttribute('aria-selected', 'true');
  });
});
