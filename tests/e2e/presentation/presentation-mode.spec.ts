import { expect, test } from '@playwright/test';

/**
 * Presentation mode is one command with one meaning per document.
 *
 * The generic Present command must present the deck for a deck document, keep
 * prototype playback for a document without one, and report an unusable deck
 * instead of doing nothing. Audience preview keyboard handling is exercised
 * through real key events, including the boundary announcement.
 */

const ANNOUNCER = '#strata-canvas-announcer-polite';

async function createPresentation(page: import('@playwright/test').Page) {
  await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
  await page.goto('/');
  await page.waitForSelector('.varve-home', { timeout: 45000 });
  await page.getByRole('button', { name: /^new$/i }).click({ force: true });
  const creation = page.getByRole('dialog', { name: 'New design' });
  await creation.locator('label.varve-radio').filter({ hasText: 'New presentation' }).click();
  await page
    .getByRole('dialog', { name: 'New presentation' })
    .getByRole('button', {
      name: 'Create presentation',
    })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
}

async function duplicateFirstSlide(page: import('@playwright/test').Page, times: number) {
  await page.getByRole('tab', { name: 'Slides' }).click();
  const slides = page.getByRole('list', { name: 'Slides in presentation order' });
  for (let index = 0; index < times; index += 1) {
    await slides
      .locator(':scope > li')
      .first()
      .getByRole('button', { name: 'Duplicate', exact: true })
      .click();
  }
  await expect(slides.locator(':scope > li')).toHaveCount(times + 1);
}

test.describe('presentation mode routing', () => {
  test('the generic Present command presents the deck, and playback owns the keyboard', async ({
    page,
  }) => {
    await createPresentation(page);
    await duplicateFirstSlide(page, 2);

    await page.keyboard.press('Control+Shift+P');
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    await expect(audience.locator('.presentation-audience__image')).toBeVisible({ timeout: 30000 });
    await expect(audience).toContainText('Slide 1 of 3');
    await page.screenshot({
      path: 'reports/presentation-audit/mode-present-deck.png',
      animations: 'disabled',
    });

    // Playback is a modal surface, so the global shortcut layer is inert and
    // the same chord must not stack a second presenter behind the first.
    await page.keyboard.press('Control+Shift+P');
    await expect(audience).toBeVisible();

    // Escape is the documented exit, alongside the visible Exit control.
    await page.keyboard.press('Escape');
    await expect(audience).toBeHidden();
  });

  test('Escape exits, Space advances, and the final slide is a stated boundary', async ({
    page,
  }) => {
    await createPresentation(page);
    await duplicateFirstSlide(page, 1);

    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience.locator('.presentation-audience__image')).toBeVisible({ timeout: 30000 });
    await expect(audience).toContainText('Slide 1 of 2');

    const stage = audience.locator('.presentation-audience__stage');
    await expect(stage).toBeFocused();

    await page.keyboard.press(' ');
    await expect(audience).toContainText('Slide 2 of 2');
    await expect(audience.getByRole('button', { name: 'Next' })).toBeDisabled();

    // No silent wrap: the boundary is announced and the slide stays put.
    await page.keyboard.press(' ');
    await expect(audience).toContainText('Slide 2 of 2');
    await expect(page.locator(ANNOUNCER)).toHaveText('End of presentation');

    await page.keyboard.press('ArrowLeft');
    await expect(audience).toContainText('Slide 1 of 2');
    await expect(audience.getByRole('button', { name: 'Previous' })).toBeDisabled();
    await page.keyboard.press('ArrowLeft');
    await expect(page.locator(ANNOUNCER)).toHaveText('Start of presentation');

    await page.screenshot({
      path: 'reports/presentation-audit/mode-boundary.png',
      animations: 'disabled',
    });

    await page.keyboard.press('Escape');
    await expect(audience).toBeHidden();
    // Focus returns to the control that opened playback.
    await expect(page.getByRole('button', { name: 'Present', exact: true })).toBeFocused();
  });

  test('an all-skipped deck explains itself instead of presenting nothing', async ({ page }) => {
    await createPresentation(page);
    await page.getByRole('tab', { name: 'Slides' }).click();
    await page
      .getByRole('list', { name: 'Slides in presentation order' })
      .getByRole('button', {
        name: 'Skip',
      })
      .click();
    await expect(page.locator(ANNOUNCER)).toBeAttached();

    await page.keyboard.press('Control+Shift+P');
    await expect(page.locator(ANNOUNCER)).toHaveText(/no includable slides/i);
    await expect(page.getByRole('dialog', { name: /audience preview/ })).toBeHidden();
  });

  test('deck commands are reachable from the command palette and start playback', async ({
    page,
  }) => {
    await createPresentation(page);

    await page.keyboard.press('Control+/');
    const palette = page.getByRole('dialog', { name: 'Command palette' });
    await expect(palette).toBeVisible();
    // The palette filters on label, group and shortcut, so search by the noun
    // that both deck commands share.
    await palette.getByRole('combobox', { name: 'Search commands' }).fill('deck');
    const presentRow = palette.getByRole('option', { name: /Present Deck from Current Slide/ });
    await expect(presentRow).toBeVisible({ timeout: 10000 });
    await expect(palette.getByRole('option', { name: /Export Presentation Deck/ })).toBeVisible();
    await page.screenshot({
      path: 'reports/presentation-audit/mode-palette-commands.png',
      animations: 'disabled',
    });

    await presentRow.click();
    await expect(page.getByRole('dialog', { name: /audience preview/ })).toBeVisible();
  });
});
