import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.use({ video: 'on' });

async function setNavigationMode(page: import('@playwright/test').Page, label: string) {
  const trigger = page.getByRole('button', { name: 'Layer navigation settings' });
  await trigger.click();
  const menu = page.getByRole('menu', { name: 'Layer navigation settings' });
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitemradio', { name: new RegExp(`^${label}(?:$|\\s)`) }).click();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
}

async function setZoom(page: import('@playwright/test').Page, percent: number) {
  const zoom = page.locator('#menubar-zoom');
  await zoom.fill(String(percent));
  await zoom.press('Enter');
  await expect(zoom).toHaveValue(String(percent));
}

async function selectionRect(page: import('@playwright/test').Page) {
  const rect = page.locator('svg:has(filter#selection-glow) > rect').first();
  await expect(rect).toBeVisible();
  return rect.evaluate((element) => {
    const svgRect = element as SVGRectElement;
    return {
      x: svgRect.x.baseVal.value,
      y: svgRect.y.baseVal.value,
      width: svgRect.width.baseVal.value,
      height: svgRect.height.baseVal.value,
    };
  });
}

async function canvasCenter(page: import('@playwright/test').Page) {
  const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
  if (!box) throw new Error('content canvas not found');
  return { x: box.width / 2, y: box.height / 2 };
}

test.describe('Layers selection navigation', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      localStorage.removeItem('varve:safe-mode');
      localStorage.removeItem('varve:crash-loop');
      localStorage.setItem('strata-clean-shutdown', 'true');
    });
    await navigateToEditor(page);
    await seedLayers(page, 4);
  });

  test('Select only preserves the camera and separates tree focus from selection', async ({
    page,
  }) => {
    await setNavigationMode(page, 'Select only');
    await setZoom(page, 25);

    const items = page.getByRole('treeitem');
    await items.nth(0).click();
    const zoomBeforeFocusMove = await page.locator('#menubar-zoom').inputValue();
    await page.screenshot({ path: 'test-results/layer-navigation-select-only.png' });

    const tree = page.getByRole('tree', { name: /layers/i });
    await tree.focus();
    await page.keyboard.press('ArrowDown');
    await expect(items.nth(0)).toHaveAttribute('aria-selected', 'true');
    await expect(page.locator('#menubar-zoom')).toHaveValue(zoomBeforeFocusMove);
    await page.screenshot({ path: 'test-results/layer-navigation-focus-only.png' });
  });

  test('Reveal and Center preserve zoom while Fit changes zoom and centers the target', async ({
    page,
  }) => {
    const items = page.getByRole('treeitem');

    await setNavigationMode(page, 'Reveal when needed');
    await setZoom(page, 25);
    await items.nth(3).click();
    await expect(page.locator('#menubar-zoom')).toHaveValue('25');
    await selectionRect(page);
    await page.screenshot({ path: 'test-results/layer-navigation-reveal.png' });

    await setNavigationMode(page, 'Center selection');
    await setZoom(page, 25);
    await items.nth(1).click();
    await expect(page.locator('#menubar-zoom')).toHaveValue('25');
    const centered = await selectionRect(page);
    const center = await canvasCenter(page);
    expect(Math.abs(centered.x + centered.width / 2 - center.x)).toBeLessThan(35);
    expect(Math.abs(centered.y + centered.height / 2 - center.y)).toBeLessThan(35);
    await page.screenshot({ path: 'test-results/layer-navigation-center.png' });

    await setNavigationMode(page, 'Fit selection');
    await setZoom(page, 25);
    await items.nth(2).click();
    await expect
      .poll(async () => Number.parseFloat(await page.locator('#menubar-zoom').inputValue()))
      .not.toBe(25);
    const fitted = await selectionRect(page);
    const fitCenter = await canvasCenter(page);
    expect(Math.abs(fitted.x + fitted.width / 2 - fitCenter.x)).toBeLessThan(35);
    expect(Math.abs(fitted.y + fitted.height / 2 - fitCenter.y)).toBeLessThan(35);
    await page.screenshot({ path: 'test-results/layer-navigation-fit.png' });
  });

  test('explicit context-menu navigation stays available independently of the preference', async ({
    page,
  }) => {
    await setNavigationMode(page, 'Select only');
    const item = page.getByRole('treeitem').nth(0);
    await item.click();
    await item.click({ button: 'right' });

    const menu = page.locator('.varve-ctxmenu');
    await expect(menu.getByText('Reveal on Canvas', { exact: true })).toBeVisible();
    await expect(menu.getByText('Center Selection', { exact: true })).toBeVisible();
    await expect(menu.getByText('Zoom to Selection', { exact: true })).toBeVisible();
    await menu.evaluate((element) => {
      element.scrollTop = element.scrollHeight;
    });
    await page.screenshot({ path: 'test-results/layer-navigation-context-menu.png' });
    await menu.getByText('Center Selection', { exact: true }).click();
    await selectionRect(page);
  });
});
