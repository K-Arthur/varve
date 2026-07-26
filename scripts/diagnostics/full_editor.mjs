import { chromium } from 'playwright';

const browser = await chromium.launch({ headless: true });
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

await page.goto('http://localhost:1420');
await page.waitForLoadState('networkidle');
await page.waitForTimeout(1500);

// Step 1: Click "Create your first design"
const createBtn = page.locator('button:has-text("Create your first design")');
if (await createBtn.isVisible()) {
  await createBtn.click();
  await page.waitForTimeout(1000);
}

// Step 2: In the New File dialog, click "Create" button via JS (dialog layout may overlap)
await page.evaluate(() => {
  const btns = document.querySelectorAll('button');
  for (const btn of btns) {
    if (btn.textContent?.trim() === 'Create') {
      btn.dispatchEvent(new MouseEvent('click', { bubbles: true, cancelable: true }));
      return;
    }
  }
});
await page.waitForTimeout(3000);

// Step 3: Dismiss welcome dialog if present
await page.keyboard.press('Escape');
await page.waitForTimeout(1000);

// Step 4: Screenshot the editor
await page.screenshot({ path: '/tmp/editor_session.png', fullPage: false });

// Step 5: Now draw some shapes to see the design
// Click the Rectangle tool (index 2 in toolbar, after select+hand)
const tools = await page.evaluate(() => {
  const btns = document.querySelectorAll('.floating-toolbar__btn');
  return Array.from(btns).map((b, i) => ({
    index: i,
    title: b.getAttribute('title') || b.getAttribute('aria-label') || b.textContent?.trim(),
  }));
});
console.log('Tools:', JSON.stringify(tools));

// Find rect tool
const rectIdx = tools.findIndex((t) => t.title?.toLowerCase().includes('rect'));
if (rectIdx >= 0) {
  await page.locator('.floating-toolbar__btn').nth(rectIdx).click();
  await page.waitForTimeout(300);

  // Draw a rectangle on the canvas
  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 400, box.y + 350, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
}

// Draw an ellipse too
const ellipseIdx = tools.findIndex((t) => t.title?.toLowerCase().includes('ellipse'));
if (ellipseIdx >= 0) {
  await page.locator('.floating-toolbar__btn').nth(ellipseIdx).click();
  await page.waitForTimeout(300);

  const canvas = page.locator('canvas');
  const box = await canvas.boundingBox();
  if (box) {
    await page.mouse.move(box.x + 450, box.y + 180);
    await page.mouse.down();
    await page.mouse.move(box.x + 600, box.y + 320, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(500);
  }
}

await page.waitForTimeout(1000);
await page.screenshot({ path: '/tmp/editor_with_shapes.png', fullPage: false });
console.log('Editor with shapes screenshot saved');

await browser.close();
