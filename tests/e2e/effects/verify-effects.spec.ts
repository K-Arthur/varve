/**
 * Visual verification: captures screenshots of effects in action.
 * Run this first, then review the screenshots.
 */
import { test } from '@playwright/test';
import { mkdirSync } from 'fs';

const DIR = '/tmp/e2e-effects';

test('capture effect screenshots', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });

  // 1. App home page
  await page.goto('/');
  await page.waitForTimeout(3000);
  await page.screenshot({ path: `${DIR}/01-home.png`, fullPage: true });

  // 2. Create new file
  const newBtn = page.getByRole('button', { name: /^new$/i });
  if (await newBtn.isVisible({ timeout: 5000 }).catch(() => false)) {
    await newBtn.click();
    const createBtn = page.locator('dialog').getByRole('button', { name: /^create$/i });
    await createBtn.waitFor({ timeout: 5000 });
    await createBtn.click();
    await page.locator('.layers-panel').waitFor({ timeout: 10000 });
  }

  // Dismiss welcome modal
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (await welcomeClose.first().isVisible({ timeout: 1000 }).catch(() => false)) {
    await welcomeClose.first().click();
  }

  await page.waitForTimeout(1000);
  await page.screenshot({ path: `${DIR}/02-editor-blank.png`, fullPage: true });

  // 3. Draw a rectangle
  await page.getByRole('button', { name: /^rectangle$/i }).click();
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox()!;
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 450, box.y + 350, { steps: 15 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
  await page.screenshot({ path: `${DIR}/03-shape-drawn.png`, fullPage: true });

  // 4. Get a zoomed-in view of just the canvas area
  const canvasBox = await canvas.boundingBox();
  if (canvasBox) {
    await page.screenshot({
      path: `${DIR}/04-canvas-only.png`,
      clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
    });
  }

  // 5. Check what panels/sections are visible
  const panels = await page.evaluate(() => {
    const results: string[] = [];
    document.querySelectorAll('[class*="insp"], [class*="panel"], [class*="layers"], [class*="adjust"]').forEach(el => {
      if (el instanceof HTMLElement && el.offsetHeight > 0) {
        results.push(el.className.split(' ').filter(c => c).slice(0, 3).join(' '));
      }
    });
    return [...new Set(results)];
  });
  console.log('Visible panels:', JSON.stringify(panels, null, 2));

  // 6. Check inspector content
  const inspectorText = await page.evaluate(() => {
    const inspector = document.querySelector('.insp-panel, [class*="properties"], [class*="inspector"]');
    return inspector?.textContent?.slice(0, 500) ?? 'no inspector found';
  });
  console.log('Inspector text:', inspectorText);
});
