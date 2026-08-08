/**
 * Debug: capture console errors when creating a variable.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('debug variable creation crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await navigateToEditor(page);

  await page.getByTestId('layers-panel').getByRole('button', { name: '+ Add' }).click();
  const nameInput = page.getByRole('textbox', { name: /name/i });
  await nameInput.fill('TestColor');
  const valueInput = page.getByRole('textbox', { name: /value/i });
  await valueInput.fill('#39d0c6');
  await valueInput.press('Enter');
  await page.waitForTimeout(1000);

  const state = await page.evaluate(() => ({
    errorBoundary: document.body.innerText.includes('Something went wrong'),
    bodyText: document.body.innerText.slice(0, 300),
  }));

  console.log('ERRORS:', JSON.stringify(errors));
  console.log('STATE:', JSON.stringify(state));
  expect(true).toBe(true);
});
