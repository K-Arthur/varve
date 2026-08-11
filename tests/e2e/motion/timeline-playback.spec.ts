import { expect, test } from '@playwright/test';
import { createTimelineInEditor, ensureTimelinePanelVisible, navigateToEditor } from './helpers';

test.describe('Timeline playback', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('timeline panel is visible in editor shell', async ({ page }) => {
    // The panel is workspace-dependent (hidden in the default Design
    // workspace); toggle it on explicitly so the assertion is deterministic.
    await ensureTimelinePanelVisible(page);
    const panel = page.locator('.timeline-panel');
    await expect(panel).toBeVisible();
    await expect(panel.getByText('No timeline selected')).toBeVisible();
  });

  test('timeline selector has accessible label', async ({ page }) => {
    // The selector only renders once a timeline exists.
    await createTimelineInEditor(page);
    const selector = page.getByLabel('Select timeline');
    await expect(selector).toBeVisible();
  });

  test('toggle timeline panel shortcut hides panel', async ({ page }) => {
    const panel = page.locator('.timeline-panel');
    await ensureTimelinePanelVisible(page);
    await expect(panel).toBeVisible();
    await page.keyboard.press('Control+Alt+t');
    await expect(panel).not.toBeVisible();
    await page.keyboard.press('Control+Alt+t');
    await expect(panel).toBeVisible();
  });

  test('double-click ruler adds a marker', async ({ page }) => {
    await createTimelineInEditor(page);
    const ruler = page.locator('.timeline-ruler');
    await expect(ruler).toBeVisible();
    await ruler.dblclick({ position: { x: 100, y: 8 } });
    await expect(page.locator('.timeline-ruler__marker')).toHaveCount(1);
  });

  test('create timeline button exposes timeline in selector', async ({ page }) => {
    await createTimelineInEditor(page);
    // The timeline selector is the custom combobox Select (no native <select>
    // or <option> elements); the selected timeline renders as its text.
    const selector = page.getByRole('combobox', { name: 'Select timeline' });
    await expect(selector).toContainText('Timeline 1');
    await selector.click();
    await expect(page.getByRole('option', { name: 'Timeline 1' })).toHaveCount(1);
  });
});
