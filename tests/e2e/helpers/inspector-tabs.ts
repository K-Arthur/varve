import { expect, type Page } from '@playwright/test';

/** Select a real inspector tab through its visible tab or overflow menu. */
export async function selectInspectorTab(page: Page, label: string): Promise<void> {
  const inspector = page.getByRole('region', { name: 'Inspector', exact: true });
  const tab = inspector.getByRole('tab', { name: label, exact: true });
  if (await tab.isVisible()) {
    await tab.click();
  } else {
    await inspector.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs', exact: true })
      .getByRole('menuitem', { name: label, exact: true })
      .click();
  }
  await expect(inspector.getByRole('tab', { name: label, exact: true })).toHaveAttribute(
    'aria-selected',
    'true',
  );
}
