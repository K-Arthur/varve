import { chromium } from '@playwright/test';

const browser = await chromium.launch();
const page = await browser.newPage();
await page.goto('http://localhost:1438/', { timeout: 240000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ state: 'visible', timeout: 240000 });
await page.getByRole('button', { name: /^new$/i }).click({ timeout: 60000 });
await page
  .locator('dialog[open]')
  .getByRole('button', { name: /^create design$/i })
  .waitFor({ timeout: 60000 });
await page
  .locator('dialog[open]')
  .getByRole('button', { name: /^create design$/i })
  .click({ timeout: 60000 });
await page.locator('.layers-panel').waitFor({ timeout: 240000 });
console.log('WARMED');
await browser.close();
