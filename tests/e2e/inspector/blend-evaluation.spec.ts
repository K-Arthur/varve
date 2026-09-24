import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('document color settings distinguish working RGB from blend evaluation', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);

  await expect(page.getByText('Working RGB', { exact: true })).toBeVisible();
  await expect(page.getByText('Blend evaluation', { exact: true })).toBeVisible();
  await expect(page.getByRole('radio', { name: 'Legacy sRGB', exact: true })).toBeChecked();

  await page.getByRole('radio', { name: 'Linear light', exact: true }).click();
  await expect(page.getByRole('radio', { name: 'Linear light', exact: true })).toBeChecked();

  await page.screenshot({
    path: testInfo.outputPath('blend-evaluation-settings.png'),
    animations: 'disabled',
  });
});
