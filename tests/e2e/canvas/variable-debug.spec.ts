/**
 * Debug: capture console errors when creating a variable.
 */
import { expect, test } from '@playwright/test';
import { addColorVariable, navigateToEditor } from '../shared';

test('debug variable creation crash', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (err) => errors.push(`pageerror: ${err.message}`));
  page.on('console', (msg) => {
    if (msg.type() === 'error') errors.push(`console: ${msg.text()}`);
  });

  await navigateToEditor(page);

  await addColorVariable(page, 'TestColor', '#39d0c6');
  await page.waitForTimeout(1000);

  const state = await page.evaluate(() => ({
    errorBoundary: document.body.innerText.includes('Something went wrong'),
    bodyText: document.body.innerText.slice(0, 300),
  }));

  console.log('ERRORS:', JSON.stringify(errors));
  console.log('STATE:', JSON.stringify(state));
  expect(true).toBe(true);
});
