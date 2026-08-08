import { chromium } from '@playwright/test';
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';

const BASE = 'http://localhost:1421';
const OUT = join(process.cwd(), 'docs', 'screenshots', 'detach-multi');
mkdirSync(OUT, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();
  await page.goto(BASE + '/', { timeout: 180000, waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem('strata:onboarding', JSON.stringify({ onboardingComplete: true, checklistProgress: ['shape','color','text','group','export'] }));
    indexedDB.deleteDatabase('varve-history');
  });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ state: 'visible', timeout: 180000 });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30000 });
  const dlg = page.locator('dialog[open]');
  const cb = dlg.getByRole('button', { name: /^create design$/i });
  if (await cb.isVisible({ timeout: 10000 }).catch(() => false)) await cb.click({ timeout: 30000 });
  await page.locator('.layers-panel').waitFor({ timeout: 180000 });
  await page.waitForTimeout(1500);

  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 380, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, '01-main-before.png') });

  const popupPromise = context.waitForEvent('page', { timeout: 60000 });
  await page.locator('[data-testid="detach-layers"]').click({ timeout: 15000 });
  const popup = await popupPromise;
  for (let i = 0; i < 12; i++) { await new Promise(r => setTimeout(r, 10000)); if (await popup.locator('.layers-panel').isVisible().catch(() => false)) break; }
  await popup.waitForTimeout(1500);
  await popup.screenshot({ path: join(OUT, '02-popup-layers-only.png') });

  // Move inspector into the same window via the menu
  await page.locator('[data-testid="detach-inspector"]').click({ timeout: 15000 });
  await page.waitForTimeout(800);
  await page.screenshot({ path: join(OUT, '03-detach-menu.png') });
  await page.locator('[data-testid="detach-menu-inspector"] button', { hasText: 'Move to window' }).click({ timeout: 10000 });
  await new Promise(r => setTimeout(r, 5000));
  await popup.screenshot({ path: join(OUT, '04-popup-two-panels.png') });

  // Undo/redo via popup buttons
  await popup.locator('[data-testid="aux-undo"]').click({ timeout: 10000 });
  await new Promise(r => setTimeout(r, 3000));
  await popup.screenshot({ path: join(OUT, '05-popup-after-undo.png') });
  await popup.locator('[data-testid="aux-redo"]').click({ timeout: 10000 });
  await new Promise(r => setTimeout(r, 3000));
  await popup.screenshot({ path: join(OUT, '06-popup-after-redo.png') });

  // Reattach all
  await popup.locator('[data-testid="reattach-panel"]').click({ timeout: 10000 });
  await new Promise(r => setTimeout(r, 6000));
  await page.screenshot({ path: join(OUT, '07-main-reattached.png') });

  await browser.close();
  console.log('captured to', OUT);
}
main().catch(e => { console.error(e); process.exit(1); });
