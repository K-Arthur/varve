/**
 * Disclosure visual capture — review artifacts, not assertions.
 *
 * Captures the rendered disclosure surfaces for human inspection into
 * `reports/disclosure-review-2026-09-15/` (generated, gitignored). Run it
 * when reviewing chevron direction, focus rings, collapsed headers, or the
 * settings-store persistence surface; pair it with the behavioural spec
 * (`disclosure-contract.spec.ts`), which is what fails on regressions.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT = 'reports/disclosure-review-2026-09-15';

test.describe('Disclosure visual capture', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('inspector disclosure states', async ({ page }) => {
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    await page.mouse.move(box.x + 220, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 420, box.y + 330, { steps: 4 });
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });

    const inspector = page.locator('.editor-inspector');
    await expect(inspector).toBeVisible();
    await inspector.screenshot({ path: `${OUT}/editor-inspector-expanded.png` });

    // Focused trigger: keyboard focus ring on a section header.
    const positionTrigger = page
      .locator('section.insp-disclosure')
      .filter({ has: page.getByRole('heading', { name: 'Position & Size', exact: true }) })
      .locator('button.insp-disclosure__trigger');
    await positionTrigger.focus();
    await expect(positionTrigger).toBeFocused();
    await inspector.screenshot({ path: `${OUT}/editor-section-focused.png` });

    // Collapsed section: chevron direction and header-only state.
    const strokeTrigger = page
      .locator('section.insp-disclosure')
      .filter({ has: page.getByRole('heading', { name: 'Stroke', exact: true }) })
      .locator('button.insp-disclosure__trigger');
    await strokeTrigger.click();
    await expect(strokeTrigger).toHaveAttribute('aria-expanded', 'false');
    await inspector.screenshot({ path: `${OUT}/editor-section-collapsed.png` });
  });
});
