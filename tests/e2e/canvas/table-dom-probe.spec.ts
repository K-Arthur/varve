import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test('probe editor errors', async ({ page }) => {
  const errors: string[] = [];
  page.on('pageerror', (e) => errors.push(`PAGE: ${e.message.slice(0, 200)}`));
  page.on('console', (m) => {
    if (m.type() === 'error') errors.push(`CONSOLE: ${m.text().slice(0, 200)}`);
  });
  await navigateToEditor(page);
  await page.waitForTimeout(15000);
  const state = await page.evaluate(() => ({
    canvasCount: document.querySelectorAll('canvas').length,
    contentLayer: !!document.querySelector('canvas.editor-canvas__content-layer'),
    errorText: document.body.innerText.includes('Something went wrong'),
    bodySnippet: document.body.innerText.slice(0, 120),
  }));
  console.log('STATE:', JSON.stringify(state));
  console.log('ERRORS:', JSON.stringify(errors.slice(0, 6)));
  expect(true).toBe(true);
});
