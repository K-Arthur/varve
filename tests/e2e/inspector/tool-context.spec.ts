import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * The empty Inspector adapts to the active tool: tools with Inspector content
 * (Frame) show it in place of object properties, tools with Tool Options get a
 * button that opens them, and tools with no settings keep document settings.
 */
async function activateTool(page: Page, key: string) {
  await page.keyboard.press('Escape');
  await page.locator('canvas.editor-canvas__content-layer').focus();
  await page.keyboard.press(key);
}

test.describe('Inspector tool context', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('Frame tool shows presets that place a frame, then its resize row', async ({ page }) => {
    const inspector = page.locator('.editor-inspector');
    // Park the pointer away from the Inspector before the preset list renders.
    await page.mouse.move(0, 0);
    await activateTool(page, 'f');

    const header = page.locator('[data-inspector-context-header="true"]');
    await expect(header).toContainText('Active tool');
    await expect(header).toContainText('Frame');
    await expect(inspector.getByText('No selection')).toHaveCount(0);
    const presets = inspector.getByRole('button', { name: 'Frame Presets', exact: true });
    await expect(presets).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector).toHaveScreenshot('frame-tool-context.png', { animations: 'disabled' });

    await inspector.getByRole('option', { name: /^iPhone SE\b/ }).click();

    // The new frame is selected, so object properties replace the tool context.
    await expect(inspector.getByRole('spinbutton', { name: 'W (px)', exact: true })).toHaveValue(
      '375',
    );
    await expect(inspector.getByRole('spinbutton', { name: 'H (px)', exact: true })).toHaveValue(
      '667',
    );
    const resize = inspector.getByRole('button', { name: 'Resize to Preset', exact: true });
    await expect(resize).toHaveAttribute('aria-expanded', 'false');

    await resize.click();
    await inspector.getByRole('option', { name: /^iPhone 15 Pro(?! Max)\b/ }).click();
    await expect(inspector.getByRole('spinbutton', { name: 'W (px)', exact: true })).toHaveValue(
      '393',
    );
    await expect(inspector.getByRole('spinbutton', { name: 'H (px)', exact: true })).toHaveValue(
      '852',
    );
    await expect(
      inspector.getByRole('button', { name: 'Save current size as preset' }),
    ).toBeVisible();
  });

  test('tools with Tool Options offer a button that opens them', async ({ page }) => {
    await activateTool(page, 't');
    const dialog = page.getByRole('dialog', { name: 'Text tool options' });
    // Text options open automatically; close them, then reopen from the Inspector.
    await expect(dialog).toBeVisible();
    await page.getByRole('button', { name: 'Tool options', exact: true }).click();
    await expect(dialog).toHaveCount(0);

    const header = page.locator('[data-inspector-context-header="true"]');
    await expect(header).toContainText('Text');
    await page.getByRole('button', { name: 'Show text options' }).click();
    await expect(dialog).toBeVisible();
  });

  test('tools without settings keep document settings instead of a dead end', async ({ page }) => {
    const inspector = page.locator('.editor-inspector');
    for (const key of ['r', 'p']) {
      await activateTool(page, key);
      await expect(page.locator('[data-inspector-context-header="true"]')).not.toContainText(
        'Active tool',
      );
      await expect(inspector.getByRole('button', { name: 'Canvas', exact: true })).toBeVisible();
      await expect(inspector.getByText(/open the active tool controls/i)).toHaveCount(0);
    }
  });
});
