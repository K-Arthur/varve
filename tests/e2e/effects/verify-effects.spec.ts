import { test, expect } from '@playwright/test';
import { mkdirSync } from 'fs';

const DIR = '/tmp/e2e-effects';

test('visual verification of effects pipeline', async ({ page }) => {
  mkdirSync(DIR, { recursive: true });

  // Navigate and wait for app to fully load
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.locator('dialog').getByRole('button', { name: /^create$/i }).waitFor({ timeout: 10000 });
  await page.locator('dialog').getByRole('button', { name: /^create$/i }).click();
  await page.locator('.layers-panel').waitFor({ timeout: 15000 });

  // Dismiss welcome
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (await welcomeClose.first().isVisible({ timeout: 2000 }).catch(() => false)) {
    await welcomeClose.first().click();
  }
  await page.waitForTimeout(1000);

  // Screenshot 1: Blank editor
  await page.screenshot({ path: `${DIR}/01-editor-blank.png`, fullPage: true });

  // Draw a rectangle
  await page.getByRole('button', { name: /rect/i }).first().click();
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 500, box.y + 400, { steps: 10 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.waitForTimeout(500);

  // Screenshot 2: Shape drawn
  await page.screenshot({ path: `${DIR}/02-shape-drawn.png`, fullPage: true });

  // Check canvas has content
  const canvasInfo = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    if (!c) return null;
    const ctx = c.getContext('2d')!;
    const center = ctx.getImageData(c.width / 2, c.height / 2, 1, 1).data;
    return {
      size: { w: c.width, h: c.height },
      centerPixel: [center[0], center[1], center[2], center[3]],
      hasContent: center[0] > 0 || center[1] > 0 || center[2] > 0,
    };
  });
  console.log('Canvas info:', JSON.stringify(canvasInfo));
  expect(canvasInfo).not.toBeNull();
  expect(canvasInfo!.hasContent).toBe(true);

  // Verify layers panel has a shape row
  const layerCount = await page.locator('.layers-row').count();
  console.log('Layer rows:', layerCount);
  expect(layerCount).toBeGreaterThan(0);

  // Verify inspector is visible (right panel)
  const inspectorVisible = await page.evaluate(() => {
    return document.querySelector('.insp-panel, [class*="properties-panel"]') !== null;
  });
  console.log('Inspector visible:', inspectorVisible);

  // Screenshot 3: Zoomed canvas
  await page.screenshot({
    path: `${DIR}/03-canvas-zoomed.png`,
    clip: { x: box.x, y: box.y, width: box.width, height: box.height },
  });
});
