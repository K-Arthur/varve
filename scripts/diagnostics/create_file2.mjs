import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Click "New File" button in toolbar
await page.locator('button:has-text("New File")').click();
await page.waitForTimeout(1000);

// Get dialog HTML to find correct selectors
const dialogHTML = await page.evaluate(() => {
  const dialog = document.querySelector('[role="dialog"], .strata-dialog');
  if (!dialog) return 'NO DIALOG';
  return dialog.innerHTML.substring(0, 3000);
});
console.log('Dialog HTML:\n', dialogHTML);

// Try clicking the Blank button directly by text
const blankBtn = page.locator('button:has-text("Blank")').first();
if (await blankBtn.isVisible()) {
  await blankBtn.click();
  await page.waitForTimeout(300);
}

// Click Create
const createBtn = page.locator('button:has-text("Create")').first();
if (await createBtn.isVisible()) {
  await createBtn.click();
  await page.waitForTimeout(3000);
}

await page.screenshot({ path: '/tmp/editor_full.png', fullPage: false });
console.log('Editor screenshot saved');

await browser.close();
