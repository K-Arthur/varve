import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor, seedLayers } from '../shared';

/**
 * Menubar flyouts: pointer dismissal and roving tabindex.
 *
 * Two regressions this covers:
 *  - Hovering a plain command row used to leave any open flyout on screen
 *    until an outside click or Escape (the hover handler only acted on
 *    submenu parents).
 *  - The submenu's roving tabindex compared `activeSubmenuIndex` (which
 *    counts only focusable items) against the raw config index, so a
 *    separator between the active item and the top put `tabIndex=0` on the
 *    wrong button — or on none at all. The parent dropdown already tracked
 *    a focusable index; the submenu now does too.
 */
test.describe('Menubar flyout dismissal', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('hovering a plain command closes the open flyout', async ({ page }) => {
    // A selection keeps the plain Arrange commands enabled, so the hover
    // target is a normal interactive row rather than a disabled button.
    await seedLayers(page, 2);
    await page.keyboard.press('ControlOrMeta+a');
    await openMenu(page, 'Arrange');
    const arrangeMenu = page
      .locator('.editor-menubar__menu')
      .getByRole('menu', { name: 'Arrange', exact: true });
    const alignItem = arrangeMenu.getByRole('menuitem', { name: 'Align', exact: true });
    await alignItem.hover();

    const submenu = page
      .locator('[data-overlay-kind="submenu"]')
      .getByRole('menu', { name: 'Align', exact: true });
    await expect(submenu).toBeVisible();

    await expect(arrangeMenu.getByRole('menuitem', { name: 'Harmonize Spacing' })).toBeEnabled();
    // Move the pointer directly to the row's centre: the menu can be
    // mid-transition after the flyout closes, so Playwright's stability gate
    // can retry indefinitely. This still dispatches real pointer events.
    const harmonizeBox = await arrangeMenu
      .getByRole('menuitem', { name: 'Harmonize Spacing' })
      .boundingBox();
    expect(harmonizeBox).not.toBeNull();
    await page.mouse.move(
      harmonizeBox!.x + harmonizeBox!.width / 2,
      harmonizeBox!.y + harmonizeBox!.height / 2,
    );
    await expect(submenu).toHaveCount(0);
  });

  test('a disabled submenu parent does not open a flyout', async ({ page }) => {
    // With nothing selected, Align cannot run (relative alignment needs two
    // objects). The row is disabled like any other unavailable command and
    // must not open a flyout of commands that cannot execute.
    await openMenu(page, 'Arrange');
    const arrangeMenu = page
      .locator('.editor-menubar__menu')
      .getByRole('menu', { name: 'Arrange', exact: true });
    const alignItem = arrangeMenu.getByRole('menuitem', { name: 'Align', exact: true });
    await expect(alignItem).toBeDisabled();

    // Raw mouse move: Playwright's hover actionability gates on enabled, but
    // this must still dispatch real pointer events over the disabled row.
    const box = await alignItem.boundingBox();
    expect(box).not.toBeNull();
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.waitForTimeout(100);

    await expect(
      page
        .locator('[data-overlay-kind="submenu"]')
        .getByRole('menu', { name: 'Align', exact: true }),
    ).toHaveCount(0);
  });

  test('submenu roving tabindex follows focus across a separator', async ({ page }) => {
    await seedLayers(page, 2);
    await page.keyboard.press('ControlOrMeta+a');
    await openMenu(page, 'Arrange');

    // Walk the dropdown to the Align entry with the keyboard, then open the
    // submenu with ArrowRight so the menubar's own focus effect places focus
    // (manual focus() can race the portal's visibility frame).
    const activeName = () => page.evaluate(() => document.activeElement?.textContent?.trim() ?? '');
    await expect.poll(activeName, { timeout: 5000 }).toMatch(/^Bring to Front/);
    for (let step = 0; step < 6; step += 1) {
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

    const readState = () =>
      submenu.evaluate((menu) => {
        const items = [...menu.querySelectorAll('[role^="menuitem"]')];
        const tabbable = items.find((element) => element.getAttribute('tabindex') === '0');
        const active = document.activeElement;
        return {
          tabbable: tabbable?.textContent?.trim() ?? null,
          focused: active && menu.contains(active) ? (active.textContent?.trim() ?? null) : null,
        };
      });

    const visited = new Set<string>();
    for (let step = 0; step < 4; step += 1) {
      await page.keyboard.press('ArrowDown');
      await expect
        .poll(
          async () => {
            const state = await readState();
            return state.tabbable !== null && state.tabbable === state.focused;
          },
          { timeout: 5000 },
        )
        .toBe(true);
      const state = await readState();
      if (state.focused) visited.add(state.focused);
    }

    // The fourth step crosses the first separator; focus must have reached
    // the second group rather than silently stopping or desyncing.
    expect(
      [...visited].some(
        (name) => name.startsWith('Align Top') || name.startsWith('Align Vertical Center'),
      ),
    ).toBe(true);
  });
});
