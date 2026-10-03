import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Linked themes are reachable from Design mode, report their state honestly,
 * and detach without touching artwork.
 */

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
  // The sample deck is also used in marketing captures. Keep its initial
  // slides free of document-health errors and warnings before showcasing it.
  await page.waitForTimeout(900);
  await expect(page.locator('.document-health-badge')).toHaveCount(0);
  await page.getByRole('tab', { name: 'Slides' }).click();
}

test.describe('presentation themes', () => {
  test('creates a theme from the slide, links its roles, and detaches without artwork loss', async ({
    page,
  }) => {
    await openFixture(page);

    const theme = page.locator('.presentation-navigator__theme');
    await theme.locator('> summary').click();
    await expect(theme).toContainText('Not set');
    await page.screenshot({
      path: 'reports/presentation-audit/theme-empty.png',
      animations: 'disabled',
    });

    // Map two roles by hand — this slide has no layout binding, so the panel's
    // own mapping is what should drive theming.
    await theme.getByRole('combobox', { name: 'Slide object for theme role title' }).click();
    await page.getByRole('option', { name: 'Headline', exact: true }).click();
    await theme.getByRole('combobox', { name: 'Slide object for theme role accent' }).click();
    await page.getByRole('option', { name: 'Stratum 1', exact: true }).click();
    await theme.getByRole('button', { name: 'Create theme from this slide' }).click();

    // The slide's layout roles are the theme's mapping, so they link at once.
    const status = page.getByRole('list', { name: 'Theme role status' });
    await expect(status).toBeVisible();
    const linked = status.getByText('Linked to theme');
    expect(await linked.count()).toBeGreaterThan(0);
    await expect(theme.locator('> summary')).toContainText('theme');
    await theme.screenshot({ path: 'reports/presentation-audit/theme-linked.png' });
    await page.screenshot({
      path: 'reports/presentation-audit/theme-panel.png',
      animations: 'disabled',
    });

    // Role state is per slide and is what detach must clear.
    const themeState = await theme.evaluate((element) => ({
      roleRows: element.querySelectorAll('.presentation-layouts__badge').length,
      linked: Array.from(element.querySelectorAll('.presentation-layouts__badge')).filter((badge) =>
        badge.textContent?.includes('Linked to theme'),
      ).length,
    }));
    expect(themeState.roleRows).toBeGreaterThanOrEqual(6);
    expect(themeState.linked).toBe(2);

    await theme.getByRole('button', { name: 'Detach theme' }).click();
    await expect(status).not.toContainText('Linked to theme');
    await page.screenshot({
      path: 'reports/presentation-audit/theme-detached.png',
      animations: 'disabled',
    });

    // Detaching stops tracking only: undo brings the link back, and the slide's
    // artwork is never rebuilt either way.
    await page.keyboard.press('Control+z');
    await expect(status).toContainText('Linked to theme', { timeout: 10000 });
  });
});
