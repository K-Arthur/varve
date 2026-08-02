import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
await page.goto('http://localhost:1430/', { timeout: 45000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 20000 });
await page.waitForTimeout(2000);
const allDialogs = await page.locator('dialog').count();
console.log('dialog count:', allDialogs);
const openDialogs = await page.locator('dialog[open]').count();
console.log('open dialog count:', openDialogs);
const createVisible = await page
  .locator('dialog[open]')
  .getByRole('button', { name: /^create$/i })
  .count();
console.log('create count in open dialog:', createVisible);
const allCreate = await page.getByRole('button', { name: /^create$/i }).count();
console.log('all create buttons:', allCreate);
const firstCreate = page.getByRole('button', { name: /^create$/i }).first();
console.log('create visible?', await firstCreate.isVisible().catch(() => 'err'));
await browser.close();
