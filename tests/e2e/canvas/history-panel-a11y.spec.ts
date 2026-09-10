/**
 * History panel accessibility audit (M17) — axe-core scans.
 *
 * Scans the History panel's steps view, branches view, and compare view
 * for WCAG 2.1 AA violations. Run:
 *   npx playwright test tests/e2e/canvas/history-panel-a11y.spec.ts --project=chromium
 */
import AxeBuilder from '@axe-core/playwright';
import { expect, type Page, test } from '@playwright/test';

async function navigateToEditor(page: Page) {
  await page.goto('/');
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 30000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page.getByRole('button', { name: /create design/i }).waitFor({ timeout: 10000 });
  await page.getByRole('button', { name: /create design/i }).click();
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  const dismissBtn = page.locator('button:has-text("Dismiss")');
  if (await dismissBtn.isVisible({ timeout: 2000 }).catch(() => false)) {
    await dismissBtn.click({ force: true });
  }
  for (let i = 0; i < 4; i++) {
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
}

async function drawRect(page: Page) {
  const rectBtn = page.locator('[data-tool="rect"]');
  await rectBtn.click();
  await page.waitForTimeout(300);
  const canvas = page.locator('canvas').first();
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.mouse.move(box.x + 200, box.y + 200);
  await page.mouse.down();
  await page.mouse.move(box.x + 400, box.y + 350, { steps: 5 });
  await page.mouse.up();
  await page.waitForTimeout(1200);
}

async function openHistoryPanel(page: Page) {
  await page.getByRole('menuitem', { name: 'View' }).click();
  await page.waitForTimeout(500);
  await page.locator('[role="menuitem"]', { hasText: 'History Panel' }).click();
  await page.locator('.editor__history-panel').waitFor({ timeout: 10000 });
}

async function scan(page: Page, include: string) {
  return new AxeBuilder({ page })
    .include(include)
    .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
    .analyze();
}

test.describe('History panel - axe-core scan', () => {
  test('steps view has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await drawRect(page);
    await openHistoryPanel(page);
    const results = await scan(page, '.editor__history-panel');
    expect(results.violations).toEqual([]);
  });

  test('branches view has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await drawRect(page);
    await openHistoryPanel(page);
    await page.getByRole('tab', { name: 'Branches' }).click();
    await page.waitForTimeout(500);
    const results = await scan(page, '.editor__history-panel');
    expect(results.violations).toEqual([]);
  });

  test('compare view has no automated accessibility violations', async ({ page }) => {
    await navigateToEditor(page);
    await drawRect(page);
    await openHistoryPanel(page);
    await page.getByRole('tab', { name: 'Compare' }).click();
    await page.waitForTimeout(500);
    const results = await scan(page, '.editor__history-panel');
    expect(results.violations).toEqual([]);
  });
});
