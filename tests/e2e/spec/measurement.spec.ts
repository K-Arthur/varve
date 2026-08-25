import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

function getCanvas(page: import('@playwright/test').Page) {
  return page.getByTestId('editor-canvas');
}

test.describe('Spec Panel Measurement', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function activateTool(page: import('@playwright/test').Page, name: string) {
    const btn = page.getByRole('button', { name, exact: true });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(200);
  }

  test('enter inspect mode via shortcut I shows spec panel on selection', async ({ page }) => {
    // Create a rect first
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(500);

    // Switch to inspect mode
    await activateTool(page, 'Inspect');

    // Click on canvas to select the rect
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(300);

    // Inspect mode now keeps the selection in the unified Inspector rather
    // than opening the retired standalone SpecPanel surface.
    const inspector = page.getByRole('region', { name: 'Inspector' });
    await expect(inspector).toBeVisible({ timeout: 5000 });

    // Should show node name
    const name = inspector.locator('.insp-panel__node-name');
    await expect(name).toBeVisible();
  });

  test('measurement overlay shows dimension label for selected node', async ({ page }) => {
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(500);

    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(500);

    // Measure overlay SVG should be rendered
    const overlay = page.locator('.measure-overlay');
    await expect(overlay).toBeVisible({ timeout: 5000 });

    // Should contain a dimension text (W x H pattern)
    await expect(overlay.locator('text')).toContainText(/[0-9]+/);
  });

  test('spec panel shows layout readout with width and height', async ({ page }) => {
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(500);

    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(300);

    // The unified Inspector exposes the same geometry through Position & Size.
    const layoutSection = page.getByRole('button', { name: 'Position & Size' });
    await expect(layoutSection).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('W (px)')).toBeVisible();
    await expect(page.getByLabel('H (px)')).toBeVisible();
  });

  test('unified Inspector exposes accessible geometry fields', async ({ page }) => {
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(500);

    await activateTool(page, 'Inspect');
    await getCanvas(page).click({ position: { x: 200, y: 200 }, force: true });
    await page.waitForTimeout(300);

    await expect(page.getByLabel('X (px)')).toBeVisible({ timeout: 5000 });
    await expect(page.getByLabel('Y (px)')).toBeVisible();
    await expect(page.getByLabel('W (px)')).toBeVisible();
    await expect(page.getByLabel('H (px)')).toBeVisible();
  });
});
