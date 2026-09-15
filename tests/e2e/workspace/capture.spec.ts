/**
 * Multi-window workspace screenshot capture — for human visual review.
 *
 * Captures screenshots of every multi-window workspace UI surface and
 * saves them to docs/screenshots/multi-window/ so a human reviewer can
 * inspect them. Unlike visual.spec.ts (golden comparison), this spec
 * is for review only — it never fails on pixel diffs.
 *
 * Run: npx playwright test tests/e2e/workspace/capture.spec.ts --project=chromium
 */

import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { test } from '@playwright/test';

const OUT_DIR = join(process.cwd(), 'docs', 'screenshots', 'multi-window');
mkdirSync(OUT_DIR, { recursive: true });

const THEMES = ['light', 'dark', 'high-contrast'] as const;

async function navigateToEditor(page: import('@playwright/test').Page, theme?: string) {
  await page.goto('/', { timeout: 180_000, waitUntil: 'domcontentloaded' });
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
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .waitFor({ timeout: 30_000 });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click({ timeout: 30_000 });
  await page.locator('.layers-panel').waitFor({ timeout: 180_000 });
}

for (const theme of THEMES) {
  test(`capture ${theme} — full editor`, async ({ page }) => {
    await navigateToEditor(page, theme);
    await page.waitForTimeout(1500);
    await page.screenshot({
      path: join(OUT_DIR, `01-full-editor-${theme}.png`),
      fullPage: false,
    });
  });

  test(`capture ${theme} — layers panel header with detach button`, async ({ page }) => {
    await navigateToEditor(page, theme);
    await page.waitForTimeout(1000);
    const header = page.locator('.layers-panel__header');
    if (await header.isVisible().catch(() => false)) {
      await header.screenshot({ path: join(OUT_DIR, `02-layers-header-${theme}.png`) });
    }
    // Detach button
    const detachBtn = page.locator('[data-testid="detach-layers"]');
    if (await detachBtn.isVisible().catch(() => false)) {
      await detachBtn.screenshot({ path: join(OUT_DIR, `03-layers-detach-btn-${theme}.png`) });
    }
  });

  test(`capture ${theme} — inspector header with detach button`, async ({ page }) => {
    await navigateToEditor(page, theme);
    await page.waitForTimeout(1000);
    const tabs = page.locator('.insp-panel__tabs');
    if (await tabs.isVisible().catch(() => false)) {
      await tabs.screenshot({ path: join(OUT_DIR, `04-inspector-header-${theme}.png`) });
    }
  });

  test(`capture ${theme} — drag-to-detach overlay`, async ({ page }) => {
    await navigateToEditor(page, theme);
    await page.waitForTimeout(1000);
    // Simulate the detach overlay by evaluating its DOM creation
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
    await page.waitForTimeout(500);
    await page.screenshot({ path: join(OUT_DIR, `05-detach-overlay-${theme}.png`) });
    await page.evaluate(() => document.getElementById('review-detach-overlay')?.remove());
  });
}
