import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Workspace navigation contracts added with the unified navigation model:
 *
 * 1. The workspace switcher is a complete APG radiogroup: roving tabindex
 *    (exactly one radio in the tab order), arrow keys activate the
 *    neighbor, Home/End jump, and the active workspace stays checked.
 * 2. Closing a dirty document tab offers Save / Don't save / Cancel —
 *    Cancel keeps the tab open; Don't save closes it; Save persists.
 */

test.describe('Workspace switcher keyboard contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
  });

  test('roving tabindex: only the active radio is in the tab order', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Workspace' });
    await expect(group.getByRole('radio', { name: /^Design workspace$/ })).toHaveAttribute(
      'tabindex',
      '0',
    );
    for (const name of ['Print', 'Draw', 'Photo', 'Motion', 'Codegen & Audit', 'Logo']) {
      await expect(
        group.getByRole('radio', { name: new RegExp(`^${name} workspace$`) }),
      ).toHaveAttribute('tabindex', '-1');
    }
  });

  test('ArrowRight activates the next workspace and moves the roving index', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Workspace' });
    const design = group.getByRole('radio', { name: /^Design workspace$/ });
    await design.focus();
    await page.keyboard.press('ArrowRight');

    const draw = group.getByRole('radio', { name: /^Draw workspace$/ });
    await expect(draw).toHaveAttribute('aria-checked', 'true');
    await expect(draw).toHaveAttribute('tabindex', '0');
    await expect(design).toHaveAttribute('tabindex', '-1');
  });

  test('Home and End jump to the first and last workspace', async ({ page }) => {
    const group = page.getByRole('radiogroup', { name: 'Workspace' });
    await group.getByRole('radio', { name: /^Print workspace$/ }).focus();

    await page.keyboard.press('Home');
    await expect(group.getByRole('radio', { name: /^Design workspace$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );

    await page.keyboard.press('End');
    await expect(group.getByRole('radio', { name: /^Logo workspace$/ })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('pointer activation switches without programmatic focus moves', async ({ page }) => {
    // Activate with a raw mouse click (bypasses Playwright's click-focus).
    const print = page.getByRole('radiogroup', { name: 'Workspace' }).getByRole('radio', {
      name: /^Print workspace$/,
    });
    const box = await print.boundingBox();
    if (!box) throw new Error('workspace radio not found');
    await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);

    await expect(print).toHaveAttribute('aria-checked', 'true');
    // Native button focus-on-click may land on the radio — that is standard
    // browser behavior, not theft. What must NOT happen: the app
    // force-moving focus to the canvas (or anywhere else) after a
    // pointer-triggered switch.
    const active = await page.evaluate(() => document.activeElement?.tagName);
    expect(active).toBe('BUTTON');
  });
});

test.describe('Dirty document tab close flow', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
  });

  async function makeDocumentDirty(page: Page) {
    // Draw a rectangle so the document is dirty.
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'attached' });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.move(box.x + 200, box.y + 200);
    await page.mouse.down();
    await page.mouse.move(box.x + 320, box.y + 320);
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
  }

  test('closing a dirty tab offers Save / Don\u2019t save / Cancel', async ({ page }) => {
    await makeDocumentDirty(page);

    const before = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.editor-tabs__tab')).map((t) => ({
        name: t.querySelector('.editor-tabs__name')?.textContent,
        dirty: !!t.querySelector('.editor-tabs__dirty-dot'),
      })),
    );
    // The bootstrap session's exact name varies with the host flow; what
    // matters is that drawing a shape marked the tab dirty.
    expect(before).toHaveLength(1);
    expect(before[0]!.dirty).toBe(true);

    // Open a second document, then close the dirty one from its tab.
    await page.getByRole('button', { name: /new document/i }).click();
    const tabs = page.getByRole('tablist', { name: /open documents/i }).getByRole('tab');
    await expect(tabs).toHaveCount(2);

    const after = await page.evaluate(() =>
      Array.from(document.querySelectorAll('.editor-tabs__tab')).map((t) => ({
        name: t.querySelector('.editor-tabs__name')?.textContent,
        dirty: !!t.querySelector('.editor-tabs__dirty-dot'),
      })),
    );
    // First tab: the dirty one (from `before`). Second tab: fresh, clean.
    expect(after).toHaveLength(2);
    expect(after[0]!.dirty).toBe(true);
    expect(after[1]!.dirty).toBe(false);

    const firstTab = tabs.first();
    await firstTab.getByRole('button', { name: /^Close/ }).click();

    const dialog = page.getByRole('dialog');
    await expect(dialog).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Save', exact: true })).toBeVisible();
    await expect(dialog.getByRole('button', { name: "Don't save" })).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Cancel' })).toBeVisible();
  });

  test('Cancel keeps the dirty tab open and preserves the document', async ({ page }) => {
    await makeDocumentDirty(page);
    await page.getByRole('button', { name: /new document/i }).click();
    const tabs = page.getByRole('tablist', { name: /open documents/i }).getByRole('tab');
    await tabs
      .first()
      .getByRole('button', { name: /^Close/ })
      .click();

    await page.getByRole('dialog').getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tabs).toHaveCount(2);
    // The shape is still there when we return to the dirty tab.
    await tabs.first().click();
    await expect(page.getByRole('treeitem')).toHaveCount(1);
  });

  test("Don't save closes the dirty tab", async ({ page }) => {
    await makeDocumentDirty(page);
    await page.getByRole('button', { name: /new document/i }).click();
    const tabs = page.getByRole('tablist', { name: /open documents/i }).getByRole('tab');
    await tabs
      .first()
      .getByRole('button', { name: /^Close/ })
      .click();

    await page.getByRole('dialog').getByRole('button', { name: "Don't save" }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(tabs).toHaveCount(1);
  });
});
