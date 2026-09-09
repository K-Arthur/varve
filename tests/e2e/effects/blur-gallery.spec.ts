import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function openEffectsSection(page: import('@playwright/test').Page) {
  const section = page.locator('.insp-disclosure').filter({ hasText: 'Layer Effects' });
  await expect(section).toBeVisible({ timeout: 10000 });
  const trigger = section.getByRole('button', { name: 'Layer Effects', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return section;
}

async function addEffect(
  page: import('@playwright/test').Page,
  section: import('@playwright/test').Locator,
  label: string,
) {
  await section.getByRole('combobox', { name: 'New effect type' }).click();
  await page.getByRole('option', { name: label, exact: true }).click();
  await section.getByRole('button', { name: 'Add', exact: true }).click();
  await expect(section.locator('.insp-effect-row').filter({ hasText: label })).toBeVisible();
}

test.describe('Blur Gallery authoring overlay', () => {
  test('renders Field Blur controls and commits a real pointer drag', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await page.getByRole('tab', { name: 'Design', exact: true }).click();

    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 150, 520, 390);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Field Blur');

    const overlay = page.getByTestId('blur-gallery-overlay');
    await expect(overlay).toHaveAttribute('data-blur-type', 'fieldBlur');
    const pin = overlay.getByRole('button', { name: /Field blur pin 1/ });
    await expect(pin).toBeVisible();
    const before = await pin.boundingBox();
    if (!before) throw new Error('Field Blur pin did not receive a layout box');

    await page.screenshot({ path: testInfo.outputPath('field-blur-overlay-before.png') });
    await page.mouse.move(before.x + before.width / 2, before.y + before.height / 2);
    await page.mouse.down();
    await expect(overlay).toHaveAttribute('data-blur-dragging', 'true');
    await page.mouse.move(before.x + 90, before.y + 45);
    await page.mouse.up();
    await page.waitForTimeout(350);

    const after = await pin.boundingBox();
    if (!after) throw new Error('Field Blur pin disappeared after dragging');
    expect(after.x).toBeGreaterThan(before.x + 30);
    expect(after.y).toBeGreaterThan(before.y + 10);
    await page.screenshot({ path: testInfo.outputPath('field-blur-overlay-after.png') });
  });
});
