import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

// Click the file card to open editor
const fileCard = page.locator('.file-card').first();
if (await fileCard.isVisible()) {
  await fileCard.dblclick();
  await page.waitForTimeout(3000);
}

// Dismiss any welcome dialog
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

await page.screenshot({ path: '/tmp/editor_open.png', fullPage: false });
console.log('Editor open screenshot saved');

// Now draw a rectangle to see the design in action
// Click the Rect tool (should be in floating toolbar)
const _rectBtn = page.locator('.floating-toolbar__btn').nth(0); // First tool is usually select, find rect
await page.waitForTimeout(500);

// Check what tools are available
const tools = await page.evaluate(() => {
  const btns = document.querySelectorAll('.floating-toolbar__btn');
  return Array.from(btns).map((b, i) => ({
    index: i,
    title: b.getAttribute('title') || b.getAttribute('aria-label'),
    active: b.classList.contains('floating-toolbar__btn--active'),
    classes: b.className,
  }));
});
console.log('Tools:', JSON.stringify(tools, null, 2));

await browser.close();
