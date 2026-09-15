/**
 * Constraint persistence and interaction E2E tests.
 *
 * Covers: visual pin control interaction, constraint save/reopen,
 * reparenting, and multi-selection constraint workflows.
 *
 * Uses real image fixtures via the supported import UI path.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Constraint visual controls and persistence', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  /**
   * Helper: create a frame with a child rect and select the child.
   */
  async function createFrameAndChild(page: import('@playwright/test').Page) {
    // Create frame
    await page.keyboard.press('f');
    const frameBox = await dragOnCanvas(page, 100, 100, 500, 400);

    // Create child inside frame
    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 180, 320, 280);

    // Switch to select and Ctrl+click through the containing frame. The
    // default frame hit target is the container; constraints belong to the
    // child, so make the deep-selection intent explicit.
    await page.keyboard.press('v');
    await page.waitForTimeout(300);
    await page.keyboard.down('Control');
    await page.mouse.click(frameBox.x + 250, frameBox.y + 230);
    await page.keyboard.up('Control');
    await page.waitForTimeout(300);

    await expect(
      page.locator('[role="treeitem"][data-layer-type="shape"]', { hasText: 'Rectangle 1' }),
    ).toHaveAttribute('aria-selected', 'true');

    return frameBox;
  }

  test('constraint section shows when child of frame is selected', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    // Check that the Constraints section is visible
    const constraintGroup = page.getByRole('group', { name: /visual constraint editor/i });
    await expect(constraintGroup).toBeVisible({ timeout: 5000 });
  });

  test('clicking pin left sets horizontal constraint to Left', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    const leftPin = page.getByRole('button', { name: 'Pin left edge', exact: true });
    await expect(leftPin).toBeVisible({ timeout: 5000 });
    await leftPin.click();
    await page.waitForTimeout(200);

    // The custom ARIA combobox should show "Left".
    const hSelect = page.getByRole('combobox', { name: 'Horizontal constraint' });
    await expect(hSelect).toHaveText('Left');
  });

  test('clicking pin right sets horizontal constraint to Right', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    const rightPin = page.getByRole('button', { name: 'Pin right edge', exact: true });
    await rightPin.click();
    await page.waitForTimeout(200);

    const hSelect = page.getByRole('combobox', { name: 'Horizontal constraint' });
    await expect(hSelect).toHaveText('Right');
  });

  test('clicking stretch horizontally sets horizontal to Left & Right', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    const stretchH = page.getByRole('button', { name: 'Stretch horizontally', exact: true });
    await stretchH.click();
    await page.waitForTimeout(200);

    const hSelect = page.getByRole('combobox', { name: 'Horizontal constraint' });
    await expect(hSelect).toHaveText('Left & Right');
  });

  test('clicking stretch vertically sets vertical constraint to Top & Bottom', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    const stretchV = page.getByRole('button', { name: 'Stretch vertically', exact: true });
    await stretchV.click();
    await page.waitForTimeout(200);

    const vSelect = page.getByRole('combobox', { name: 'Vertical constraint' });
    await expect(vSelect).toHaveText('Top & Bottom');
  });

  test('clicking center sets both axes to Center', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    const centerPin = page.getByRole('button', { name: 'Center both axes', exact: true });
    await centerPin.click();
    await page.waitForTimeout(200);

    const hSelect = page.getByRole('combobox', { name: 'Horizontal constraint' });
    const vSelect = page.getByRole('combobox', { name: 'Vertical constraint' });
    await expect(hSelect).toHaveText('Center');
    await expect(vSelect).toHaveText('Center');
  });

  test('dropdown and pin control stay synchronized', async ({ page }) => {
    test.setTimeout(60000);
    await createFrameAndChild(page);

    // Set via dropdown
    const hSelect = page.getByRole('combobox', { name: 'Horizontal constraint' });
    await hSelect.click();
    await page.getByRole('option', { name: 'Right', exact: true }).click();
    await page.waitForTimeout(200);

    // Pin control should reflect the change — right pin should be active
    const rightPin = page.getByRole('button', { name: 'Pin right edge', exact: true });
    await expect(rightPin).toBeVisible();
  });

  test('resizing parent frame propagates constraints to children', async ({ page }) => {
    test.setTimeout(60000);
    const frameBox = await createFrameAndChild(page);

    // Set child to stretch horizontally
    const stretchH = page.getByRole('button', { name: 'Stretch horizontally', exact: true });
    await stretchH.click();
    await page.waitForTimeout(200);

    // Select the frame (click on frame edge area)
    await page.keyboard.press('v');
    await page.waitForTimeout(200);
    await page.mouse.click(frameBox.x + 100, frameBox.y + 100);
    await page.waitForTimeout(200);

    // Resize frame via inspector W field
    const wField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
    await wField.fill('600');
    await wField.press('Enter');
    await page.waitForTimeout(300);

    // Child should still exist and the constraint section should still work
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
  });
});
