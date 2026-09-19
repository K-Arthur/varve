/**
 * Typography colour entry point — text colour is reachable from the
 * Typography section as a view of the same Fill model, without removing the
 * Fill section's stack editor.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function createText(page: import('@playwright/test').Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('canvas not found');
  await page.keyboard.press('t');
  await page.mouse.click(bounds.x + 220, bounds.y + 260);
  await page.keyboard.type('Colour entry');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });
}

test('text colour is editable from Typography and Fill remains the stack editor', async ({
  page,
}) => {
  await navigateToEditor(page);
  await createText(page);

  const typography = page.locator('.typography-controls');
  await expect(typography).toBeVisible();

  // The row is a view of the fill: trigger named, hex shown.
  const trigger = typography.getByRole('button', { name: 'Text colour' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(/#[0-9a-f]{6}/i);

  // Editing opens the same colour picker the paint rows use.
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /pick text colour/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // The Fill section keeps its own colour entry (no capability moved).
  const fillSection = page.locator('[data-section-id="fills"]');
  await expect(fillSection).toBeVisible();
  await expect(fillSection.getByText('Fill', { exact: true }).first()).toBeVisible();
});
