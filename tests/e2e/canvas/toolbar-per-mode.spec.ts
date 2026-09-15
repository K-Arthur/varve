import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const VIEWPORT = { width: 1280, height: 800 };

test.describe('Floating toolbar adapts per workspace mode', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize(VIEWPORT);
    await navigateToEditor(page);
  });

  async function switchTo(page: import('@playwright/test').Page, label: string) {
    const workspace = page.getByRole('radio', { name: `${label} workspace` });
    if (await workspace.isVisible({ timeout: 1000 }).catch(() => false)) {
      await workspace.click();
      return;
    }
    await page.getByLabel('More workspaces').click();
    await page.getByRole('menuitemradio', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') }).click();
  }

  /**
   * A flyout can leave the visible row when the workspace declares more tools
   * than fit (see docs/architecture/toolbar-system.md → responsive overflow).
   * Workspace gating is the contract that matters: if a mode does not declare
   * a flyout, no row width may surface it; if it does declare it, the flyout is
   * reachable from the row or from the More menu (which groups hidden tools by
   * registry category).
   */
  async function toolReachable(page: import('@playwright/test').Page, toolLabel: string) {
    if (
      await page
        .getByLabel(toolLabel)
        .isVisible()
        .catch(() => false)
    )
      return true;
    const more = page.getByTestId('toolbar-more-tools');
    if (!(await more.isVisible().catch(() => false))) return false;
    await more.click();
    const menu = page.getByRole('menu');
    const categories = await menu.getByRole('menuitem').all();
    for (const category of categories) {
      await category.hover();
      await page.waitForTimeout(150);
      const found = await page
        .getByRole('menuitem', { name: new RegExp(`^${toolLabel}$`, 'i') })
        .first()
        .isVisible()
        .catch(() => false);
      if (found) {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        return true;
      }
    }
    await page.keyboard.press('Escape');
    return false;
  }

  async function toolAbsent(page: import('@playwright/test').Page, toolLabel: string) {
    if (
      await page
        .getByLabel(toolLabel)
        .isVisible()
        .catch(() => false)
    )
      return false;
    const more = page.getByTestId('toolbar-more-tools');
    if (!(await more.isVisible().catch(() => false))) return true;
    await more.click();
    const menu = page.getByRole('menu');
    const categories = await menu.getByRole('menuitem').all();
    for (const category of categories) {
      await category.hover();
      await page.waitForTimeout(150);
      const found = await page
        .getByRole('menuitem', { name: new RegExp(`^${toolLabel}$`, 'i') })
        .first()
        .isVisible()
        .catch(() => false);
      if (found) {
        await page.keyboard.press('Escape');
        await page.keyboard.press('Escape');
        return false;
      }
    }
    await page.keyboard.press('Escape');
    return true;
  }

  test('Design mode: no paint/retouch tools, shapes and boolean ops reachable', async ({
    page,
  }) => {
    await expect(page.locator('[data-tool="paint"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="eraser"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="cloneStamp"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="pencil"]')).not.toBeVisible();
    // Creation tools are never the ones that yield (they are the reason the
    // row exists); the disabled Boolean flyout yields first.
    await expect(page.getByLabel('Shapes menu')).toBeVisible();
    expect(await toolReachable(page, 'Boolean Union')).toBe(true);
  });

  test('Print mode: no paint/retouch tools, shapes and boolean ops reachable', async ({ page }) => {
    await switchTo(page, 'Print');
    await expect(page.locator('[data-tool="paint"]')).not.toBeVisible();
    await expect(page.locator('[data-tool="healBrush"]')).not.toBeVisible();
    await expect(page.getByLabel('Shapes menu')).toBeVisible();
    expect(await toolReachable(page, 'Boolean Union')).toBe(true);
  });

  test('Drawing mode: paint/retouch tools available, boolean ops absent', async ({ page }) => {
    await switchTo(page, 'Draw');
    await expect(page.locator('[data-tool="paint"]')).toBeVisible();
    await expect(page.locator('[data-tool="eraser"]')).toBeVisible();
    expect(await toolAbsent(page, 'Boolean Union')).toBe(true);
  });

  test('Photo mode: frame absent, retouch tools available', async ({ page }) => {
    await switchTo(page, 'Photo');
    await expect(page.locator('[data-tool="frame"]')).not.toBeVisible();
    expect(await toolAbsent(page, 'Boolean Union')).toBe(true);
    // Retouch is the headline capability of the photo workspace — it keeps its
    // row slot even when the palette has to yield something.
    await expect(page.getByLabel('Retouch menu')).toBeVisible();
    await page.getByLabel('Retouch menu').click();
    await expect(page.getByRole('menuitem', { name: 'Clone Stamp' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Healing Brush' })).toBeVisible();
    await expect(page.getByRole('menuitem', { name: 'Spot Heal' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByLabel('Retouch menu')).toBeVisible();
  });
});
