import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Regression coverage for a CSS-cascade bug: `dialog:not([open]) { display:
 * none }` is a UA-origin rule that any author `display` declaration
 * overrides regardless of selector specificity. A `.strata-dialog--settings
 * { display: flex }` rule (no [open] qualifier) made the closed Settings
 * dialog stay visibly rendered as an empty header-only shell. jsdom's
 * minimal CSS engine can't compute this cascade, so it's only catchable in
 * a real browser — see AGENTS.md's "write a Playwright E2E test" rule for
 * render/layout bugs.
 */
test.describe('Settings dialog', () => {
  test('stays hidden while closed', async ({ page }) => {
    await navigateToEditor(page);

    const settingsDialog = page.locator('dialog.strata-dialog--settings');
    await expect(settingsDialog).toHaveCount(1);
    await expect(settingsDialog).not.toHaveAttribute('open');
    await expect(settingsDialog).toBeHidden();

    // The regression specifically produced a non-null bounding box for a
    // closed dialog (an empty header-only shell positioned on screen).
    const box = await settingsDialog.boundingBox();
    expect(box).toBeNull();
  });
});
