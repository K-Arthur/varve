/**
 * Detach-flow screenshot capture (human review) — runs against the
 * isolated worktree server (port 1421).
 *
 * Captures: popup with the real Layers panel, source-hidden main window,
 * and the reattached state with the renamed layer.
 *
 * Run: node tests/e2e/workspace/capture-detach.mjs
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1421';
const OUT_DIR = join(process.cwd(), 'docs', 'screenshots', 'detach-flow');
mkdirSync(OUT_DIR, { recursive: true });

async function main() {
  const browser = await chromium.launch();
  const context = await browser.newContext({ viewport: { width: 1440, height: 900 } });
  const page = await context.newPage();

  await page.goto(BASE + '/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        checklistProgress: ['shape', 'color', 'text', 'group', 'export'],
      }),
    );
  });
  await page
    .getByRole('button', { name: /^new$/i })
    .waitFor({ state: 'visible', timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30_000 });
  const dlg = page.locator('dialog[open]');
  const cb = dlg.getByRole('button', { name: /^create design$/i });
  if (await cb.isVisible({ timeout: 10_000 }).catch(() => false))
    await cb.click({ timeout: 30_000 });
  await page.locator('.layers-panel').waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);

  // Draw a rect so the layer tree has content
  await page.keyboard.press('r');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  await page.mouse.move(box.x + 150, box.y + 150);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 380, { steps: 4 });
  await page.mouse.up();
  await page.waitForTimeout(800);

  // 01: main window with the shape before detach
  await page.screenshot({ path: join(OUT_DIR, '01-main-before-detach.png') });

  // Detach
  const popupPromise = context.waitForEvent('page', { timeout: 60_000 });
  await page.locator('[data-testid="detach-layers"]').click({ timeout: 15_000 });
  const popup = await popupPromise;
  await popup.waitForLoadState('domcontentloaded');

  // 02: popup loading the real layers panel
  let visible = false;
  for (let i = 0; i < 12; i++) {
    await new Promise((r) => setTimeout(r, 10_000));
    visible = await popup
      .locator('.layers-panel')
      .isVisible()
      .catch(() => false);
    if (visible) break;
  }
  await popup.waitForTimeout(1500);
  await popup.screenshot({ path: join(OUT_DIR, '02-popup-layers-panel.png') });
  await page.screenshot({ path: join(OUT_DIR, '03-main-source-hidden.png') });

  // Rename in popup
  await popup.locator('.layers-row').first().dblclick({ timeout: 15_000 });
  await popup.waitForTimeout(600);
  const inp = popup.locator('.layers-row__name-input').first();
  if (await inp.isVisible().catch(() => false)) {
    await inp.fill('Renamed From Popup');
    await inp.press('Enter');
  }
  await popup.waitForTimeout(2000);
  await popup.screenshot({ path: join(OUT_DIR, '04-popup-renamed.png') });

  // Reattach
  await popup.locator('[data-testid="reattach-panel"]').click({ timeout: 15_000 });
  await new Promise((r) => setTimeout(r, 6000));
  await page.waitForTimeout(2000);
  await page.screenshot({ path: join(OUT_DIR, '05-main-reattached-renamed.png') });

  await browser.close();
  console.log('captured to', OUT_DIR);
}

main().catch((e) => {
  console.error(e);
  process.exit(1);
});
