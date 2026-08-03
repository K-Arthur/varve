import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Logo panel E2E — workspace visibility, empty state, project creation,
 * typography (kerning off + glyph controls), and vectorize context state.
 */
test.describe('Logo panel', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('is hidden in the design workspace and opens in the Logo workspace', async ({ page }) => {
    await expect(page.getByTestId('logo-panel')).toHaveCount(0);
    await page.keyboard.press('Control+Shift+6');
    await expect(page.getByTestId('logo-panel')).toBeVisible({ timeout: 15000 });
  });

  test('switching away from the Logo workspace hides the panel', async ({ page }) => {
    await page.keyboard.press('Control+Shift+6');
    await expect(page.getByTestId('logo-panel')).toBeVisible({ timeout: 15000 });
    await page.keyboard.press('Control+Shift+1');
    await expect(page.getByTestId('logo-panel')).toHaveCount(0, { timeout: 10000 });
  });

  test('View menu shows the Logo Panel item only in the Logo workspace', async ({ page }) => {
    await page.getByRole('menuitem', { name: /^View/i }).click();
    await expect(page.getByRole('menuitem', { name: /Logo Panel/i })).toHaveCount(0);
    await page.keyboard.press('Escape');
    await page.keyboard.press('Control+Shift+6');
    await page.getByRole('menuitem', { name: /^View/i }).click();
    const item = page.getByRole('menuitem', { name: /Logo Panel/i });
    await expect(item).toBeVisible();
    await expect(item).toHaveAttribute('aria-checked', 'true');
    await item.click();
    await expect(page.getByTestId('logo-panel')).toHaveCount(0);
  });

  test('empty state starts a logo project with concepts and sections', async ({ page }) => {
    await page.keyboard.press('Control+Shift+6');
    const panel = page.getByTestId('logo-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText(/No logo project yet/i)).toBeVisible();
    await panel.getByRole('button', { name: /Start logo project/i }).click();
    await expect(panel.getByText(/Concept 1/i).first()).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText('Brand name')).toBeVisible();
    await expect(panel.getByRole('button', { name: /Add concept/i })).toBeVisible();
    await expect(panel.getByText(/Export Package/i)).toBeVisible();
  });

  test('typography section exposes kerning mode and glyph controls for a wordmark', async ({
    page,
  }) => {
    await page.keyboard.press('Control+Shift+6');
    const panel = page.getByTestId('logo-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    // Create a text wordmark with the text tool.
    await page.keyboard.press('t');
    await page.mouse.click(400, 300);
    await page.keyboard.type('Wordmark');
    await page.keyboard.press('Escape');
    // Select the text node by clicking it.
    await page.mouse.click(400, 300);
    // Typography section now shows the glyph controls.
    const kerning = panel.getByRole('combobox', { name: 'Kerning mode' });
    await expect(kerning).toBeVisible({ timeout: 15000 });
    await expect(kerning).toHaveText(/Auto/);

    // Turn kerning off.
    await kerning.click();
    await page.getByRole('option', { name: 'Off' }).click();
    await expect(kerning).toHaveText(/Off/);

    // Per-glyph controls are present.
    await expect(panel.getByRole('combobox', { name: 'Cluster' })).toBeVisible();
    await expect(panel.getByRole('combobox', { name: 'Gap' })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Reset all/i })).toBeVisible();
    await expect(panel.getByRole('button', { name: /Convert to outlines/i })).toBeVisible();
  });

  test('vectorize section explains the image requirement without an image', async ({ page }) => {
    await page.keyboard.press('Control+Shift+6');
    const panel = page.getByTestId('logo-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await expect(panel.getByText(/Select an image layer to vectorize it/i).first()).toBeVisible();
  });

  test('export package section lists concepts and formats', async ({ page }) => {
    await page.keyboard.press('Control+Shift+6');
    const panel = page.getByTestId('logo-panel');
    await expect(panel).toBeVisible({ timeout: 15000 });
    await panel.getByRole('button', { name: /Start logo project/i }).click();
    const exportSection = panel.getByText(/Export Package/i);
    await expect(exportSection).toBeVisible({ timeout: 15000 });
    // Concept target listed with a checkbox.
    await expect(panel.getByText(/Concept 1 \(concept\)/i)).toBeVisible();
    // Format checkboxes present.
    await expect(panel.getByLabel('SVG')).toBeVisible();
    await expect(panel.getByLabel('ICO')).toBeVisible();
    await expect(panel.getByLabel('ICNS')).toBeVisible();
    await expect(panel.getByLabel('PDF')).toBeVisible();
    // Naming preview shows the deterministic zip name.
    await expect(panel.getByText(/-Logo-Package\.zip/i)).toBeVisible();
    await expect(panel.getByRole('button', { name: /Export package/i })).toBeVisible();
  });
});
