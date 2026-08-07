/**
 * Standalone multi-window workspace screenshot capture (human review).
 *
 * Bypasses Playwright's globalSetup (flaky against the shared dev server)
 * and captures all review screenshots into docs/screenshots/multi-window/.
 *
 * Run: node tests/e2e/workspace/capture.mjs
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { chromium } from '@playwright/test';

const BASE = 'http://localhost:1420';
const OUT_DIR = join(process.cwd(), 'docs', 'screenshots', 'multi-window');
mkdirSync(OUT_DIR, { recursive: true });

const THEMES = ['light', 'dark', 'high-contrast'];

async function navigateToEditor(page, theme) {
  await page.goto(`${BASE}/`, { timeout: 180_000, waitUntil: 'domcontentloaded' });
  await page.evaluate(() => {
    localStorage.setItem(
      'strata:onboarding',
      JSON.stringify({
        onboardingComplete: true,
        checklistProgress: ['shape', 'color', 'text', 'group', 'export'],
      }),
    );
  });
  if (theme) {
    await page.evaluate((t) => {
      document.documentElement.dataset.theme = t;
    }, theme);
  }
  await page
    .getByRole('button', { name: /^new$/i })
    .waitFor({ state: 'visible', timeout: 180_000 });
  await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30_000 });
  const dialog = page.locator('dialog[open]');
  const createBtn = dialog.getByRole('button', { name: /^create design$/i });
  if (await createBtn.isVisible({ timeout: 10_000 }).catch(() => false)) {
    await createBtn.click({ timeout: 30_000 });
  }
  await page.locator('.layers-panel').waitFor({ timeout: 180_000 });
  await page.waitForTimeout(1500);
}

async function main() {
  const browser = await chromium.launch();
  for (const theme of THEMES) {
    const page = await browser.newPage({
      viewport: { width: 1440, height: 900 },
      deviceScaleFactor: 2,
    });
    console.log(`Capturing ${theme}...`);
    await navigateToEditor(page, theme);

    // 01 full editor
    await page.screenshot({ path: join(OUT_DIR, `01-full-editor-${theme}.png`) });

    // 02 layers header
    const layersHeader = page.locator('.layers-panel__header');
    if (await layersHeader.isVisible().catch(() => false)) {
      await layersHeader.screenshot({ path: join(OUT_DIR, `02-layers-header-${theme}.png`) });
    }
    // 03 layers detach button (padded crop for reviewability)
    const detachBtn = page.locator('[data-testid="detach-layers"]');
    if (await detachBtn.isVisible().catch(() => false)) {
      await detachBtn.hover().catch(() => {});
      await page.waitForTimeout(300);
      const box = await detachBtn.boundingBox();
      if (box) {
        const pad = 12;
        await page.screenshot({
          path: join(OUT_DIR, `03-layers-detach-btn-${theme}.png`),
          clip: {
            x: Math.max(0, box.x - pad),
            y: Math.max(0, box.y - pad),
            width: box.width + pad * 2,
            height: box.height + pad * 2,
          },
        });
      }
    }

    // 04 inspector header
    const inspTabs = page.locator('.insp-panel__tabs');
    if (await inspTabs.isVisible().catch(() => false)) {
      await inspTabs.screenshot({ path: join(OUT_DIR, `04-inspector-header-${theme}.png`) });
    }

    // 05 detach overlay simulation
    await page.evaluate(() => {
      const overlay = document.createElement('div');
      overlay.id = 'review-detach-overlay';
      Object.assign(overlay.style, {
        position: 'fixed',
        inset: '0',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        background: 'rgba(61, 155, 143, 0.12)',
        border: '3px dashed #3d9b8f',
        borderRadius: '12px',
        margin: '12px',
        zIndex: '99999',
        pointerEvents: 'none',
        fontSize: '15px',
        fontWeight: '600',
        fontFamily: 'system-ui, sans-serif',
      });
      const label = document.createElement('span');
      label.textContent = 'Release to detach panel into new window';
      overlay.appendChild(label);
      document.body.appendChild(overlay);
    });
    await page.waitForTimeout(400);
    await page.screenshot({ path: join(OUT_DIR, `05-detach-overlay-${theme}.png`) });
    await page.evaluate(() => document.getElementById('review-detach-overlay')?.remove());

    // 06 left panel strip (minimap + layers)
    const layersPanel = page.locator('.editor__layers-panel');
    if (await layersPanel.isVisible().catch(() => false)) {
      await layersPanel.screenshot({ path: join(OUT_DIR, `06-layers-panel-${theme}.png`) });
    }

    await page.close();
    console.log(`  done ${theme}`);
  }
  await browser.close();
  console.log('All screenshots captured to docs/screenshots/multi-window/');
}

main().catch((err) => {
  console.error(err);
  process.exit(1);
});
