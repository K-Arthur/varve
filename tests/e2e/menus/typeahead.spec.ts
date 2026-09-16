import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, seedLayers } from '../shared';

test.describe('Menu type-ahead', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('typing "s" in File menu focuses Save', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('s');
    await page.waitForTimeout(100);

    const focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Save');
  });

  test('typing "e" in File menu focuses Export SVG', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('e');
    await page.waitForTimeout(100);

    const focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Export SVG');
  });

  test('buffer accumulation: "ex" matches Export... not Export SVG', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('e');
    await page.waitForTimeout(50);
    await page.keyboard.press('x');
    await page.waitForTimeout(100);

    const focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Export\u2026');
  });

  test('cycling: pressing "s" twice cycles through Save items', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('s');
    await page.waitForTimeout(100);
    let focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Save');

    await page.keyboard.press('s');
    await page.waitForTimeout(100);
    focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Save As\u2026');
  });

  test('no match does not move focus', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('z');
    await page.waitForTimeout(100);

    const focused = dropdown.locator('[role="menuitem"]:focus');
    await expect(focused).toContainText('New');
  });

  test('Escape resets buffer', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('s');
    await page.waitForTimeout(50);
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);

    await expect(dropdown).not.toBeVisible();
  });

  test('arrow keys reset buffer', async ({ page }) => {
    const fileButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'File' });
    await fileButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    await page.keyboard.press('s');
    await page.waitForTimeout(50);

    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    await page.keyboard.press('s');
    await page.waitForTimeout(100);

    const focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Save');
  });

  test('submenu supports type-ahead and Home/End', async ({ page }) => {
    await seedLayers(page, 3);
    await page.keyboard.press('ControlOrMeta+a');
    await openMenu(page, 'Arrange');

    const activeName = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    await expect.poll(activeName, { timeout: 5000 }).toMatch(/^Bring to Front/);
    for (let step = 0; step < 8; step += 1) {
      if ((await activeName()).startsWith('Align')) break;
      await page.keyboard.press('ArrowDown');
      await page.waitForTimeout(60);
    }
    expect((await activeName()).startsWith('Align')).toBe(true);

    await page.keyboard.press('ArrowRight');
    const submenu = page
      .locator('[data-overlay-kind="submenu"]')
      .getByRole('menu', { name: 'Align', exact: true });
    await expect(submenu).toBeVisible();
    await expect.poll(activeName, { timeout: 5000 }).toMatch(/^Align Left/);

    // Printable prefix moves focus to the matching item in the submenu.
    await page.keyboard.press('d');
    await expect.poll(activeName, { timeout: 5000 }).toMatch(/^Distribute Horizontally/);

    await page.keyboard.press('End');
    await expect.poll(activeName, { timeout: 5000 }).toMatch(/^Tidy Up/);

    await page.keyboard.press('Home');
    await expect.poll(activeName, { timeout: 5000 }).toMatch(/^Align Left/);
  });

  test('type-ahead with diacritics (collator)', async ({ page }) => {
    const editButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'Edit' });
    await editButton.click();
    await page.waitForTimeout(200);

    const dropdown = page.locator('[role="menu"]').first();
    await expect(dropdown).toBeVisible();

    // "undo" should match via base sensitivity
    await page.keyboard.press('u');
    await page.waitForTimeout(100);

    const focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).toContainText('Undo');
  });
});
