/**
 * The section-manager popover (`SectionManagerTrigger`) had two real visual
 * defects, both reported directly from a running session:
 *
 * 1. `.insp-panel__header` was defined twice in inspector.css. The later
 *    rule (`justify-content: flex-end; padding: var(--space-1) 0`) won the
 *    cascade for the properties it set, silently dropping the first rule's
 *    horizontal inset (`var(--space-3)`). The header lives inside the
 *    scrolling `.insp-panel`, so its trailing edge sat flush against the
 *    panel's own scrollbar track instead of clear of it — the gear button
 *    was genuinely hard to click without hitting the scrollbar.
 * 2. `.insp-section-manager__label` had no overflow containment. On a
 *    fixed 280px popover, a longer title ("Align & Distribute") wrapped to
 *    two lines while its sibling category badge and "required" flag
 *    stayed single-line and vertically centered against the row's full
 *    (now taller) height — reading as overlapping/colliding text.
 *
 * Fix: consolidated the header rule with a right inset matching the
 * content padding below it, and gave the label standard ellipsis
 * truncation (matching every other row-name pattern in this codebase)
 * plus a truncation-only tooltip for the full title.
 */
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.describe('Inspector section manager — visual', () => {
  test('gear button clears the scrollbar and long labels truncate instead of wrapping', async ({
    page,
  }) => {
    await navigateToEditor(page);

    const gearBtn = page.locator('[aria-label="Customize sections"]');
    await expect(gearBtn).toBeVisible({ timeout: 5000 });

    const gearBox = await gearBtn.boundingBox();
    const scrollPanel = page.locator('.editor-inspector > .insp-panel').first();
    const panelBox = await scrollPanel.boundingBox();
    expect(gearBox).not.toBeNull();
    expect(panelBox).not.toBeNull();
    // The button's own inset from the scrollable panel's right edge must be
    // clearly positive — flush-against-the-scrollbar reproduces as a delta
    // near 0px.
    const rightInset = panelBox!.x + panelBox!.width - (gearBox!.x + gearBox!.width);
    expect(rightInset).toBeGreaterThan(4);

    await gearBtn.click();
    const dialog = page.getByRole('dialog', { name: /customize sections/i });
    await expect(dialog).toBeVisible({ timeout: 5000 });

    const alignRow = dialog.locator('li').filter({ hasText: /align/i }).first();
    await expect(alignRow).toBeVisible();
    const label = alignRow.locator('.insp-section-manager__label');
    await expect(label).toBeVisible();
    const [labelBox, itemBox] = await Promise.all([label.boundingBox(), alignRow.boundingBox()]);
    expect(labelBox).not.toBeNull();
    expect(itemBox).not.toBeNull();
    // A wrapped two-line label roughly doubles the row height (~34px+ at
    // this font size); a truncated single-line label stays compact.
    expect(itemBox!.height).toBeLessThan(28);

    const category = alignRow.locator('.insp-section-manager__category');
    const categoryBox = await category.boundingBox();
    expect(categoryBox).not.toBeNull();
    // Category badge must sit to the right of the label, not overlapping it.
    expect(categoryBox!.x).toBeGreaterThanOrEqual(labelBox!.x + labelBox!.width - 1);
  });
});
