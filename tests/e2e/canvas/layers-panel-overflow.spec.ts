/**
 * Visual verification: layers panel context menu escape + toggle visibility.
 *
 * Bug: container-type: inline-size on .editor__layers-panel created a new
 * containing block, clipping the ContextMenu (position:fixed resolved
 * relative to the panel). Layer row names with overflow:visible pushed
 * visibility/lock toggles off-screen.
 */
import { expect, test } from '@playwright/test';

async function navigateToEditor(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 5000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test.describe('Layers panel overflow fixes', () => {
  test('context menu renders fully visible (not clipped by layers panel)', async ({ page }) => {
    await navigateToEditor(page);

    // Add a rectangle so we have a layer to right-click
    const rectTool = page.getByTestId('toolbar').getByRole('button', { name: 'Rectangle' });
    await rectTool.click();
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('No canvas bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Switch back to select tool
    const selectTool = page
      .getByTestId('toolbar')
      .getByRole('button', { name: 'Select', exact: true });
    await selectTool.click();

    // Find the layer row in the layers panel
    const layerRow = page.locator('.layers-row').first();
    await expect(layerRow).toBeVisible({ timeout: 5000 });

    // Right-click to open context menu
    await layerRow.click({ button: 'right' });

    // Wait for the context menu to appear
    const ctxMenu = page.locator('.varve-ctxmenu');
    await expect(ctxMenu).toBeVisible({ timeout: 3000 });
    await expect(ctxMenu).toHaveClass(/varve-menu--default/);

    // Verify the context menu is within the viewport (not clipped)
    const menuBox = await ctxMenu.boundingBox();
    expect(menuBox).not.toBeNull();
    if (menuBox) {
      // Menu must be fully within the viewport
      expect(menuBox.x).toBeGreaterThanOrEqual(0);
      expect(menuBox.y).toBeGreaterThanOrEqual(0);
      // Menu must have meaningful width (not truncated)
      expect(menuBox.width).toBeGreaterThan(100);
    }
    const layerGeometry = await ctxMenu.evaluate((menu) => {
      const layer = menu.parentElement;
      if (!layer) return null;
      const rect = layer.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(layerGeometry).not.toBeNull();
    if (layerGeometry) {
      expect(layerGeometry.left).toBeGreaterThanOrEqual(0);
      expect(layerGeometry.top).toBeGreaterThanOrEqual(0);
      expect(layerGeometry.right).toBeLessThanOrEqual(layerGeometry.viewportWidth);
      expect(layerGeometry.bottom).toBeLessThanOrEqual(layerGeometry.viewportHeight);
    }

    // Verify key menu items are visible and text is not truncated
    const renameItem = ctxMenu.getByText('Rename');
    await expect(renameItem).toBeVisible();
    const lockItem = ctxMenu.getByText('Lock');
    await expect(lockItem).toBeVisible();
    const hideItem = ctxMenu.getByText('Hide');
    await expect(hideItem).toBeVisible();

    for (const label of [/^Bring to Front/, /^Send to Back/, /^Set File Thumbnail…$/]) {
      await expect(ctxMenu.getByRole('menuitem', { name: label })).toBeVisible();
    }
    const menuLabels = await ctxMenu.locator('.varve-menu__item-label').evaluateAll((elements) =>
      elements.map((element) => {
        const style = getComputedStyle(element);
        return {
          textOverflow: style.textOverflow,
          clientWidth: element.clientWidth,
          scrollWidth: element.scrollWidth,
        };
      }),
    );
    for (const label of menuLabels) {
      expect(label.textOverflow).not.toBe('ellipsis');
      expect(label.scrollWidth).toBeLessThanOrEqual(label.clientWidth);
    }

    // Screenshot for visual review
    await ctxMenu.screenshot({ path: 'reports/layers-ctxmenu.png' });
    await page.screenshot({ path: 'reports/layers-ctxmenu-portal.png', fullPage: false });

    // A long target-relative menu may need a scroll viewport when it opens
    // above a low layer row. Verify the final action remains reachable instead
    // of treating the intentionally constrained viewport as clipped content.
    const finalAction = ctxMenu.getByRole('menuitem', {
      name: 'Reveal in Layers panel',
      exact: true,
    });
    const scrollMetricsBefore = await ctxMenu.evaluate((element) => {
      const layer = element.parentElement;
      return {
        clientHeight: layer?.clientHeight ?? 0,
        scrollHeight: layer?.scrollHeight ?? 0,
        scrollTop: layer?.scrollTop ?? 0,
      };
    });
    if (scrollMetricsBefore.scrollHeight > scrollMetricsBefore.clientHeight) {
      await finalAction.scrollIntoViewIfNeeded();
      await expect(finalAction).toBeVisible();
      const scrollMetricsAfter = await ctxMenu.evaluate((element) => {
        const layer = element.parentElement;
        return {
          clientHeight: layer?.clientHeight ?? 0,
          scrollHeight: layer?.scrollHeight ?? 0,
          scrollTop: layer?.scrollTop ?? 0,
        };
      });
      expect(scrollMetricsAfter.scrollHeight).toBeGreaterThan(scrollMetricsAfter.clientHeight);
      expect(scrollMetricsAfter.scrollTop).toBeGreaterThan(scrollMetricsBefore.scrollTop);
      await ctxMenu.screenshot({ path: 'reports/layers-ctxmenu-scrolled.png' });
    } else {
      await expect(finalAction).toBeVisible();
    }

    // Close the context menu
    await page.keyboard.press('Escape');
  });

  test('visibility and lock toggle buttons are visible on layer rows', async ({ page }) => {
    await navigateToEditor(page);

    // Add a rectangle so we have a layer
    const rectTool = page.getByTestId('toolbar').getByRole('button', { name: 'Rectangle' });
    await rectTool.click();
    const canvas = page.locator('canvas').first();
    const box = await canvas.boundingBox();
    if (!box) throw new Error('No canvas bounding box');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    // Switch back to select tool
    const selectTool = page
      .getByTestId('toolbar')
      .getByRole('button', { name: 'Select', exact: true });
    await selectTool.click();

    // Find the layer row
    const layerRow = page.locator('.layers-row').first();
    await expect(layerRow).toBeVisible({ timeout: 5000 });

    // Hover over the row to reveal toggles (they have opacity transitions)
    await layerRow.hover();

    // Check that the visibility toggle button is visible and within the panel bounds
    const visToggle = layerRow
      .locator('button[aria-label*="Hide"], button[aria-label*="Show"]')
      .first();
    await expect(visToggle).toBeVisible({ timeout: 3000 });

    const visBox = await visToggle.boundingBox();
    expect(visBox).not.toBeNull();

    // Check that the lock toggle button is visible and within the panel bounds
    const lockToggle = layerRow
      .locator('button[aria-label*="Lock"], button[aria-label*="Unlock"]')
      .first();
    await expect(lockToggle).toBeVisible({ timeout: 3000 });

    const lockBox = await lockToggle.boundingBox();
    expect(lockBox).not.toBeNull();

    // Both toggles must be within the layers panel bounds
    const panelBox = await page.locator('.layers-panel').boundingBox();
    expect(panelBox).not.toBeNull();
    if (visBox && lockBox && panelBox) {
      const panelRight = panelBox.x + panelBox.width;
      expect(visBox.x + visBox.width).toBeLessThanOrEqual(panelRight + 2);
      expect(lockBox.x + lockBox.width).toBeLessThanOrEqual(panelRight + 2);
    }

    // Screenshot showing toggles
    await page.screenshot({ path: 'reports/layers-toggles-visible.png', fullPage: false });
  });
});
