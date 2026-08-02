import { chromium } from '@playwright/test';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
const logs = [];
page.on('pageerror', (e) => logs.push(`[pageerror] ${String(e).slice(0, 300)}`));
await page.goto('http://localhost:1430/', { timeout: 45000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
await page.getByRole('button', { name: /^new$/i }).click({ force: true, timeout: 20000 });
await page.waitForTimeout(2500);
const state = await page.evaluate(() => {
  const dlg = document.querySelector('dialog[open]');
  return {
    hasDialog: !!dlg,
    dlgText: dlg ? (dlg.innerText || '').slice(0, 200) : '',
    dlgButtons: dlg
      ? [...dlg.querySelectorAll('button')].map((b) => (b.textContent || '').trim().slice(0, 30))
      : [],
    newFileDlg: !!document.querySelector('dialog[open]'),
  };
});
console.log(JSON.stringify(state, null, 1));
console.log('ERRS:', logs.slice(0, 3));
await browser.close();
