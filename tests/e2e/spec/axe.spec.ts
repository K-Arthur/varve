import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

function getCanvas(page: import('@playwright/test').Page) {
  return page.locator('canvas.editor-canvas__content-layer');
}

// The legacy `.spec-panel` surface was superseded by the inspector
// (PropertiesPanel); these scans now target the inspector in inspect mode.
const INSPECTOR = '.editor-inspector, [aria-label="Inspector"]';

/**
 * Tools activate through their keyboard bindings rather than toolbar buttons:
 * measurement tools (Inspect) have the lowest retention rank and collapse
 * into the overflow menu at narrow viewports, and Rectangle lives inside the
 * Shapes flyout — neither is guaranteed visible as a top-level button.
 * Keyboard activation is the APG-sanctioned route that works at any width.
 */
async function activateTool(page: import('@playwright/test').Page, key: string) {
  await page.locator('canvas.editor-canvas__content-layer').focus();
  await page.keyboard.press(key);
  await page.waitForTimeout(200);
}

test.describe('Inspect mode - axe-core scan', () => {
  test('inspector empty state in inspect mode has no automated accessibility violations', async ({
    page,
  }) => {
    await navigateToEditor(page);

    // Enter inspect mode even with no selection — inspector shows its empty state
    await activateTool(page, 'i');
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

    // Create a rect (rect tool via its keyboard binding, then drag)
    await activateTool(page, 'r');
    await getCanvas(page).dragTo(getCanvas(page), {
      sourcePosition: { x: 200, y: 200 },
      targetPosition: { x: 320, y: 300 },
    });
    await page.waitForTimeout(500);

    // Enter inspect mode
    await activateTool(page, 'i');
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

  test('locked selection with the restriction notice has no automated accessibility violations', async ({
    page,
  }) => {
    await navigateToEditor(page);

    await activateTool(page, 'r');
    await getCanvas(page).dragTo(getCanvas(page), {
      sourcePosition: { x: 200, y: 200 },
      targetPosition: { x: 320, y: 300 },
    });
    await page.waitForTimeout(500);

    // Lock the selected layer from its Layers row, then re-select it so the
    // restriction notice (and its unlock action) renders in the Inspector.
    const row = page.locator('[role="treeitem"]').first();
    await row.click();
    const lock = row.locator('.layers-row__toggle--locked-off');
    await lock.click();
    await expect(row.locator('.layers-row__toggle--locked-on')).toBeVisible();
    await expect(page.locator('[data-inspector-restriction="locked"]').first()).toBeVisible({
      timeout: 5000,
    });

    const results = await new AxeBuilder({ page })
      .include(INSPECTOR)
      .withTags(['wcag2a', 'wcag2aa', 'wcag21a', 'wcag21aa'])
      .analyze();

    expect(results.violations).toEqual([]);
  });
});
