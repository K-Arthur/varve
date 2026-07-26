import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Click "Create your first design"
const createBtn = page.locator('text=Create your first design');
if (await createBtn.isVisible()) {
  await createBtn.click();
  await page.waitForTimeout(2000);
} else {
  // Try New File button
  const newBtn = page.locator('text=New File');
  if (await newBtn.isVisible()) {
    await newBtn.click();
    await page.waitForTimeout(500);
    // Look for dialog and click first item
    const dialog = page.locator('[role="dialog"], .strata-dialog');
    if (await dialog.isVisible()) {
      await dialog.locator('button').first().click();
      await page.waitForTimeout(2000);
    }
  }
}

await page.screenshot({ path: '/tmp/editor_after_fix.png', fullPage: false });

// Check editor-specific computed styles
const editorStyles = await page.evaluate(() => {
  const results = {};

  // Check shell grid
  const shell = document.querySelector('.editor-shell, [class*="shell"], [class*="Shell"]');
  if (shell) {
    const cs = getComputedStyle(shell);
    results.shell = {
      display: cs.display,
      gridTemplateColumns: cs.gridTemplateColumns?.substring(0, 100),
    };
  }

  // Check canvas area
  const canvas = document.querySelector('canvas');
  if (canvas) {
    results.canvas = { width: canvas.width, height: canvas.height };
  }

  // Check toolbar
  const toolbar = document.querySelector('.editor-toolbar, [class*="toolbar"]');
  if (toolbar) {
    const cs = getComputedStyle(toolbar);
    results.toolbar = { background: cs.background?.substring(0, 80), height: cs.height };
  }

  // Check layers panel
  const layers = document.querySelector('[class*="layers"], [class*="Layers"]');
  if (layers) {
    const cs = getComputedStyle(layers);
    results.layers = { background: cs.background?.substring(0, 80), width: cs.width };
  }

  // Check inspector panel
  const inspector = document.querySelector('[class*="inspector"], [class*="Inspector"]');
  if (inspector) {
    const cs = getComputedStyle(inspector);
    results.inspector = { background: cs.background?.substring(0, 80), width: cs.width };
  }

  // Check status bar
  const status = document.querySelector('[class*="status"], [class*="Status"]');
  if (status) {
    const cs = getComputedStyle(status);
    results.statusBar = { background: cs.background?.substring(0, 80), height: cs.height };
  }

  return results;
});
console.log('Editor styles:', JSON.stringify(editorStyles, null, 2));

await browser.close();
