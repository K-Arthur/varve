import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Deck-wide slide size conversion is previewed, applied as one undoable step,
 * and never stretches without the user choosing that mode.
 *
 * The reference deck is 1280×720, so a 4:3 conversion is unambiguous: the slide
 * becomes 1440×1080, content scales uniformly and is centred, and undo returns
 * the deck to 1280×720 with the artwork intact.
 */

const SIZE_SUMMARY = '.presentation-navigator__size > summary';

async function openFixture(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
  await navigateToEditor(page);
  await page.setInputFiles(
    '#file-open-input',
    resolve(process.cwd(), 'scripts/screenshots/fixtures/presentation.varve'),
  );
  await expect(page.locator('.editor-shell h1.sr-only')).toContainText('presentation.varve', {
    timeout: 30000,
  });
  await page.getByRole('tab', { name: 'Slides' }).click();
}

test.describe('presentation slide size', () => {
  test('converts 16:9 to 4:3 after a preview and restores the deck on undo', async ({ page }) => {
    await openFixture(page);
    await expect(page.locator(SIZE_SUMMARY)).toContainText('1280 x 720');

    await page.locator('.presentation-navigator__size > summary').click();
    await page.getByRole('combobox', { name: 'Slide size preset' }).selectOption('classic');
    await page.getByRole('combobox', { name: 'Slide size mode' }).selectOption('fit');
    await page.getByRole('button', { name: 'Review slide size change…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Review slide size change' });
    await expect(dialog).toBeVisible();
    await expect(dialog).toContainText('1280 x 720');
    await expect(dialog).toContainText('1440 x 1080');
    await expect(dialog).toContainText('one undo step');
    await expect(dialog).toContainText('Frames keep their position on the canvas');
    await page.screenshot({
      path: 'reports/presentation-audit/slide-size-review.png',
      animations: 'disabled',
    });
    await dialog.locator('.presentation-navigator__review').screenshot({
      path: 'reports/presentation-audit/slide-size-review-dialog.png',
    });

    // Preview alone must not have touched the deck.
    await expect(page.locator(SIZE_SUMMARY)).toContainText('1280 x 720');

    await dialog.getByRole('button', { name: 'Change slide size' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(SIZE_SUMMARY)).toContainText('1440 x 1080');
    await page.screenshot({
      path: 'reports/presentation-audit/slide-size-converted.png',
      animations: 'disabled',
    });

    // The declared size is one document step: undo restores it.
    await page.keyboard.press('Control+z');
    await expect(page.locator(SIZE_SUMMARY)).toContainText('1280 x 720', { timeout: 10000 });
  });

  test('warns about the only mode that distorts, and still requires a preview', async ({
    page,
  }) => {
    await openFixture(page);
    await page.locator('.presentation-navigator__size > summary').click();
    await page.getByRole('combobox', { name: 'Slide size preset' }).selectOption('vertical');
    await page.getByRole('combobox', { name: 'Slide size mode' }).selectOption('reflow');
    await page.getByRole('button', { name: 'Review slide size change…' }).click();

    const dialog = page.getByRole('dialog', { name: 'Review slide size change' });
    await expect(dialog).toContainText('1080 x 1920');
    await expect(dialog).toContainText(/Stretching changes proportions/);
    await expect(dialog).toContainText(/content stretches to fill it/);

    // Cancelling leaves the deck exactly as it was.
    await dialog.getByRole('button', { name: 'Cancel' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator(SIZE_SUMMARY)).toContainText('1280 x 720');
    await page.screenshot({
      path: 'reports/presentation-audit/slide-size-stretch-warning.png',
      animations: 'disabled',
    });
  });
});
