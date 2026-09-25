import { expect, test } from '@playwright/test';

test.describe('Home command search routing', () => {
  test.beforeEach(async ({ page }) => {
    await page.goto('/e2e.html');
    await expect(page.locator('.varve-home')).toBeVisible();
  });

  test('restores focus on dismiss and navigates to a project from the keyboard', async ({
    page,
  }, testInfo) => {
    const newButton = page.getByRole('button', { name: /^New$/ });
    await newButton.focus();
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: /Search files, projects/ });
    await expect(dialog).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(newButton).toBeFocused();

    await page.keyboard.press('Control+k');
    const input = dialog.getByRole('combobox', { name: 'Search' });
    await input.fill('Marketing');
    const project = dialog.getByRole('option', { name: 'Marketing' });
    await expect(project).toBeVisible();
    const activeProjectId = await input.getAttribute('aria-activedescendant');
    expect(activeProjectId).toMatch(/^search-result-/);
    expect(activeProjectId).toBe(await project.getAttribute('id'));
    await page.screenshot({ path: testInfo.outputPath('home-search-project.png') });
    await input.press('Enter');
    await expect(dialog).toBeHidden();
    await expect(page.getByRole('heading', { level: 1, name: 'Marketing' })).toBeVisible();
    await expect(page.locator('#home-main')).toBeFocused();
  });

  test('creates from a template result and exposes the same template in the gallery', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('Control+k');
    const dialog = page.getByRole('dialog', { name: /Search files, projects/ });
    const input = dialog.getByRole('combobox', { name: 'Search' });
    await input.fill('Brand Starter');
    const templateResult = dialog.getByRole('option', { name: /Brand Starter/ });
    await expect(templateResult).toBeVisible();
    const activeTemplateId = await input.getAttribute('aria-activedescendant');
    expect(activeTemplateId).toMatch(/^search-result-/);
    expect(activeTemplateId).toBe(await templateResult.getAttribute('id'));
    await page.screenshot({ path: testInfo.outputPath('home-search-template.png') });
    await input.press('Enter');
    await expect
      .poll(() =>
        page.evaluate(
          () =>
            (window as Window & { __TEST_LAST_OPENED__?: { name: string } }).__TEST_LAST_OPENED__
              ?.name,
        ),
      )
      .toBe('Brand Starter');

    await page
      .locator('nav[aria-label="File navigation"]')
      .getByRole('button', {
        name: /Templates/,
      })
      .click();
    await expect(page.getByRole('button', { name: /Brand Starter/ })).toBeVisible();
  });
});
