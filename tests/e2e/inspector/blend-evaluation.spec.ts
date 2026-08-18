import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('document color settings distinguish working RGB from blend evaluation', async ({ page }) => {
  await navigateToEditor(page);

  await expect(page.getByText('Working RGB', { exact: true })).toBeVisible();
  await expect(page.getByText('Blend evaluation', { exact: true })).toBeVisible();
  await expect(page.getByRole('button', { name: 'Legacy sRGB', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.getByRole('button', { name: 'Linear light', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Linear light', exact: true })).toHaveAttribute(
    'aria-pressed',
    'true',
  );

  await page.screenshot({
    path: '/tmp/opencode/blend-evaluation-settings.png',
    animations: 'disabled',
  });
});
