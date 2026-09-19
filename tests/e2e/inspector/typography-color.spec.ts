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

  // The row is a view of the fill: trigger named, hex shown, and the face
  // paints exactly the colour the pill announces.
  const trigger = typography.getByRole('button', { name: 'Text colour' });
  await expect(trigger).toBeVisible();
  await expect(trigger).toContainText(/#[0-9a-f]{6}/i);
  await expectSwatchMatchesValue(trigger);

  // Editing opens the same colour picker the paint rows use.
  await trigger.click();
  const dialog = page.getByRole('dialog', { name: /pick text colour/i });
  await expect(dialog).toBeVisible({ timeout: 10_000 });
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden({ timeout: 10_000 });

  // The Fill section keeps its own colour entry (no capability moved) and its
  // face paints the same colour.
  const fillSection = page.locator('[data-section-id="fills"]');
  await expect(fillSection).toBeVisible();
  const fillTrigger = fillSection.getByRole('button', { name: /fill colour$/i }).first();
  await expect(fillTrigger).toBeVisible();
  await expectSwatchMatchesValue(fillTrigger);
});

/**
 * The swatch face must visually match the value the pill prints: the face's
 * computed background converts back to the same RGB as the hex/value text.
 */
async function expectSwatchMatchesValue(trigger: import('@playwright/test').Locator) {
  const face = trigger.locator('.insp-swatch__face');
  const valueText = trigger.locator('.insp-swatch__value');
  await expect(face).toBeVisible();
  const [background, value] = await Promise.all([
    face.evaluate((element) => getComputedStyle(element).backgroundColor),
    valueText.textContent(),
  ]);
  const hex = (value ?? '').trim();
  const match = /^#([0-9a-f]{6})$/i.exec(hex);
  if (!match) throw new Error(`Expected a solid hex value, received "${hex}"`);
  const r = Number.parseInt(match[1]!.slice(0, 2), 16);
  const g = Number.parseInt(match[1]!.slice(2, 4), 16);
  const b = Number.parseInt(match[1]!.slice(4, 6), 16);
  expect(background).toBe(`rgb(${r}, ${g}, ${b})`);
}
