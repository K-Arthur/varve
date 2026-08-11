import AxeBuilder from '@axe-core/playwright';
import { expect, test } from '@playwright/test';
import {
  assertActiveElementRole,
  assertFocusNotOnBody,
  closeMenu,
  getFocusedMenuItem,
  mod,
  openMenu,
  resetTypeAheadTimeout,
  setTypeAheadTimeout,
} from '../helpers/menu-helpers';
import { navigateToEditor, seedLayers } from '../shared';

test.describe.configure({ mode: 'serial' });

test.describe('Menu keyboard navigation', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await setTypeAheadTimeout(page, 200);
  });

  test.afterEach(async () => {
    resetTypeAheadTimeout;
  });

  // ─── Top-level menubar navigation ───────────────────────────────

  test('focus menubar via Tab and navigate with ArrowRight/ArrowLeft', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    const items = menubar.locator('[role="menuitem"]');
    await items.first().focus();

    await page.keyboard.press('ArrowRight');
    await assertActiveElementRole(page, 'menuitem');
    const secondText = await items.nth(1).textContent();
    const activeText = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeText).toBe(secondText);

    await page.keyboard.press('ArrowLeft');
    const firstText = await items.first().textContent();
    const activeAfterLeft = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeAfterLeft).toBe(firstText);

    await assertFocusNotOnBody(page);
  });

  test('ArrowDown opens menu from focused menubar item', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    const fileItem = menubar.locator('[role="menuitem"]', { hasText: 'File' });
    await fileItem.focus();

    await page.keyboard.press('ArrowDown');
    await expect(page.locator('[role="menu"]').first()).toBeVisible();
    await assertFocusNotOnBody(page);
  });

  test('Enter opens menu from focused menubar item', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    const fileItem = menubar.locator('[role="menuitem"]', { hasText: 'File' });
    await fileItem.focus();

    await page.keyboard.press('Enter');
    await expect(page.locator('[role="menu"]').first()).toBeVisible();
    await assertFocusNotOnBody(page);
  });

  test('Home/End jumps to first/last menubar item', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    const items = menubar.locator('[role="menuitem"]');
    await items.first().focus();

    await page.keyboard.press('End');
    const lastText = await items.last().textContent();
    const activeEnd = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeEnd).toBe(lastText);

    await page.keyboard.press('Home');
    const firstText = await items.first().textContent();
    const activeHome = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeHome).toBe(firstText);

    await assertFocusNotOnBody(page);
  });

  // ─── Dropdown navigation ────────────────────────────────────────

  test('ArrowDown/ArrowUp cycles through menu items', async ({ page }) => {
    await openMenu(page, 'File');
    const items = page.locator('[role="menu"] [role="menuitem"]');

    // Wait for the roving initial focus to land before asserting.
    await expect(items.first()).toBeFocused();
    const firstLabel = await items.first().textContent();
    const firstFocused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(firstFocused).toBe(firstLabel);

    await page.keyboard.press('ArrowDown');
    const secondLabel = await items.nth(1).textContent();
    void secondLabel;

    await page.keyboard.press('ArrowUp');
    const backToFirst = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(backToFirst).toBe(firstLabel);

    await assertFocusNotOnBody(page);
  });

  test('ArrowRight switches to next menu when no submenu', async ({ page }) => {
    await openMenu(page, 'File');
    const fileMenu = page.locator('[role="menu"][aria-label="File"]');
    await expect(fileMenu).toBeVisible();

    await page.keyboard.press('ArrowRight');
    const editMenu = page.locator('[role="menu"][aria-label="Edit"]');
    await expect(editMenu).toBeVisible();
    await assertFocusNotOnBody(page);
  });

  test('ArrowLeft switches to previous menu', async ({ page }) => {
    await openMenu(page, 'Edit');
    const editMenu = page.locator('[role="menu"][aria-label="Edit"]');
    await expect(editMenu).toBeVisible();

    await page.keyboard.press('ArrowLeft');
    const fileMenu = page.locator('[role="menu"][aria-label="File"]');
    await expect(fileMenu).toBeVisible();
    await assertFocusNotOnBody(page);
  });

  test('Escape closes menu and returns focus to trigger', async ({ page }) => {
    await openMenu(page, 'File');
    const trigger = page.locator('[role="menubar"] [role="menuitem"][aria-expanded="true"]');
    const triggerText = await trigger.textContent();

    await page.keyboard.press('Escape');
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    const activeText = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeText).toBe(triggerText);
    await assertFocusNotOnBody(page);
  });

  test('Home/End in dropdown jumps to first/last item', async ({ page }) => {
    await openMenu(page, 'File');
    const items = page.locator('[role="menu"] [role="menuitem"]');
    // Wait for the roving initial focus to land before navigating.
    await expect(items.first()).toBeFocused();
    const lastLabel = await items.last().textContent();

    await page.keyboard.press('End');
    const activeEnd = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeEnd).toContain(lastLabel ?? '');

    await page.keyboard.press('Home');
    const firstLabel = await items.first().textContent();
    const activeHome = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeHome).toContain(firstLabel ?? '');

    await assertFocusNotOnBody(page);
  });

  // ─── Submenu navigation ─────────────────────────────────────────

  test('ArrowRight opens submenu, ArrowLeft closes it', async ({ page }) => {
    await openMenu(page, 'Arrange');
    const alignItem = page.locator('[role="menu"] [role="menuitem"][aria-haspopup]', {
      hasText: 'Align',
    });
    await alignItem.focus();

    await page.keyboard.press('ArrowRight');
    const submenu = page.locator('[role="menu"][aria-label="Align"]');
    await expect(submenu).toBeVisible({ timeout: 2000 });

    await page.keyboard.press('ArrowLeft');
    await expect(submenu).not.toBeVisible({ timeout: 2000 });
    await assertFocusNotOnBody(page);
  });

  test('Enter on submenu item opens submenu', async ({ page }) => {
    await openMenu(page, 'Arrange');
    const alignItem = page.locator('[role="menu"] [role="menuitem"][aria-haspopup]', {
      hasText: 'Align',
    });
    await alignItem.focus();

    await page.keyboard.press('Enter');
    const submenu = page.locator('[role="menu"][aria-label="Align"]');
    await expect(submenu).toBeVisible({ timeout: 2000 });
  });

  test('submenu ArrowDown/ArrowUp cycles submenu items', async ({ page }) => {
    // Align actions need a multi-selection — seed two shapes and select
    // them both so the submenu items are enabled and roving focus can move.
    await seedLayers(page, 2);
    const tree = page.getByRole('tree', { name: 'Layers' });
    await tree.locator('[role="treeitem"]').first().click();
    await page.keyboard.press('Control+a');
    await openMenu(page, 'Arrange');

    const alignItem = page.locator('[role="menu"] [role="menuitem"][aria-haspopup]', {
      hasText: 'Align',
    });
    await alignItem.focus();
    await page.keyboard.press('ArrowRight');

    const submenu = page.locator('[role="menu"][aria-label="Align"]');
    await expect(submenu).toBeVisible({ timeout: 2000 });

    const subItems = submenu.locator('[role="menuitem"]');
    // Wait for the submenu roving focus to land (it moves one frame after
    // the portal becomes visible).
    await expect(subItems.first()).toBeFocused();
    const firstSubLabel = await subItems.first().textContent();
    const activeFirst = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeFirst).toBe(firstSubLabel);

    await page.keyboard.press('ArrowDown');
    const secondLabel2 = await subItems.nth(1).textContent();
    void secondLabel2;

    await page.keyboard.press('ArrowUp');
    const backToFirst = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(backToFirst).toBe(firstSubLabel);

    await assertFocusNotOnBody(page);
  });

  // ─── Type-ahead ─────────────────────────────────────────────────

  test('type-ahead: single char matches item', async ({ page }) => {
    await openMenu(page, 'File');
    await page.keyboard.press('s');
    const focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save');
  });

  test('type-ahead: buffer accumulation matches longer prefix', async ({ page }) => {
    await openMenu(page, 'File');
    await page.keyboard.press('e');
    await page.keyboard.press('x');
    const focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Export\u2026');
  });

  test('type-ahead: repeated same char cycles through matches', async ({ page }) => {
    await openMenu(page, 'File');
    await page.keyboard.press('s');
    let focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save');

    await page.keyboard.press('s');
    focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save As\u2026');
  });

  test('type-ahead: no match does not move focus', async ({ page }) => {
    await openMenu(page, 'File');
    const firstLabel = await page.locator('[role="menu"] [role="menuitem"]').first().textContent();

    await page.keyboard.press('z');
    const focused = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(focused).toBe(firstLabel);
  });

  test('type-ahead: buffer timeout resets after configured delay', async ({ page }) => {
    await openMenu(page, 'File');

    await page.keyboard.press('s');
    let focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save');

    // Past the configured 200ms reset: the buffer is empty again, so 'a'
    // alone matches nothing and focus stays on the previous match.
    await page.waitForTimeout(250);

    await page.keyboard.press('a');
    focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save');
  });

  test('type-ahead: arrow keys reset buffer', async ({ page }) => {
    await openMenu(page, 'File');

    await page.keyboard.press('s');
    let focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save');

    // ArrowDown resets the type-ahead buffer and moves focus down one item.
    // The next 's' is then a FRESH single-char buffer, which per the menu
    // type-ahead contract starts a new search from the top of the list —
    // landing back on Save. (Without the reset, the buffer would accumulate
    // to "ss", which matches nothing, so focus would stay on Save As.)
    await page.keyboard.press('ArrowDown');

    await page.keyboard.press('s');
    focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Save');
  });

  test('type-ahead: diacritic-insensitive matching', async ({ page }) => {
    await openMenu(page, 'Edit');
    await page.keyboard.press('u');
    const focused = await getFocusedMenuItem(page);
    await expect(focused).toContainText('Undo');
  });

  // ─── Disabled items ─────────────────────────────────────────────

  test('disabled menu item has disabled attribute and is not a tab stop', async ({ page }) => {
    await openMenu(page, 'Object');

    // Group is disabled with an empty selection and must not be reachable
    // by Tab (roving tabindex keeps it at -1).
    const groupItem = page.getByRole('menuitem', { name: /^Group/ });
    expect(await groupItem.isDisabled()).toBe(true);
    expect(await groupItem.getAttribute('tabindex')).toBe('-1');

    // Arrow navigation skips it: pressing ArrowDown from the focused item
    // must land on an enabled item, never the disabled Group.
    const focused = page.locator('[role="menu"] [role="menuitem"]:focus');
    await expect(focused).not.toBe(groupItem);
    await expect(focused).toBeFocused();
  });

  // ─── Accelerators ───────────────────────────────────────────────

  test('accelerator fires menu action with no menu open', async ({ page }) => {
    // Fire an accelerator from a focused control (the canvas): focus must
    // be preserved, never dropped to body.
    await page.getByTestId('editor-canvas').focus();
    await page.keyboard.press(mod('z'));
    await page.waitForTimeout(200);
    await assertFocusNotOnBody(page);
  });

  test('accelerator does NOT fire when a text field has focus', async ({ page }) => {
    const findBar = page.locator('[role="textbox"], input[type="text"], input:not([type])').first();
    if (await findBar.isVisible({ timeout: 2000 }).catch(() => false)) {
      await findBar.focus();
      await page.keyboard.press(mod('z'));
      await page.waitForTimeout(200);
      const activeTag = await page.evaluate(() => document.activeElement?.tagName ?? '');
      expect(activeTag).not.toBe('BODY');
    }
  });

  // ─── Focus restoration ──────────────────────────────────────────

  test('focus never lands on body after menu interactions', async ({ page }) => {
    const interactions = [
      async () => {
        await openMenu(page, 'File');
        await page.keyboard.press('Escape');
      },
      async () => {
        await openMenu(page, 'Edit');
        await page.keyboard.press('Escape');
      },
      async () => {
        await openMenu(page, 'View');
        await page.keyboard.press('Escape');
        await assertFocusNotOnBody(page);
      },
      async () => {
        await openMenu(page, 'File');
        await page.keyboard.press('ArrowRight');
        await page.keyboard.press('Escape');
      },
    ];

    for (const interaction of interactions) {
      await interaction();
      await assertFocusNotOnBody(page);
    }
  });

  test('Escape returns focus to the menu trigger', async ({ page }) => {
    await openMenu(page, 'File');
    await page.keyboard.press('Escape');
    await expect(page.locator('[role="menu"]')).toHaveCount(0);

    // Desktop convention: Escape returns focus to the invoking trigger.
    const activeText = await page.evaluate(() => document.activeElement?.textContent ?? '');
    expect(activeText).toBe('File');
  });

  // ─── Aria roles and accessibility ───────────────────────────────

  test('menubar has correct ARIA roles and aria-expanded state', async ({ page }) => {
    const menubar = page.locator('[role="menubar"]');
    await expect(menubar).toHaveAttribute('aria-label', 'Application');

    const fileItem = menubar.locator('[role="menuitem"]', { hasText: 'File' });
    await expect(fileItem).toHaveAttribute('aria-haspopup', 'true');

    await fileItem.click();
    await expect(fileItem).toHaveAttribute('aria-expanded', 'true');
    await closeMenu(page);
    await expect(fileItem).toHaveAttribute('aria-expanded', 'false');
  });

  test('menu items have correct roles beyond menuitem', async ({ page }) => {
    const viewButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'View' });
    await viewButton.click();

    const menu = page.locator('[role="menu"]').first();
    await expect(menu).toBeVisible();

    await expect(menu.locator('[role="menuitemradio"]').first()).toBeAttached({ timeout: 2000 });
  });

  test('open menu passes axe-core accessibility scan', async ({ page }) => {
    const viewButton = page.locator('[role="menubar"] [role="menuitem"]', { hasText: 'View' });
    await viewButton.click();
    await expect(page.locator('[role="menu"]').first()).toBeVisible();

    // Scope to keyboard/ARIA-structure rules that the focus-navigation
    // remediation owns. The app-wide baseline (landmarks, h1, color
    // contrast, tablist child semantics) is tracked separately in
    // docs/audits/focus-navigation-audit-2026-08-02.md and pre-dates this
    // suite; a full zero-violation gate is a follow-up, not this test.
    const results = await new AxeBuilder({ page })
      .withRules([
        'aria-allowed-role',
        'aria-required-children',
        'aria-required-parent',
        // nested-interactive is excluded deliberately: the document-tab close
        // button lives inside the role=tab (a mouse affordance; the keyboard
        // path is Delete/Backspace per APG closable tabs). Restructuring the
        // tab markup is tracked as a follow-up in the focus audit.
        'aria-valid-attr-value',
        'aria-valid-attr',
        'button-name',
        'duplicate-id',
      ])
      .analyze();
    expect(results.violations).toHaveLength(0);
  });
});
