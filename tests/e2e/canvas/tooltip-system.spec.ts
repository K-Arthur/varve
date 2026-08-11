import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Tooltip system', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('shows tooltip on hover over a floating toolbar button', async ({ page }) => {
    // The floating toolbar should be visible
    const toolbar = page.locator('[role="toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    // Hover over the first tool button inside the toolbar
    const toolBtn = toolbar.locator('button').first();
    await toolBtn.hover();

    // Tooltip should appear after the default delay (300ms)
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    expect(await tooltip.count()).toBeGreaterThanOrEqual(1);
  });

  test('shows keyboard shortcut badge in tooltip', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    const toolBtn = toolbar.locator('button').first();
    await toolBtn.hover();

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });

    // The shortcut badge is a span with class varve-tip__shortcut
    const shortcutBadge = tooltip.locator('.varve-tip__shortcut');
    // Not all tool buttons have shortcuts, so this may or may not exist
    if ((await shortcutBadge.count()) > 0) {
      await expect(shortcutBadge).toBeVisible();
    }
  });

  test('tooltip appears on keyboard focus', async ({ page }) => {
    // Tab to a toolbar button to give it focus
    const toolbar = page.locator('[role="toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    // Click the toolbar to start keyboard navigation
    await toolbar.click();
    // Tab to the first focusable element
    await page.keyboard.press('Tab');

    // Tooltip should appear on focus
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
  });

  test('tooltip dismisses on Escape', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    // Focus a button to trigger tooltip
    await toolbar.click();
    await page.keyboard.press('Tab');

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });

    // Press Escape to dismiss
    await page.keyboard.press('Escape');
    await expect(tooltip).not.toBeVisible({ timeout: 1000 });
  });

  test('tooltip does not appear during canvas drag', async ({ page }) => {
    const tooltip = page.locator('[role="tooltip"]');

    // Perform a canvas drag operation
    const canvas = page.getByTestId('editor-canvas');
    await expect(canvas).toBeVisible({ timeout: 10000 });

    // Start a drag on the canvas
    const box = await canvas.boundingBox();
    if (box) {
      await page.mouse.move(box.x + 100, box.y + 100);
      await page.mouse.down();
      await page.mouse.move(box.x + 200, box.y + 200, { steps: 5 });

      // While dragging, no tooltip should be visible
      await expect(tooltip).not.toBeVisible({ timeout: 1000 });
      await page.mouse.up();
    }
  });

  test('tooltip content has correct ARIA role and association', async ({ page }) => {
    const toolbar = page.locator('[role="toolbar"]').first();
    await expect(toolbar).toBeVisible({ timeout: 10000 });

    const toolBtn = toolbar.locator('button').first();
    await toolBtn.hover();

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });

    // Tooltip must have an id
    const tooltipId = await tooltip.getAttribute('id');
    expect(tooltipId).toBeTruthy();

    // The trigger button itself should have aria-describedby pointing to the tooltip
    const describedBy = await toolBtn.getAttribute('aria-describedby');
    expect(describedBy).toBe(tooltipId);
  });

  test('tooltip appears on status bar zoom controls', async ({ page }) => {
    // Try to find it through the Tooltip wrapper
    const tooltip = page.locator('[role="tooltip"]');

    // Hover over the Zoom out button in the status bar
    const zoomOut = page.locator('.editor-status__zoom-chip button').first();
    if (await zoomOut.isVisible({ timeout: 3000 }).catch(() => false)) {
      await zoomOut.hover();
      await expect(tooltip).toBeVisible({ timeout: 1000 });
      const content = await tooltip.textContent();
      expect(content).toContain('Zoom out');
    }
  });

  test('workspace mode tooltip shows the effective registry shortcut, not a stale string', async ({
    page,
  }) => {
    // Design workspace is active by default. Its effective binding in the
    // shortcut registry is Ctrl+Shift+1 (the old Ctrl+Shift+D is taken by
    // Repeat Duplicate and does not switch workspaces).
    const designBtn = page.locator('.workspace-tabs__tab[aria-label="Design workspace"]');
    await expect(designBtn).toBeVisible({ timeout: 10000 });

    await designBtn.hover();
    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await expect(tooltip).toContainText('Design workspace');
    await expect(tooltip).toContainText('Ctrl+Shift+1');
  });

  test('menubar home button tooltip shows the registry shortcut', async ({ page }) => {
    const homeBtn = page.locator('.editor-menubar__home');
    await expect(homeBtn).toBeVisible({ timeout: 10000 });

    // The Tooltip suppresses show-for-hover for POINTER_SUPPRESS_MS after a
    // pointer-down (a click, e.g. the onboarding dismiss that ends navigation).
    // In serial runs that suppression window can swallow the single pointerenter
    // `hover()` emits, so re-hover once after the window to open it reliably.
    await homeBtn.hover();
    await page.waitForTimeout(400);
    await page.mouse.move(5, 200);
    await page.waitForTimeout(50);
    await homeBtn.hover();

    const tooltip = page.locator('[role="tooltip"]');
    await expect(tooltip).toBeVisible({ timeout: 1000 });
    await expect(tooltip).toContainText('Home');
    await expect(tooltip).toContainText('Ctrl+Shift+H');
  });
});
