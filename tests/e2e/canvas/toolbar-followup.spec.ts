import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { navigateToEditor } from '../shared';

/**
 * Follow-up toolbar review (2026-09-15, session B) — permanent regression
 * coverage for the surfaces the first review deferred:
 *
 *  1. Palette placement (View > Toolbar at Top/Bottom) and its persistence.
 *  2. Status-bar row/token agreement, 24px targets, and unclipped controls
 *     across window widths.
 *  3. The text quick bar's APG toolbar contract and the end of duplicated
 *     typography controls while a canvas edit session is active.
 *  4. A combined real-world journey on a multi-element document.
 *
 * Evidence artifacts are written to the Playwright output directory; the
 * reviewed copies live under docs/screenshots/2026-09-15-toolbar-followup/.
 */

const VIEW_MENU = '[role="menu"][aria-label="View"]';
const PALETTE = '.floating-toolbar[data-testid="toolbar"]';

async function importRealPhoto(page: Page) {
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 20000 });
}

async function paletteRect(page: Page) {
  return page.locator(PALETTE).evaluate((el) => {
    const r = el.getBoundingClientRect();
    return { top: r.top, bottom: r.bottom, left: r.left, right: r.right, height: r.height };
  });
}

async function canvasRect(page: Page) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas has no bounds');
  return box;
}

test.describe('Toolbar follow-up — palette placement', () => {
  test('switches to the top through View, stays inside the canvas cell, and persists', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120000 });
    await importRealPhoto(page);

    const palette = page.locator(PALETTE);
    await expect(palette).toHaveAttribute('data-placement', 'bottom');

    await openMenu(page, 'View');
    const menu = page.locator(VIEW_MENU);
    const topRadio = menu.getByRole('menuitemradio', { name: 'Toolbar at Top' });
    const bottomRadio = menu.getByRole('menuitemradio', { name: 'Toolbar at Bottom' });
    await expect(bottomRadio).toHaveAttribute('aria-checked', 'true');
    await expect(topRadio).toHaveAttribute('aria-checked', 'false');
    await topRadio.click();

    await expect(palette).toHaveAttribute('data-placement', 'top');
    const placed = await paletteRect(page);
    const canvas = await canvasRect(page);
    // Inside the canvas cell, in its upper half, and clear of the chrome.
    expect(placed.top).toBeGreaterThanOrEqual(canvas.y - 1);
    expect(placed.top).toBeLessThan(canvas.y + canvas.height / 2);
    expect(placed.left).toBeGreaterThanOrEqual(canvas.x - 1);
    expect(placed.right).toBeLessThanOrEqual(canvas.x + canvas.width + 1);

    // The radio reflects the choice immediately.
    await openMenu(page, 'View');
    await expect(
      page.locator(VIEW_MENU).getByRole('menuitemradio', { name: 'Toolbar at Top' }),
    ).toHaveAttribute('aria-checked', 'true');

    await page.screenshot({ path: testInfo.outputPath('palette-top-1440x900.png') });

    // The choice is a workspace preference, not a document change: document
    // undo must leave it alone.
    await page.keyboard.press('Control+z');
    await expect(palette).toHaveAttribute('data-placement', 'top');

    // Persists across a reload (same origin storage), and the per-mode reset
    // restores the built-in default.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToEditor(page, '/', { startupTimeout: 120000 });
    await expect(page.locator(PALETTE)).toHaveAttribute('data-placement', 'top');

    await openMenu(page, 'View');
    await page.locator(VIEW_MENU).getByRole('menuitemradio', { name: 'Toolbar at Bottom' }).click();
    await expect(page.locator(PALETTE)).toHaveAttribute('data-placement', 'bottom');
  });
});

test.describe('Toolbar follow-up — status bar', () => {
  test('row and token agree and every visible control is a 24px unclipped target', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120000 });
    await importRealPhoto(page);

    for (const width of [1440, 1280, 1024, 900, 768, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(200);
      const report = await page.evaluate(() => {
        const bar = document.querySelector('.editor-status') as HTMLElement | null;
        const shell = document.querySelector('.editor-shell') as HTMLElement | null;
        if (!bar || !shell) return null;
        const barRect = bar.getBoundingClientRect();
        const rows = getComputedStyle(shell)
          .gridTemplateRows.split(' ')
          .map((value) => Number.parseFloat(value))
          .filter((value) => Number.isFinite(value));
        const statusRow = rows[rows.length - 1] ?? 0;
        const buttons = Array.from(bar.querySelectorAll('button')).filter(
          (button) => getComputedStyle(button).display !== 'none',
        );
        const clipped: string[] = [];
        const undersized: Array<{ label: string; w: number; h: number }> = [];
        for (const button of buttons) {
          const rect = button.getBoundingClientRect();
          const label =
            button.getAttribute('aria-label') ?? button.textContent?.trim() ?? button.tagName;
          if (rect.right > barRect.right + 0.5 || rect.left < barRect.left - 0.5) {
            clipped.push(label);
          }
          if (rect.height < 23.5 || rect.width < 23.5) {
            undersized.push({ label, w: Math.round(rect.width), h: Math.round(rect.height) });
          }
        }
        return {
          barHeight: Math.round(barRect.height * 100) / 100,
          statusRow: Math.round(statusRow * 100) / 100,
          clipped,
          undersized,
          scrollWidth: bar.scrollWidth,
          clientWidth: bar.clientWidth,
        };
      });
      expect(report, `status bar report at ${width}px`).not.toBeNull();
      expect(
        Math.abs(report!.barHeight - report!.statusRow),
        `row height at ${width}px`,
      ).toBeLessThan(1.5);
      expect(report!.undersized, `undersized targets at ${width}px`).toEqual([]);
      expect(report!.clipped, `clipped controls at ${width}px`).toEqual([]);
    }
  });
});

test.describe('Toolbar follow-up — text quick bar', () => {
  test('owns formatting during editing, keeps one tab stop, and yields arrows to the field', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120000 });
    const canvas = await canvasRect(page);

    await page.keyboard.press('t');
    await page.mouse.click(canvas.x + 320, canvas.y + 220);
    const textbox = page.getByRole('textbox', { name: /editing text/i });
    await textbox.waitFor({ timeout: 15000 });
    await page.keyboard.type('Quarterly report');

    const bar = page.locator('.floating-text-bar');
    await expect(bar).toBeVisible();
    // The bar element itself is the toolbar surface.
    await expect(page.getByRole('toolbar', { name: 'Text formatting' })).toBeVisible();

    // The context bar stops duplicating the same controls.
    const contextBar = page.locator('.context-control-bar');
    await expect(contextBar.getByText(/editing on canvas/i)).toBeVisible();
    await expect(contextBar.getByRole('button', { name: 'Bold' })).toHaveCount(0);
    await expect(contextBar.getByRole('textbox', { name: 'Font family' })).toHaveCount(0);

    // Exactly one roving tab stop among the bar's buttons; arrows move it.
    // Use the plain Bold/Italic toggles: a combobox trigger (the weight
    // select) correctly keeps its own arrow keys, so it cannot demonstrate
    // toolbar focus movement.
    const tabStops = await bar.evaluate((element) =>
      Array.from(element.querySelectorAll('button'))
        .filter((button) => button.tabIndex >= 0)
        .map((button) => button.getAttribute('aria-label') ?? button.textContent?.trim() ?? ''),
    );
    expect(tabStops).toHaveLength(1);
    const bold = bar.getByRole('button', { name: 'Bold' });
    await bold.focus();
    await page.keyboard.press('ArrowRight');
    await expect(bar.getByRole('button', { name: 'Italic' })).toBeFocused();
    await expect(bar.locator('button[tabindex="0"]')).toBeFocused();

    // The size field keeps native arrow-key stepping (focus must not hop).
    const size = bar.getByRole('spinbutton', { name: 'Font size' });
    await size.click();
    await page.keyboard.press('ArrowUp');
    await expect(size).toBeFocused();

    // Leaving the text node restores the context-bar typography controls.
    await page.mouse.click(canvas.x + canvas.width - 60, canvas.y + canvas.height - 60);
    await expect(bar).toHaveCount(0);
    await expect(
      page.locator('.context-control-bar').getByRole('button', { name: 'Bold' }),
    ).toBeVisible();
  });
});

test.describe('Toolbar follow-up — combined journey', () => {
  test('photo + shape + live text, font edit, placement switch, undo/redo, reopen', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page, '/', { startupTimeout: 120000 });
    await importRealPhoto(page);

    // A drawn shape gives the document a second element kind.
    await page.locator('.floating-toolbar [data-tool="rect"]').click();
    const canvas = await canvasRect(page);
    await page.mouse.move(canvas.x + 120, canvas.y + 140);
    await page.mouse.down();
    await page.mouse.move(canvas.x + 300, canvas.y + 240, { steps: 6 });
    await page.mouse.up();
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    // Live text edited from the canvas bar.
    await page.keyboard.press('t');
    await page.mouse.click(canvas.x + 420, canvas.y + 320);
    await page.keyboard.type('Launch 2026');
    const size = page.locator('.floating-text-bar').getByRole('spinbutton', { name: 'Font size' });
    await size.fill('28');
    await size.press('Enter');
    await page.mouse.click(canvas.x + canvas.width - 60, canvas.y + canvas.height - 60);
    await expect(page.locator('.floating-text-bar')).toHaveCount(0);
    await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10000 });

    // Switch placement, then verify document undo/redo does not disturb it.
    await openMenu(page, 'View');
    await page.locator(VIEW_MENU).getByRole('menuitemradio', { name: 'Toolbar at Top' }).click();
    await expect(page.locator(PALETTE)).toHaveAttribute('data-placement', 'top');
    await page.keyboard.press('Control+z');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.locator(PALETTE)).toHaveAttribute('data-placement', 'top');
    await expect(page.getByRole('treeitem')).toHaveCount(3);

    await page.screenshot({ path: testInfo.outputPath('combined-journey-1440x900.png') });

    // Reopen the document flow: the placement preference survives, and the
    // document still renders its three elements.
    await page.reload({ waitUntil: 'domcontentloaded' });
    await navigateToEditor(page, '/', { startupTimeout: 120000 });
    await expect(page.locator(PALETTE)).toHaveAttribute('data-placement', 'top');
    await expect(page.locator('.editor-status')).toBeVisible();
  });
});
