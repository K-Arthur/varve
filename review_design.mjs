/**
 * Visual review script — captures Neo-Bento redesign screenshots.
 * Run: node review_design.mjs
 * Requires: dev server on http://localhost:1420
 */

import { mkdir } from 'node:fs/promises';
import { chromium } from 'playwright';

const OUT = '/tmp/strata-review';
await mkdir(OUT, { recursive: true });

const browser = await chromium.launch({ headless: true });

// ── Light mode page ──
const page = await browser.newPage({ viewport: { width: 1400, height: 900 } });

// ── Dark mode page (separate context with dark colorScheme) ──
const darkCtx = await browser.newContext({
  viewport: { width: 1400, height: 900 },
  colorScheme: 'dark',
});
const darkPage = await darkCtx.newPage();

async function shot(name, fn) {
  if (fn) await fn();
  await page.waitForTimeout(400);
  await page.screenshot({ path: `${OUT}/${name}.png` });
  console.log(`✓ ${OUT}/${name}.png`);
}

// ── Navigate to editor (using the same flow as e2e tests) ──
await page.goto('http://localhost:1420');
await page.getByRole('button', { name: /new file/i }).waitFor({ timeout: 10000 });
await page.getByRole('button', { name: /new file/i }).click();
// Dialog: click Create
const createBtn = page.locator('dialog').getByRole('button', { name: /^create$/i });
await createBtn.waitFor({ timeout: 5000 });
await createBtn.click();
// Wait for canvas
await page
  .getByRole('img', { name: 'Design canvas' })
  .waitFor({ timeout: 10000, state: 'visible' });
await page.waitForTimeout(800);

// ── Full editor — dark mode (default) ──
await shot('01-editor-dark-full');

// ── Layers panel ──
const layersPanel = page.locator('.editor__layers-panel, .layers-panel').first();
if (await layersPanel.isVisible()) {
  const box = await layersPanel.boundingBox();
  if (box) {
    await shot('02-layers-panel', async () => {
      await page.screenshot({
        path: `${OUT}/02-layers-panel.png`,
        clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 600) },
      });
    });
  }
}

// ── Inspector panel (empty selection) ──
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
const inspPanel = page.locator('.editor__inspector-panel').first();
if (await inspPanel.isVisible()) {
  const box = await inspPanel.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/03-inspector-empty.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 700) },
    });
    console.log(`✓ ${OUT}/03-inspector-empty.png`);
  }
}

// ── Status bar ──
const statusBar = page.locator('.editor-status').first();
if (await statusBar.isVisible()) {
  const box = await statusBar.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/04-status-bar.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    console.log(`✓ ${OUT}/04-status-bar.png`);
  }
}

// ── Menubar ──
const menubar = page.locator('.editor-menubar').first();
if (await menubar.isVisible()) {
  const box = await menubar.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/05-menubar.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    console.log(`✓ ${OUT}/05-menubar.png`);
  }
}

// ── Page nav ──
const pageNav = page.locator('.page-nav').first();
if (await pageNav.isVisible()) {
  const box = await pageNav.boundingBox();
  if (box) {
    await page.screenshot({
      path: `${OUT}/06-page-nav.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    console.log(`✓ ${OUT}/06-page-nav.png`);
  }
}

// ── Light mode ──
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'light'));
await page.waitForTimeout(300);
await shot('07-editor-light-full');

// ── High contrast ──
await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'high-contrast'));
await page.waitForTimeout(300);
await shot('08-editor-high-contrast-full');

// ── Back to dark ──
await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
await page.waitForTimeout(300);

// ── Draw a rectangle and inspect ──
const canvas = page.locator('.editor-canvas').first();
if (await canvas.isVisible()) {
  // Switch to rect tool via keyboard
  await canvas.click();
  await page.keyboard.press('r');
  await page.waitForTimeout(200);

  // Draw a rectangle
  const canvasBox = await canvas.boundingBox();
  if (canvasBox) {
    const cx = canvasBox.x + canvasBox.width / 2;
    const cy = canvasBox.y + canvasBox.height / 2;
    await page.mouse.move(cx - 60, cy - 40);
    await page.mouse.down();
    await page.mouse.move(cx + 60, cy + 40, { steps: 10 });
    await page.mouse.up();
    await page.waitForTimeout(600);
  }

  await shot('09-editor-with-selection');

  // Inspector with selection
  if (await inspPanel.isVisible()) {
    const box = await inspPanel.boundingBox();
    if (box) {
      await page.screenshot({
        path: `${OUT}/10-inspector-with-selection.png`,
        clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 800) },
      });
      console.log(`✓ ${OUT}/10-inspector-with-selection.png`);
    }
  }
}

// ── Dark mode screenshots ──
console.log('\nCapturing dark mode...');
await darkPage.goto('http://localhost:1420');
await darkPage.getByRole('button', { name: /new file/i }).waitFor({ timeout: 10000 });
await darkPage.getByRole('button', { name: /new file/i }).click();
const darkCreateBtn = darkPage.locator('dialog').getByRole('button', { name: /^create$/i });
await darkCreateBtn.waitFor({ timeout: 5000 });
await darkCreateBtn.click();
await darkPage
  .getByRole('img', { name: 'Design canvas' })
  .waitFor({ timeout: 10000, state: 'visible' });
await darkPage.waitForTimeout(800);
await darkPage.keyboard.press('Escape');
await darkPage.waitForTimeout(400);

await darkPage.screenshot({ path: `${OUT}/11-editor-dark-mode.png` });
console.log(`✓ ${OUT}/11-editor-dark-mode.png`);

// Dark: zoom in on layers panel
const darkLayers = darkPage.locator('.editor__layers-panel').first();
if (await darkLayers.isVisible()) {
  const box = await darkLayers.boundingBox();
  if (box) {
    await darkPage.screenshot({
      path: `${OUT}/12-layers-dark.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 500) },
    });
    console.log(`✓ ${OUT}/12-layers-dark.png`);
  }
}

// Dark: draw rect, then inspect
await darkPage.locator('.editor-canvas').first().click();
await darkPage.keyboard.press('r');
await darkPage.waitForTimeout(200);
const darkCanvasBox = await darkPage.locator('.editor-canvas').first().boundingBox();
if (darkCanvasBox) {
  const cx = darkCanvasBox.x + darkCanvasBox.width / 2;
  const cy = darkCanvasBox.y + darkCanvasBox.height / 2;
  await darkPage.mouse.move(cx - 60, cy - 40);
  await darkPage.mouse.down();
  await darkPage.mouse.move(cx + 60, cy + 40, { steps: 10 });
  await darkPage.mouse.up();
  await darkPage.waitForTimeout(600);
}

const darkInsp = darkPage.locator('.editor__inspector-panel').first();
if (await darkInsp.isVisible()) {
  const box = await darkInsp.boundingBox();
  if (box) {
    await darkPage.screenshot({
      path: `${OUT}/13-inspector-dark.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: Math.min(box.height, 800) },
    });
    console.log(`✓ ${OUT}/13-inspector-dark.png`);
  }
}

// Status bar dark
const darkStatus = darkPage.locator('.editor-status').first();
if (await darkStatus.isVisible()) {
  const box = await darkStatus.boundingBox();
  if (box) {
    await darkPage.screenshot({
      path: `${OUT}/14-statusbar-dark.png`,
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    console.log(`✓ ${OUT}/14-statusbar-dark.png`);
  }
}

await browser.close();
console.log(`\nAll screenshots in: ${OUT}/`);
