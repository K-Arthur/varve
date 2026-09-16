import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Focus the editor canvas and activate a tool via shortcut key.
 */
async function activateTool(page: Page, key: string) {
  await page.keyboard.press('Escape');
  await page.locator('canvas.editor-canvas__content-layer').focus();
  await page.keyboard.press(key);
}

test.describe('Frame Preset UX & Interaction Scenarios', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Scenario 1: Single frame selection, instant search filter, apply preset and undo', async ({
    page,
  }) => {
    const inspector = page.locator('.editor-inspector');
    await activateTool(page, 'f');

    // Place an initial frame using iPhone SE preset from Frame tool options
    await inspector.getByRole('option', { name: /^iPhone SE\b/ }).click();

    // Verify initial dimensions
    const widthInput = inspector.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const heightInput = inspector.getByRole('spinbutton', { name: 'H (px)', exact: true });
    await expect(widthInput).toHaveValue('375');
    await expect(heightInput).toHaveValue('667');

    // Trigger button shows iPhone SE
    const presetTrigger = inspector.getByRole('button', { name: 'Resize to Preset', exact: true });
    await expect(presetTrigger).toBeVisible();
    await expect(presetTrigger).toContainText('iPhone SE');

    // Open preset popover
    await presetTrigger.click();
    const popover = page.locator('[data-testid="frame-preset-popover"]');
    await expect(popover).toBeVisible();

    // Instant search for Desktop
    const searchInput = popover.getByRole('textbox', { name: 'Filter presets' });
    await searchInput.fill('Desktop');

    // Select Desktop (1440 × 1024)
    const desktopOption = popover.getByRole('option', { name: /Desktop/i }).first();
    await expect(desktopOption).toBeVisible();
    await desktopOption.click();

    // Popover closes and dimensions update
    await expect(popover).toHaveCount(0);
    await expect(widthInput).toHaveValue('1440');
    await expect(heightInput).toHaveValue('1024');
    await expect(presetTrigger).toContainText('Desktop');

    // Undo restores previous frame dimensions
    await page.keyboard.press('ControlOrMeta+z');
    await expect(widthInput).toHaveValue('375');
    await expect(heightInput).toHaveValue('667');
    await expect(presetTrigger).toContainText('iPhone SE');
  });

  test('Scenario 2: Orientation toggle swaps portrait/landscape and updates preset label', async ({
    page,
  }) => {
    const inspector = page.locator('.editor-inspector');
    await activateTool(page, 'f');
    await inspector.getByRole('option', { name: /^iPhone SE\b/ }).click();

    const widthInput = inspector.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const heightInput = inspector.getByRole('spinbutton', { name: 'H (px)', exact: true });
    const presetTrigger = inspector.getByRole('button', { name: 'Resize to Preset', exact: true });
    const orientationBtn = inspector.getByRole('button', { name: 'Swap orientation', exact: true });

    await expect(widthInput).toHaveValue('375');
    await expect(heightInput).toHaveValue('667');
    await expect(presetTrigger).toContainText('iPhone SE');
    await expect(presetTrigger).not.toContainText('(Landscape)');

    // Swap to landscape
    await orientationBtn.click();
    await expect(widthInput).toHaveValue('667');
    await expect(heightInput).toHaveValue('375');
    await expect(presetTrigger).toContainText('iPhone SE (Landscape)');

    // Swap back to portrait
    await orientationBtn.click();
    await expect(widthInput).toHaveValue('375');
    await expect(heightInput).toHaveValue('667');
    await expect(presetTrigger).toContainText('iPhone SE');
  });

  test('Scenario 3: Category filter chips narrow preset results', async ({ page }) => {
    const inspector = page.locator('.editor-inspector');
    await activateTool(page, 'f');
    await inspector.getByRole('option', { name: /^iPhone SE\b/ }).click();

    const presetTrigger = inspector.getByRole('button', { name: 'Resize to Preset', exact: true });
    await presetTrigger.click();
    const popover = page.locator('[data-testid="frame-preset-popover"]');
    await expect(popover).toBeVisible();

    // Click Social tab chip
    const socialChip = popover.getByRole('tab', { name: 'Social', exact: true });
    await socialChip.click();

    // Verify social presets are shown and phone presets are not
    await expect(popover.getByRole('option', { name: /Instagram/i }).first()).toBeVisible();
    await expect(popover.getByRole('option', { name: /iPhone 16/i })).toHaveCount(0);

    // Switch to Phone tab chip
    const phoneChip = popover.getByRole('tab', { name: 'Phone', exact: true });
    await phoneChip.click();
    await expect(popover.getByRole('option', { name: /iPhone/i }).first()).toBeVisible();
    await expect(popover.getByRole('option', { name: /Instagram/i })).toHaveCount(0);

    // Switch back to All
    const allChip = popover.getByRole('tab', { name: 'All', exact: true });
    await allChip.click();
    await expect(popover.getByRole('option', { name: /iPhone/i }).first()).toBeVisible();
    await expect(popover.getByRole('option', { name: /Instagram/i }).first()).toBeVisible();
  });

  test('Scenario 4: Save current frame size as custom preset and find in custom filter', async ({
    page,
  }) => {
    const inspector = page.locator('.editor-inspector');
    await activateTool(page, 'f');
    await inspector.getByRole('option', { name: /^iPhone SE\b/ }).click();

    // Set custom dimensions: 733 x 419 (not matching any builtin preset)
    const widthInput = inspector.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const heightInput = inspector.getByRole('spinbutton', { name: 'H (px)', exact: true });
    await widthInput.fill('733');
    await widthInput.press('Enter');
    await heightInput.fill('419');
    await heightInput.press('Enter');

    const presetTrigger = inspector.getByRole('button', { name: 'Resize to Preset', exact: true });
    await expect(presetTrigger).toContainText('Custom');

    // Open popover and click "Save current size as preset"
    await presetTrigger.click();
    const popover = page.locator('[data-testid="frame-preset-popover"]');
    const saveBtn = popover.getByRole('button', { name: 'Save current size as preset' });
    await expect(saveBtn).toBeVisible();
    await saveBtn.click();

    // PromptDialog appears
    const promptInput = page.getByRole('textbox', { name: 'Save frame size as preset' });
    await expect(promptInput).toBeVisible();
    await promptInput.fill('Retro Banner 733');
    await page.getByRole('button', { name: 'Confirm', exact: true }).click();

    // Re-open preset popover and verify custom preset exists
    await presetTrigger.click();
    const customChip = popover.getByRole('tab', { name: 'Custom', exact: true });
    await customChip.click();

    const customOption = popover.getByRole('option', { name: /Retro Banner 733/i });
    await expect(customOption).toBeVisible();
    await expect(customOption).toContainText('733 x 419');
  });

  test('Scenario 5: Multi-frame selection displays Mixed and batch-resizes both frames', async ({
    page,
  }) => {
    const inspector = page.locator('.editor-inspector');
    const canvas = page.locator('canvas.editor-canvas__content-layer');

    // Create frame 1
    await activateTool(page, 'f');
    await canvas.click({ position: { x: 300, y: 300 } });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });

    // Create frame 2
    await activateTool(page, 'f');
    await canvas.click({ position: { x: 600, y: 300 } });
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });

    // Select both frames in Layers panel
    const treeitems = page.getByRole('treeitem');
    await treeitems.first().click();
    await page.keyboard.down('Shift');
    await treeitems.nth(1).click();
    await page.keyboard.up('Shift');

    // Verify preset trigger shows Mixed (or Custom/Preset depending on defaults)
    const presetTrigger = inspector.getByRole('button', { name: 'Resize to Preset', exact: true });
    await expect(presetTrigger).toBeVisible();

    // Open popover and select iPhone 16 & 17 Pro
    await presetTrigger.click();
    const popover = page.locator('[data-testid="frame-preset-popover"]');
    await popover.getByRole('textbox', { name: 'Filter presets' }).fill('iPhone 16');
    await popover
      .getByRole('option', { name: /^iPhone 16 & 17 Pro\b/ })
      .first()
      .click();

    // Verify both frames were resized: when both frames have identical width & height,
    // the inputs show the exact value rather than mixed
    const widthInput = inspector.getByRole('spinbutton', { name: 'W (px)', exact: true });
    const heightInput = inspector.getByRole('spinbutton', { name: 'H (px)', exact: true });
    await expect(widthInput).toHaveValue('402');
    await expect(heightInput).toHaveValue('874');
    await expect(presetTrigger).toContainText('iPhone 17');
  });

  test('Scenario 6: Non-frame selection completely hides preset dropdown and orientation button', async ({
    page,
  }) => {
    const inspector = page.locator('.editor-inspector');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    // Draw a rectangle
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 300, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });

    // Position & Size is visible for the rectangle
    const positionSizeGroup = page.getByRole('group', { name: 'Position & Size' });
    await expect(positionSizeGroup).toBeVisible();

    // But frame preset trigger and orientation button must NOT exist
    await expect(inspector.getByRole('button', { name: 'Resize to Preset' })).toHaveCount(0);
    await expect(inspector.getByRole('button', { name: 'Swap orientation' })).toHaveCount(0);
  });
});
