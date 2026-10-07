import { expect, test } from '@playwright/test';

for (const theme of ['light', 'dark', 'high-contrast'] as const) {
  test(`project controls are styled and usable in ${theme}`, async ({ page }, testInfo) => {
    await page.setViewportSize({ width: 1280, height: 720 });
    await page.addInitScript((value) => localStorage.setItem('varve-theme', value), theme);
    await page.goto('/');
    await expect(page.locator('.varve-home')).toBeVisible({ timeout: 90_000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme);

    const heading = page.locator('.sidebar-section__header');
    await expect(heading).toContainText('Projects');
    await expect(heading).toHaveCSS('text-transform', 'none');
    const alignment = await page.locator('.varve-home__sidebar').evaluate((sidebar) => {
      const left = (selector: string) =>
        sidebar.querySelector(selector)!.getBoundingClientRect().left;
      return {
        projects: left('.sidebar-section__header .varve-disclosure__label'),
        search: left('.sidebar-search input'),
        navigation: left('.sidebar-item__icon'),
        empty: left('.sidebar-projects-empty p'),
        create: left('.sidebar-item--new-project'),
      };
    });
    for (const inset of [
      alignment.search,
      alignment.navigation,
      alignment.empty,
      alignment.create,
    ]) {
      expect(Math.abs(alignment.projects - inset)).toBeLessThanOrEqual(1);
    }
    await page.locator('.varve-home__sidebar').screenshot({
      path: testInfo.outputPath(`project-sidebar-${theme}.png`),
    });
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'New Project', exact: true });
    const input = dialog.getByRole('textbox', { name: 'Project name', exact: true });
    const create = dialog.getByRole('button', { name: 'Create', exact: true });
    await expect(dialog).toBeVisible();
    await expect(input).toBeFocused();
    await expect(create).toBeDisabled();
    // Locator screenshots wait for stable geometry before measuring the
    // dialog's animated entry; no fixed delay or reduced-motion override.
    await dialog.screenshot({ path: testInfo.outputPath(`project-dialog-empty-${theme}.png`) });

    const layout = await dialog.evaluate((element) => {
      const field = element.querySelector<HTMLInputElement>('#new-project-name')!;
      const label = element.querySelector('label')!;
      const actions = element.querySelector<HTMLElement>('.varve-home__new-project-actions')!;
      const button = actions.querySelector<HTMLButtonElement>('.varve-home__new-project-confirm')!;
      const style = getComputedStyle(field);
      return {
        dialog: element.getBoundingClientRect().toJSON(),
        input: field.getBoundingClientRect().toJSON(),
        label: label.getBoundingClientRect().toJSON(),
        actions: actions.getBoundingClientRect().toJSON(),
        button: button.getBoundingClientRect().toJSON(),
        padding: Number.parseFloat(style.paddingLeft),
        radius: Number.parseFloat(style.borderTopLeftRadius),
        background: style.backgroundColor,
      };
    });
    expect(layout.input.width).toBeGreaterThan(200);
    expect(layout.input.height).toBeGreaterThanOrEqual(32);
    expect(layout.padding).toBeGreaterThanOrEqual(8);
    expect(layout.radius).toBeGreaterThanOrEqual(4);
    expect(layout.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(layout.label.bottom).toBeLessThanOrEqual(layout.input.top);
    expect(layout.input.bottom).toBeLessThanOrEqual(layout.actions.top);
    expect(layout.button.height).toBeGreaterThanOrEqual(32);
    expect(layout.button.right).toBeLessThanOrEqual(layout.dialog.right);

    const projectName = `Project review ${theme} β`;
    await input.fill(projectName);
    await expect(create).toBeEnabled();
    await page.screenshot({ path: testInfo.outputPath(`project-dialog-${theme}.png`) });
    await create.click();
    await expect(dialog).not.toBeVisible();
    await expect(
      page.locator('.varve-home__sidebar').getByText(projectName, { exact: true }),
    ).toBeVisible();
    await page.getByRole('button', { name: 'New project', exact: true }).click();
    await expect(input).toHaveValue('');
    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    await expect(dialog).not.toBeVisible();
  });
}
