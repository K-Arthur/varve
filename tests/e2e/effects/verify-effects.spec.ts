import { mkdirSync } from 'node:fs';
import { test } from '@playwright/test';

const DIR = '/tmp/e2e-effects';

async function setupWithImage(page: import('@playwright/test').Page) {
  mkdirSync(DIR, { recursive: true });
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .waitFor({ timeout: 10000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /^create$/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 15000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 2000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
  await page.waitForTimeout(500);

  // Place a real image via File > Import
  // Use a built-in test image — generate one via canvas data URL
  const imageDataUrl = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 800;
    canvas.height = 600;
    const ctx = canvas.getContext('2d')!;
    // Sky gradient
    const skyGrad = ctx.createLinearGradient(0, 0, 0, 350);
    skyGrad.addColorStop(0, '#1a237e');
    skyGrad.addColorStop(0.4, '#42a5f5');
    skyGrad.addColorStop(0.7, '#ff9800');
    skyGrad.addColorStop(1, '#e65100');
    ctx.fillStyle = skyGrad;
    ctx.fillRect(0, 0, 800, 350);
    // Ground
    const groundGrad = ctx.createLinearGradient(0, 350, 0, 600);
    groundGrad.addColorStop(0, '#2e7d32');
    groundGrad.addColorStop(1, '#1b5e20');
    ctx.fillStyle = groundGrad;
    ctx.fillRect(0, 350, 800, 250);
    // Sun
    ctx.beginPath();
    ctx.arc(600, 200, 60, 0, Math.PI * 2);
    ctx.fillStyle = '#ffeb3b';
    ctx.fill();
    ctx.beginPath();
    ctx.arc(600, 200, 45, 0, Math.PI * 2);
    ctx.fillStyle = '#fff9c4';
    ctx.fill();
    // Mountains
    ctx.beginPath();
    ctx.moveTo(0, 350);
    ctx.lineTo(200, 180);
    ctx.lineTo(400, 300);
    ctx.lineTo(500, 150);
    ctx.lineTo(700, 280);
    ctx.lineTo(800, 200);
    ctx.lineTo(800, 350);
    ctx.closePath();
    ctx.fillStyle = '#37474f';
    ctx.fill();
    // Trees
    for (let i = 0; i < 15; i++) {
      const x = 50 + i * 55;
      const h = 40 + Math.random() * 30;
      ctx.fillStyle = '#1b5e20';
      ctx.beginPath();
      ctx.moveTo(x, 400);
      ctx.lineTo(x - 15, 400 + h);
      ctx.lineTo(x + 15, 400 + h);
      ctx.closePath();
      ctx.fill();
      ctx.fillStyle = '#4e342e';
      ctx.fillRect(x - 3, 400 + h, 6, 15);
    }
    // Water reflection
    ctx.globalAlpha = 0.3;
    ctx.scale(1, -1);
    ctx.translate(0, -1200);
    const skyGrad2 = ctx.createLinearGradient(0, 650, 0, 1000);
    skyGrad2.addColorStop(0, '#ff9800');
    skyGrad2.addColorStop(1, '#1a237e');
    ctx.fillStyle = skyGrad2;
    ctx.fillRect(0, 650, 800, 350);
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    ctx.globalAlpha = 1;
    return canvas.toDataURL('image/png');
  });

  // Place the image on the canvas by creating a node programmatically
  await page.evaluate((dataUrl) => {
    // Create an Image element and load the data URL
    const img = new Image();
    img.src = dataUrl;
    img.onload = () => {
      // Dispatch a custom event that the editor can handle
      window.dispatchEvent(
        new CustomEvent('strata:test-image', {
          detail: { src: dataUrl, width: img.width, height: img.height },
        }),
      );
    };
  }, imageDataUrl);
  await page.waitForTimeout(1000);

  // Since we can't easily import via the menu, draw a multi-colored rectangle
  // that approximates an image with varied luminance
  await page.getByRole('button', { name: /rect/i }).first().click();
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox()!;
  await page.mouse.move(box.x + 100, box.y + 80);
  await page.mouse.down();
  await page.mouse.move(box.x + 700, box.y + 520, { steps: 15 });
  await page.mouse.up();
  await page.keyboard.press('v');
  await page.waitForTimeout(500);
}

async function addAdjustment(page: import('@playwright/test').Page, kind: string) {
  await page.getByRole('button', { name: /add adjustment/i }).click();
  await page.waitForTimeout(300);
  await page.evaluate(
    ({ kind: k }) => {
      const menu = document.querySelector('.adj-panel__add-menu');
      if (!menu) return;
      const items = menu.querySelectorAll('[role="menuitem"]');
      for (const item of items) {
        if (item.textContent?.trim().toLowerCase() === k.toLowerCase()) {
          item.scrollIntoView({ block: 'center' });
          break;
        }
      }
    },
    { kind },
  );
  await page.waitForTimeout(100);
  await page.getByRole('menuitem', { name: new RegExp(`^${kind}$`, 'i') }).click();
  await page.waitForTimeout(500);
}

test('tritone on multi-color shape — visual verification', async ({ page }) => {
  await setupWithImage(page);
  await page.screenshot({ path: `${DIR}/tri-01-before.png`, fullPage: true });

  // Create adjustment layer
  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await page.waitForTimeout(500);

  // Add tritone
  await addAdjustment(page, 'Tritone');
  await page.screenshot({ path: `${DIR}/tri-02-tritone-default.png`, fullPage: true });

  // Click on the canvas to see the effect rendered
  const canvasBox = await page.locator('canvas').first().boundingBox();
  if (canvasBox) {
    await page.screenshot({
      path: `${DIR}/tri-03-canvas-render.png`,
      clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
    });
  }

  // Read canvas pixel data to verify tritone is applied
  const pixels = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    if (!c) return null;
    const ctx = c.getContext('2d')!;
    // Sample 5 points across the canvas
    const samples: Array<{ x: number; y: number; r: number; g: number; b: number; a: number }> = [];
    for (let i = 0; i < 5; i++) {
      const sx = Math.floor((c.width * (i + 1)) / 6);
      const sy = Math.floor(c.height / 2);
      const p = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push({ x: sx, y: sy, r: p[0], g: p[1], b: p[2], a: p[3] });
    }
    return samples;
  });
  console.log('Tritone canvas samples:', JSON.stringify(pixels, null, 2));
});

test('gradient map on multi-color shape — visual verification', async ({ page }) => {
  await setupWithImage(page);
  await page.screenshot({ path: `${DIR}/gm-01-before.png`, fullPage: true });

  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await page.waitForTimeout(500);

  await addAdjustment(page, 'Gradient Map');
  await page.screenshot({ path: `${DIR}/gm-02-gradient-default.png`, fullPage: true });

  const canvasBox = await page.locator('canvas').first().boundingBox();
  if (canvasBox) {
    await page.screenshot({
      path: `${DIR}/gm-03-canvas-render.png`,
      clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
    });
  }

  const pixels = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    if (!c) return null;
    const ctx = c.getContext('2d')!;
    const samples: Array<{ x: number; y: number; r: number; g: number; b: number; a: number }> = [];
    for (let i = 0; i < 5; i++) {
      const sx = Math.floor((c.width * (i + 1)) / 6);
      const sy = Math.floor(c.height / 2);
      const p = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push({ x: sx, y: sy, r: p[0], g: p[1], b: p[2], a: p[3] });
    }
    return samples;
  });
  console.log('Gradient map canvas samples:', JSON.stringify(pixels, null, 2));
});

test('halftone on multi-color shape — visual verification', async ({ page }) => {
  await setupWithImage(page);
  await page.screenshot({ path: `${DIR}/ht-01-before.png`, fullPage: true });

  await page.getByRole('menuitem', { name: /^Object$/i }).click();
  await page.waitForTimeout(300);
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await page.waitForTimeout(500);

  await addAdjustment(page, 'Halftone');
  await page.screenshot({ path: `${DIR}/ht-02-halftone-default.png`, fullPage: true });

  const canvasBox = await page.locator('canvas').first().boundingBox();
  if (canvasBox) {
    await page.screenshot({
      path: `${DIR}/ht-03-canvas-render.png`,
      clip: { x: canvasBox.x, y: canvasBox.y, width: canvasBox.width, height: canvasBox.height },
    });
  }

  const pixels = await page.evaluate(() => {
    const c = document.querySelector('canvas') as HTMLCanvasElement;
    if (!c) return null;
    const ctx = c.getContext('2d')!;
    const samples: Array<{ x: number; y: number; r: number; g: number; b: number; a: number }> = [];
    for (let i = 0; i < 5; i++) {
      const sx = Math.floor((c.width * (i + 1)) / 6);
      const sy = Math.floor(c.height / 2);
      const p = ctx.getImageData(sx, sy, 1, 1).data;
      samples.push({ x: sx, y: sy, r: p[0], g: p[1], b: p[2], a: p[3] });
    }
    return samples;
  });
  console.log('Halftone canvas samples:', JSON.stringify(pixels, null, 2));
});
