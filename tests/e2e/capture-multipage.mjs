/**
 * Multipage-program screenshot capture (M5-M14 review): drives the built
 * app through the key workflows and saves screenshots for human review.
 * Defensive: each step is independently waited on; failures are captured
 * as state screenshots rather than aborting the whole run.
 * Run with: node tests/e2e/capture-multipage.mjs
 */
import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';

const OUT = 'reports/multipage-screenshots';
mkdirSync(OUT, { recursive: true });

const browser = await chromium.launch();
const page = await browser.newPage({ viewport: { width: 1440, height: 900 } });
page.on('pageerror', (e) => console.log('PAGE-ERR::', String(e).slice(0, 2000)));

const shot = (name) => page.screenshot({ path: `${OUT}/${name}.png` });

await page.goto('http://localhost:1440/', { timeout: 120000, waitUntil: 'domcontentloaded' });
await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 120000 });
await page.waitForTimeout(1500);
await page.getByRole('button', { name: /^new$/i }).click({ force: true });
await page.locator('dialog[open]').waitFor({ timeout: 30000 });
await page.waitForTimeout(800);
// Print intent creates a PAGED document (M14) — the multipage canvas,
// pages panel, page tool and print overlays all need pages. Open the
// advanced panel and pick the Print intent.
await page
  .locator('dialog[open]')
  .getByText('Advanced settings', { exact: false })
  .first()
  .click({ force: true })
  .catch(() => {});
await page.waitForTimeout(500);
await page
  .locator('dialog[open]')
  .getByRole('radio', { name: /print/i })
  .first()
  .click({ force: true })
  .catch(() => {});
await page.waitForTimeout(400);
await page.locator('dialog[open]').getByRole('button', { name: /create/i }).first().click();
await page.locator('.layers-panel').waitFor({ timeout: 60000 });
const welcome = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
if (await welcome.first().isVisible({ timeout: 5000 }).catch(() => false)) await welcome.first().click();
await page.waitForTimeout(800);
await page
  .locator('.onboarding-checklist button')
  .first()
  .click({ force: true, timeout: 3000 })
  .catch(() => {});
await page.waitForTimeout(800);
await page.getByRole('button', { name: 'Add page' }).first().waitFor({ timeout: 30000 });
await page.waitForTimeout(2500);

// 0. Editor with the Pages panel visible.
await shot('00-editor-with-pages-panel');

// 1. Add pages one at a time, re-querying the button each time.
const canvas = page.locator('canvas.editor-canvas__content-layer');
const box = await canvas.boundingBox();
for (let i = 0; i < 3; i++) {
  const addBtn = page.locator('.pages-panel__add-btn').first();
  const ok = await addBtn
    .click({ timeout: 10000, force: true })
    .then(() => true)
    .catch(() => false);
  if (!ok) {
    await shot(`01-add-page-${i}-failed`);
    break;
  }
  await page.waitForTimeout(500);
}

// Fit all pages (Shift+6) and capture the multipage canvas.
await page.keyboard.press('Shift+6');
await page.waitForTimeout(1000);
await shot('01-multipage-canvas');
console.log('DIAG rows:', await page.locator('.pages-panel__row').count(),
  '| canvas:', await page.locator('canvas.editor-canvas__content-layer').count(),
  '| boundary:', await page.locator('text=Something went wrong').count());

// Content on a couple of pages.
const drag = async (x1, y1, x2, y2) => {
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + (x1 + x2) / 2, box.y + (y1 + y2) / 2);
  await page.mouse.move(box.x + x2, box.y + y2);
  await page.mouse.up();
};
await page.keyboard.press('r');
await drag(120, 120, 260, 220);
await page.keyboard.press('o');
await drag(280, 120, 400, 220);
await page.waitForTimeout(800);
await shot('02-pages-with-content');
console.log('DIAG after draw: canvas =', await page.locator('canvas.editor-canvas__content-layer').count(),
  '| boundary =', await page.locator('text=Something went wrong').count(),
  '| treeitems =', await page.getByRole('treeitem').count());

// 2. Pages panel rows.
await page.keyboard.press('v');
await page.waitForTimeout(600);
await shot('03-pages-panel');

// 3. Page tool with distinct handles (clear the node selection first so
// the page-focused inspector renders).
await page.keyboard.press('Escape');
await page.waitForTimeout(400);
await page.keyboard.press('q');
await page.waitForTimeout(600);
await shot('04-page-tool-handles');
console.log('DIAG page tool: overlay =', await page.locator('.page-tool-overlay').count(),
  '| print section =', await page.locator('.page-print').count(),
  '| thread overlay =', await page.locator('.text-thread-overlay').count(),
  '| boundary =', await page.locator('text=Something went wrong').count());

// 4. Page-focused inspector (print geometry controls).
await page.waitForTimeout(400);
await shot('05-page-print-inspector');

// 5. Print workspace + master creation.
await page.getByRole('radio', { name: /print workspace/i }).click().catch(() => {});
await page.waitForTimeout(1200);
await page.getByRole('menuitem', { name: 'Page' }).click().catch(() => {});
await page.getByRole('menuitem', { name: /create master/i }).click().catch(() => {});
await page.waitForTimeout(800);
await shot('06-print-workspace-master');

// 6. Thread overlay: two text frames + link command (Ctrl+Shift+K).
await page.getByRole('radio', { name: /design workspace/i }).click().catch(() => {});
await page.waitForTimeout(800);
await page.keyboard.press('t');
await drag(100, 480, 400, 540);
await page.keyboard.press('Escape');
await page.waitForTimeout(300);
await page.keyboard.press('t');
await drag(100, 550, 400, 610);
await page.keyboard.press('Escape');
await page.waitForTimeout(800);
// Marquee-select both text frames on the canvas, then link them into a
// story (Ctrl+Shift+K).
await page.keyboard.press('v');
await page.mouse.move(box.x + 40, box.y + 440);
await page.mouse.down();
await page.mouse.move(box.x + 460, box.y + 660);
await page.mouse.up();
await page.waitForTimeout(600);
await page.keyboard.press('Control+Shift+K');
await page.waitForTimeout(1200);
await page.waitForTimeout(1000);
await shot('07-text-thread-overlay');
console.log('DIAG thread: overlay =', await page.locator('.text-thread-overlay').count(),
  '| treeitems =', await page.getByRole('treeitem').count(),
  '| boundary =', await page.locator('text=Something went wrong').count());

await browser.close();
console.log('captures written to', OUT);
