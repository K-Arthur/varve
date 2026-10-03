import { expect, test } from '@playwright/test';
import { importImageFile } from '../helpers/editor-helpers';
import { navigateToCleanEditor } from '../helpers/nav';

test('authored palette, matching metric and seed survive save and browser reopen', async ({
  page,
}, testInfo) => {
  await navigateToCleanEditor(page);
  await importImageFile(page);
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.getByRole('combobox', { name: 'Add Object Filter' }).click();
  await page.getByRole('option', { name: 'Palette Snap', exact: true }).click();
  const colors = page.getByRole('textbox', { name: 'Palette colors, one per line (r g b)' });
  await colors.fill('13 27 219\n240 182 11');
  await colors.blur();
  await page.getByRole('combobox', { name: 'Color metric', exact: true }).click();
  await page.getByRole('option', { name: 'Lab', exact: true }).click();
  const seed = page.getByRole('spinbutton', { name: 'Palette snap seed', exact: true });
  await seed.fill('4294967295');
  await seed.blur();
  await expect(colors).toHaveValue('13 27 219\n240 182 11');
  const countPalettePixels = () =>
    page.locator('canvas.editor-canvas__content-layer').evaluate((el) => {
      const canvas = el as HTMLCanvasElement;
      const pixels = canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data;
      let count = 0;
      for (let i = 0; i < pixels.length; i += 4) {
        if (
          pixels[i] === 13 &&
          pixels[i + 1] === 27 &&
          pixels[i + 2] === 219 &&
          pixels[i + 3] === 255
        )
          count++;
      }
      return count;
    });
  await expect.poll(countPalettePixels).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath('palette-before-reopen.png') });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  await page.reload({ timeout: 120000 });
  const recovery = page.locator('dialog.crash-dialog[open]');
  if (await recovery.isVisible()) {
    await recovery
      .getByRole('button', { name: /review my documents|close/i })
      .first()
      .click();
  }
  await page.locator('.varve-home').waitFor({ timeout: 45000 });
  await page.getByRole('gridcell').first().dblclick();
  await page.locator('.layers-panel').waitFor({ timeout: 60000 });
  await page.getByRole('treeitem').first().click();
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  // Reopening a document restores filter data, while its parameter editor
  // stays closed until the user explicitly requests it.
  await page
    .getByRole('list', { name: 'Object Filter stack', exact: true })
    .getByRole('button', { name: 'Palette Snap', exact: true })
    .click();
  await expect(
    page.getByRole('dialog', { name: 'Palette Snap parameters', exact: true }),
  ).toBeVisible();
  await expect(colors).toHaveValue('13 27 219\n240 182 11');
  await expect(seed).toHaveValue('4294967295');
  await expect(page.getByRole('combobox', { name: 'Color metric', exact: true })).toContainText(
    'Lab',
  );
  await expect.poll(countPalettePixels).toBeGreaterThan(10);
  await page.screenshot({ path: testInfo.outputPath('palette-after-reopen.png') });
});
