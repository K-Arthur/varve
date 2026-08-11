import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

function getCanvas(page: import('@playwright/test').Page) {
  return page.locator('canvas.editor-canvas__content-layer');
}

// The legacy `.spec-panel` surface was superseded by the inspector
// (PropertiesPanel); these scans now target the inspector in inspect mode.
const INSPECTOR = '.editor-inspector, [aria-label="Inspector"]';

test.describe('Inspect mode - axe-core scan', () => {
  async function activateTool(page: import('@playwright/test').Page, name: string) {
    // exact: true — the contextual-help panel contains buttons whose
    // accessible names merely contain the tool name (e.g. "Inspect Tool (I)",
    // "Inspector Panel"), which made the un-scoped locator ambiguous
    // (strict-mode violation) and silently skipped the scan.
    const btn = page.getByRole('button', { name, exact: true });
    await btn.waitFor({ state: 'visible', timeout: 5000 });
    await btn.click();
    await page.waitForTimeout(200);
  }

  test('inspector empty state in inspect mode has no automated accessibility violations', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Enter inspect mode even with no selection — inspector shows its empty state
    await activateTool(page, 'Inspect');
    await expect(page.locator(INSPECTOR)).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .include(INSPECTOR)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });

  test('inspector with selected node in inspect mode has no automated accessibility violations', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Create a rect
    await activateTool(page, 'Rectangle');
    await getCanvas(page).click({ position: { x: 200, y: 200 } });
    await page.waitForTimeout(500);

    // Enter inspect mode
    await activateTool(page, 'Inspect');
    // Click inside the created rect, away from its selection-corner handles
    // (a handle rendered at the creation point intercepts pointer events).
    await getCanvas(page).click({ position: { x: 250, y: 250 } });
    await page.waitForTimeout(300);

    // Ensure inspector is visible
    await expect(page.locator(INSPECTOR)).toBeVisible({ timeout: 5000 });

    const results = await new AxeBuilder({ page })
      .include(INSPECTOR)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
