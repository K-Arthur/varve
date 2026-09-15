import { expect, type Locator, type Page, type TestInfo, test } from '@playwright/test';
import { navigateToEditor, navigateToHome } from '../shared';

/**
 * Popover contract, exercised on the real surfaces.
 *
 * These specs pin the behaviours the 2026-09-15 popover review repaired:
 * Escape and outside-pointer dismissal, keyboard entry and focus return,
 * deterministic trigger toggling, listbox arrow/type-ahead navigation, and
 * the rule that an implicit tool-options open never steals canvas focus.
 */

async function describeActiveElement(page: Page): Promise<string> {
  return page.evaluate(() => {
    const el = document.activeElement as HTMLElement | null;
    if (!el) return 'none';
    return `${el.tagName.toLowerCase()}#${el.id}.${el.className}`.slice(0, 120);
  });
}

async function focusIsInside(page: Page, selector: string): Promise<boolean> {
  return page.evaluate((sel) => {
    const container = document.querySelector(sel);
    return Boolean(
      container && document.activeElement && container.contains(document.activeElement),
    );
  }, selector);
}

/** Capture and attach a labelled screenshot for visual review. */
async function capture(page: Page, testInfo: TestInfo, name: string): Promise<void> {
  // Let the surface finish its open transition; a mid-transition frame is
  // partial-opacity and would misrepresent contrast in review.
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
  await page.waitForTimeout(250);
  const buffer = await page.screenshot({ path: testInfo.outputPath(`${name}.png`) });
  await testInfo.attach(name, { body: buffer, contentType: 'image/png' });
}

test.describe('Home popovers', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToHome(page);
  });

  test('filters popover: keyboard entry, escape, toggle, and in-panel editing', async ({
    page,
  }, testInfo) => {
    const trigger = page.getByRole('button', { name: /^Filters/ });
    const dialog = page.locator('.filter-dropdown');
    await trigger.waitFor({ state: 'visible', timeout: 30000 });

    // Keyboard open moves focus into the panel (APG dialog entry).
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(dialog).toBeVisible();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    expect(await focusIsInside(page, '.filter-dropdown')).toBe(true);
    await capture(page, testInfo, 'filters-keyboard-open');
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await capture(page, testInfo, 'filters-keyboard-open-dark');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

    // The panel is a non-modal dialog: Tab reaches its controls, and Escape
    // closes it from inside and returns focus to the trigger.
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    await expect(trigger).toBeFocused();

    // Pointer open keeps focus where the user was (trigger), and a second
    // trigger activation closes the panel.
    await trigger.click();
    await expect(dialog).toBeVisible();
    expect(await page.evaluate(() => document.activeElement?.getAttribute('aria-label'))).toMatch(
      /^Filters/,
    );
    await trigger.click();
    await expect(dialog).toBeHidden();

    // Editing a date field must not dismiss the panel; Escape from inside
    // still closes it and restores the trigger.
    await trigger.click();
    const from = dialog.getByLabel('From');
    await from.click();
    await from.fill('2026-01-01');
    await expect(dialog).toBeVisible();
    await expect(from).toHaveValue('2026-01-01');
    await capture(page, testInfo, 'filters-date-editing');
    await page.keyboard.press('Escape');
    await expect(dialog).toBeHidden();
    await expect(trigger).toBeFocused();

    // Outside pointer input dismisses.
    await trigger.click();
    await expect(dialog).toBeVisible();
    await page.mouse.click(20, 20);
    await expect(dialog).toBeHidden();
  });

  test('workspace filter listbox: arrows, type-ahead, select, escape', async ({
    page,
  }, testInfo) => {
    const trigger = page.getByRole('button', { name: 'Workspace filter' });
    if (!(await trigger.isVisible().catch(() => false))) {
      test.skip(true, 'Workspace filter is only shown on the recent section');
    }
    // The trigger must announce a listbox, not a dialog.
    await expect(trigger).toHaveAttribute('aria-haspopup', 'listbox');

    // ArrowDown opens the listbox and focuses the selected option.
    await trigger.focus();
    await page.keyboard.press('ArrowDown');
    const listbox = page.getByRole('listbox', { name: 'Workspace filter' });
    await expect(listbox).toBeVisible();
    const allRecent = listbox.getByRole('option', { name: 'All Recent' });
    await expect(allRecent).toBeFocused();
    await capture(page, testInfo, 'workspace-filter-open');

    // Arrow keys move focus; type-ahead jumps by label.
    await page.keyboard.press('ArrowDown');
    await expect(listbox.getByRole('option', { name: 'Relevant to Workspace' })).toBeFocused();
    await capture(page, testInfo, 'workspace-filter-arrow-focus');
    await page.keyboard.press('p');
    await expect(listbox.getByRole('option', { name: 'Pinned Only' })).toBeFocused();

    // Enter chooses and closes, updating the trigger label.
    await page.keyboard.press('Enter');
    await expect(listbox).toBeHidden();
    await expect(trigger).toContainText('Pinned Only');
    await expect(trigger).toBeFocused();

    // Reopen and dismiss with Escape restores focus to the trigger.
    await page.keyboard.press('ArrowDown');
    await expect(listbox).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(listbox).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});

async function startTextEditing(page: Page): Promise<Locator> {
  await navigateToEditor(page);
  const editorShell = page.locator('.editor-shell');
  await editorShell.waitFor({ state: 'visible', timeout: 60000 });
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await expect(canvas).toBeVisible();
  const bounds = await canvas.boundingBox();
  if (!bounds) throw new Error('Canvas has no bounds');
  const textTool = page.locator('[data-testid="toolbar"] [data-tool="text"]');
  if (await textTool.isVisible({ timeout: 1000 }).catch(() => false)) {
    await textTool.click({ timeout: 15000 });
  } else {
    const contextText = page.getByRole('button', { name: 'Add text', exact: true });
    await contextText.waitFor({ state: 'visible', timeout: 15000 });
    await contextText.click({ timeout: 15000 });
  }
  await page.mouse.move(bounds.x + 140, bounds.y + 180);
  await page.mouse.down();
  await page.mouse.move(bounds.x + 380, bounds.y + 240);
  await page.mouse.up();
  await page.keyboard.insertText('Popover contract');
  const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
  if (!(await toolbar.isVisible({ timeout: 1500 }).catch(() => false))) {
    const edit = page.getByRole('button', { name: 'Edit text', exact: true }).first();
    await edit.waitFor({ state: 'visible', timeout: 15000 });
    await edit.click({ timeout: 15000 });
  }
  await expect(toolbar).toBeVisible({ timeout: 15000 });
  return toolbar;
}

test.describe('Editor popovers', () => {
  test('text colour popover: escape returns focus, pointer toggle, keyboard entry', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    const textBar = await startTextEditing(page);
    const swatch = textBar.getByRole('button', { name: 'Text color' });
    const colorDialogSelector = '[role="dialog"][aria-label="Text color picker"]';
    const popover = page.locator(colorDialogSelector);

    // Pointer open does not steal focus from the swatch; Escape closes and
    // restores it. (Regression: Escape previously did nothing when focus was
    // on the trigger because the native popover only handles it when focus is
    // inside the panel.)
    await swatch.click();
    await expect(popover).toBeVisible();
    await expect(swatch).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(swatch).toBeFocused();

    // Trigger toggle closes on a second activation.
    await swatch.click();
    await expect(popover).toBeVisible();
    await swatch.click();
    await expect(popover).toBeHidden();

    // Keyboard open moves focus into the picker.
    await swatch.focus();
    await page.keyboard.press('Enter');
    await expect(popover).toBeVisible();
    expect(await focusIsInside(page, colorDialogSelector)).toBe(true);
    await capture(page, testInfo, 'text-colour-keyboard-open');
    await page.keyboard.press('Escape');
    await expect(popover).toBeHidden();
    await expect(swatch).toBeFocused();
  });

  test('tool options: implicit open never steals focus; keyboard open focuses in', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    const photo = page.locator('.workspace-dock__item[aria-label="Photo workspace"]');
    if (!(await photo.isVisible().catch(() => false))) {
      await page.getByRole('button', { name: 'More workspaces' }).click();
      await page.getByRole('menuitemradio', { name: 'Photo' }).click();
    } else {
      await photo.click();
    }

    const toolbar = page.locator('[data-testid="toolbar"]');
    const marquee = toolbar.locator('[data-tool="marquee"]');
    await expect(marquee).toBeVisible();
    await marquee.click();

    const trigger = page.getByRole('button', { name: 'Tool options' });
    const panel = page.locator('[data-testid="marquee-options"]');
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(panel).toBeVisible();
    // Selecting a tool surfaces its options but must not move focus off the
    // tool/canvas: the popover is informational until the user engages it.
    expect(await focusIsInside(page, '.tool-options__content')).toBe(false);
    await capture(page, testInfo, 'tool-options-implicit-open');

    // Close, then open explicitly with the keyboard: focus enters the panel.
    await trigger.click();
    await expect(panel).toBeHidden();
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    expect(await focusIsInside(page, '.tool-options__content')).toBe(true);
    await capture(page, testInfo, 'tool-options-keyboard-open');

    // Tab from the last control closes the panel and leaves focus in the page
    // rather than the portaled body end.
    const focusableCount = await page
      .locator('.tool-options__content')
      .evaluate(
        (el) =>
          el.querySelectorAll(
            'button:not([disabled]), input:not([disabled]), select:not([disabled]), textarea:not([disabled]), [tabindex]:not([tabindex="-1"])',
          ).length,
      );
    for (let i = 0; i < focusableCount; i++) await page.keyboard.press('Tab');
    await expect(panel).toBeHidden();
    const active = await describeActiveElement(page);
    expect(active).not.toContain('tool-options__content');

    // Escape from a keyboard-opened panel returns focus to the trigger.
    await trigger.focus();
    await page.keyboard.press('Enter');
    await expect(panel).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(panel).toBeHidden();
    await expect(trigger).toBeFocused();
  });
});
