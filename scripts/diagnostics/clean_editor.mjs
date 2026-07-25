import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Create file via JS
await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if (btn.textContent?.trim() === 'Create') {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      break;
    }
  }
});
await page.waitForTimeout(2000);

// Close any welcome/onboarding dialog
await page.evaluate(() => {
  // Try clicking close buttons
  const closeBtns = document.querySelectorAll(
    '[aria-label*="close" i], [aria-label*="Close"], .strata-dialog__close',
  );
  for (const b of closeBtns) b.dispatchEvent(new MouseEvent('click', { bubbles: true }));

  // Also try Escape key
  document.dispatchEvent(new KeyboardEvent('keydown', { key: 'Escape', bubbles: true }));
});
await page.waitForTimeout(1000);

// If there's a "Start from scratch" or "Get started" button, click it
await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    const text = btn.textContent?.trim().toLowerCase();
    if (text === 'start from scratch' || text === 'get started') {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      break;
    }
  }
});
await page.waitForTimeout(2000);

await page.screenshot({ path: '/tmp/editor_clean.png', fullPage: false });
console.log('Clean editor screenshot saved');

await browser.close();
