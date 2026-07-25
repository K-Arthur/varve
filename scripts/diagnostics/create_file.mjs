import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1000);

// Click "New File" button in toolbar
await page.locator('button:has-text("New File")').click();
await page.waitForTimeout(500);

// Click "Blank" preset
await page
  .locator('.preset-card:has-text("Blank"), [class*="preset"]:has-text("Blank")')
  .first()
  .click();
await page.waitForTimeout(300);

// Click "Create" button
await page.locator('button:has-text("Create")').click();
await page.waitForTimeout(3000);

await page.screenshot({ path: '/tmp/editor_full.png', fullPage: false });
console.log('Editor screenshot saved');

// Check editor shell structure
const structure = await page.evaluate(() => {
  const results = {};

  // Find all top-level editor elements
  const allClasses = new Set();
  document.querySelectorAll('[class]').forEach((el) => {
    el.className.split(' ').forEach((c) => {
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
          c.includes('tab'))
      ) {
        allClasses.add(c);
      }
    });
  });
  results.editorClasses = [...allClasses].sort();

  // Check canvas
  const canvas = document.querySelector('canvas');
  if (canvas) {
    const cs = getComputedStyle(canvas.parentElement || canvas);
    results.canvas = {
      width: canvas.width,
      height: canvas.height,
      parentBg: cs.background?.substring(0, 80),
    };
  }

  // Check main layout
  const main = document.querySelector('[class*="editor-shell"], [class*="EditorShell"]');
  if (main) {
    const cs = getComputedStyle(main);
    results.mainLayout = {
      display: cs.display,
      grid: cs.gridTemplateColumns?.substring(0, 120),
      height: cs.height,
    };
  }

  // Get all top-level children of root
  const root = document.getElementById('root');
  if (root) {
    results.rootChildren = Array.from(root.children).map((c) => ({
      tag: c.tagName,
      class: c.className?.substring?.(0, 80),
    }));
  }

  return results;
});
console.log('Editor structure:', JSON.stringify(structure, null, 2));

await browser.close();
