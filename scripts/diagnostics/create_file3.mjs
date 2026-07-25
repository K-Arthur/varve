import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Click "New File" button in toolbar
await page.locator('button:has-text("New File")').click();
await page.waitForTimeout(1000);

// Force-click Create button
await page.locator('button:has-text("Create")').first().click({ force: true });
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/editor_full.png', fullPage: false });
console.log('Editor screenshot saved');

// Check editor structure
const info = await page.evaluate(() => {
  const results = {};
  const allClasses = new Set();
  document.querySelectorAll('[class]').forEach((el) => {
    el.className.split?.(' ')?.forEach((c) => {
      if (
        c &&
        (c.includes('editor') ||
          c.includes('shell') ||
          c.includes('canvas') ||
          c.includes('layer') ||
          c.includes('inspect') ||
          c.includes('status') ||
          c.includes('toolbar') ||
          c.includes('menubar') ||
          c.includes('tab') ||
          c.includes('floating'))
      ) {
        allClasses.add(c);
      }
    });
  });
  results.classes = [...allClasses].sort();

  const canvas = document.querySelector('canvas');
  results.hasCanvas = !!canvas;
  if (canvas) {
    results.canvasSize = { w: canvas.width, h: canvas.height };
  }

  return results;
});
console.log('Editor info:', JSON.stringify(info, null, 2));

await browser.close();
