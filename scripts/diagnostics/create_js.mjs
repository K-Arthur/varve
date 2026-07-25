import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Use JS to directly trigger file creation - bypass the dialog layout issue
await page.evaluate(() => {
  // Find the Create button and dispatch a real click event
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if (btn.textContent?.trim() === 'Create') {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      break;
    }
  }
});
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/editor_final.png', fullPage: false });
console.log('Editor screenshot saved');

// Check what's on screen now
const info = await page.evaluate(() => {
  const results = {};
  results.url = window.location.href;
  results.hasCanvas = !!document.querySelector('canvas');

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
          c.includes('floating') ||
          c.includes('grid') ||
          c.includes('panel'))
      ) {
        allClasses.add(c);
      }
    });
  });
  results.classes = [...allClasses].sort();
  return results;
});
console.log('Info:', JSON.stringify(info, null, 2));

await browser.close();
