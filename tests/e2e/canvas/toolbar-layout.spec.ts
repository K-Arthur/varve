import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Regression coverage for two connected toolbar-overlap defects.
 *
 * 1. `.editor-shell` (the grid container) had `position: static`. CSS Grid
 *    only lets a `position: absolute` grid item (like `.floating-toolbar`,
 *    which sets `grid-area: canvas` specifically so it stays confined to
 *    the canvas row instead of the chrome below it — pagenav/selinfo/
 *    status) use its grid area as the containing block when the grid
 *    container itself establishes a containing block (i.e. is not
 *    position: static). Without that, the toolbar fell back to the
 *    document's initial containing block and rendered wherever `bottom:
 *    var(--space-3)` put it relative to the whole page — overlapping
 *    PageNav, SelectionInfoBar, and the status bar.
 *
 * 2. `SelectionQuickBar` always positioned itself a fixed offset below the
 *    selection with no clamping — when the selection's bottom edge was
 *    near the canvas's own bottom edge, the bar rendered past it and
 *    overlapped PageNav underneath.
 */
test.describe('Toolbar layout', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    // Design mode intentionally hides page navigation for a single-page
    // document. Create a second page so this layout contract exercises the
    // chrome stack it names instead of depending on an optional element.
    const addPage = page.getByTestId('layers-panel').getByRole('button', { name: 'Add page' });
    await addPage.click();
    await addPage.click();
    await expect(page.locator('.page-nav-container')).toBeVisible();
  });

  function rectsOverlap(
    a: { top: number; bottom: number; left: number; right: number },
    b: { top: number; bottom: number; left: number; right: number },
  ): boolean {
    return a.top < b.bottom && a.bottom > b.top && a.left < b.right && a.right > b.left;
  }

  async function boxOf(page: import('@playwright/test').Page, selector: string) {
    const loc = page.locator(selector).first();
    await expect(loc).toBeVisible();
    return loc.evaluate((el) => {
      const r = el.getBoundingClientRect();
      return { top: r.top, bottom: r.bottom, left: r.left, right: r.right };
    });
  }

  test('the floating toolbar never overlaps the page-nav, selection-info, or status bars', async ({
    page,
  }) => {
    const floatingToolbar = await boxOf(page, '.floating-toolbar');
    const pageNav = await boxOf(page, '.page-nav-container');
    const status = await boxOf(page, '.editor-status');

    expect(rectsOverlap(floatingToolbar, pageNav)).toBe(false);
    expect(rectsOverlap(floatingToolbar, status)).toBe(false);
    // The toolbar should sit fully above the chrome stack, not just avoid
    // pixel overlap by coincidence.
    expect(floatingToolbar.bottom).toBeLessThanOrEqual(pageNav.top);
  });

  test('the selection quick bar flips above the selection instead of overlapping page-nav when there is no room below', async ({
    page,
  }) => {
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(200);

    const wField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const hField = page.getByRole('spinbutton', { name: 'H (px)', exact: true });
    await wField.fill('600');
    await wField.press('Enter');
    await hField.fill('550');
    await hField.press('Enter');
    await page.waitForTimeout(200);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.focus();
    await page.keyboard.press('Shift+2'); // fit selection
    await page.waitForTimeout(300);

    // Drag the image down so its bottom edge sits at the visible canvas edge.
    const overlaySvg = page.locator('svg:has(filter#selection-glow)');
    const outline = overlaySvg.locator(':scope > rect').first();
    let r = await outline.evaluate((el) => el.getBoundingClientRect());
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    const centerX = r.x + r.width / 2;
    const centerY = r.y + r.height / 2;
    const targetY = box.y + box.height - r.height / 2 - 5;
    await page.mouse.move(centerX, centerY);
    await page.mouse.down();
    await page.mouse.move(centerX, (centerY + targetY) / 2);
    await page.mouse.move(centerX, targetY);
    await page.mouse.up();
    await page.waitForTimeout(300);

    r = await outline.evaluate((el) => el.getBoundingClientRect());
    const quickBar = await boxOf(page, '.selection-quick-bar');
    const pageNav = await boxOf(page, '.page-nav-container');

    expect(rectsOverlap(quickBar, pageNav)).toBe(false);
    // It must have actually flipped above the selection, not merely missed
    // colliding by luck.
    expect(quickBar.bottom).toBeLessThanOrEqual(r.top + 1);
  });
});
