/**
 * SelectionSetsSection renders as a direct child of the Layers panel's own
 * root (`<div className="editor-layers layers-panel">`), stacked right below
 * the tree — not a sibling owned by some other rail shell. A prior pass
 * quieted the Layers header itself (removed its all-caps title, moved its
 * action buttons onto the shared `--space-5` token scale, added a touch
 * fallback for hover-revealed row toggles) but never touched this section,
 * which still carried the pre-redesign look: an all-caps letter-spaced
 * title, action buttons hardcoded to 18px instead of the density-aware
 * token scale, and no touch/coarse-pointer fallback for its hover-only
 * action row. Two of the three sibling sections in the same rail family
 * (Master pages, Spreads) already use the quiet, sentence-case title this
 * fixes toward.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Layers panel — Selection Sets visual parity', () => {
  test('title is quiet (not all-caps) and action buttons match the row/bulk-bar token scale', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await seedLayers(page, 2);

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await page.waitForTimeout(150);
    const saveBtn = page.getByRole('button', { name: /Save current selection/i });
    await saveBtn.click();
    await page.waitForTimeout(150);

    const title = page.locator('.selection-sets__title');
    await expect(title).toBeVisible();
    await expect(title).toHaveText('Selection sets');
    const titleStyle = await title.evaluate((el) => {
      const s = getComputedStyle(el);
      return { textTransform: s.textTransform, letterSpacing: s.letterSpacing };
    });
    expect(titleStyle.textTransform).toBe('none');

    // Action buttons should sit on the same responsive token scale as the
    // bulk bar's own buttons (both derive from --space-5), not a hardcoded
    // pixel value frozen outside the density system.
    const item = page.locator('.selection-sets__item').first();
    await item.hover();
    const actionBtn = page.locator('.selection-sets__action-btn').first();
    await expect(actionBtn).toBeVisible();
    const bulkBtn = page.locator('.layers-bulk-bar__btn').first();
    const [actionBox, bulkBox] = await Promise.all([
      actionBtn.boundingBox(),
      bulkBtn.boundingBox(),
    ]);
    expect(actionBox).not.toBeNull();
    expect(bulkBox).not.toBeNull();
    expect(actionBox!.width).toBeCloseTo(bulkBox!.width, 0);
    expect(actionBox!.height).toBeCloseTo(bulkBox!.height, 0);
  });
});
