/**
 * Bottom bar contract — `SelectionInfoBar` + `StatusBar`.
 *
 * The row is a stack of two strips, and the whole point of this spec is that
 * each fact appears in exactly one of them: selection identity/geometry above,
 * instrumentation and view controls below. The component tests cover section
 * gating and ordering in jsdom; this drives the real shell, real preference
 * persistence, and real geometry, which is where the previous duplicates
 * actually lived (docs/audits/bottom-bar-review-2026-09-29.md).
 *
 * Run with:
 * npx playwright test tests/e2e/workspace/bottom-bar.spec.ts --project=chromium --reporter=list
 */

import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });

/** Run a registered command through the real command palette. */
async function runPaletteAction(page: Page, query: string, optionName: RegExp) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ timeout: 30_000 });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill(query);
  await palette.getByRole('option', { name: optionName }).first().click({ timeout: 15_000 });
  await expect(palette).toBeHidden({ timeout: 10_000 });
}

async function openCustomize(page: Page) {
  await runPaletteAction(page, 'Customize Workspace', /^Customize Workspace$/);
  const dialog = page.getByRole('dialog', { name: /Customize Design workspace/i });
  await expect(dialog).toBeVisible();
  return dialog;
}

test.describe('bottom bar', () => {
  test.setTimeout(240_000);

  test('every fact has exactly one owner across the two strips', async ({ page }) => {
    await navigateToEditor(page);

    const status = page.locator('.editor-status');
    const selectionStrip = page.locator('.selection-info-bar');
    await expect(status).toBeVisible();
    await expect(selectionStrip).toBeVisible();

    // 1. Nothing selected yet, so the fit cluster must not offer an action
    //    that cannot do anything.
    await expect(
      page.getByRole('button', { name: 'Fit selection to viewport', exact: true }),
    ).toHaveCount(0);

    // 2. Zoom: one input, one id. The menubar used to carry a second one with
    //    the same accessible name (Illustrator shipped this pair and broke it).
    await expect(page.locator('#status-zoom')).toHaveCount(1);
    await expect(page.locator('#menubar-zoom')).toHaveCount(0);
    await expect(page.locator('input[aria-label^="Zoom "]:not([aria-label="Zoom"])')).toHaveCount(
      1,
    );

    // 3. Document health: at most one badge, and never the three it replaced.
    await expect(page.locator('.audit-badge')).toHaveCount(0);
    await expect(page.locator('.debt-badge')).toHaveCount(0);
    await expect(page.locator('.editor-status__score-badge')).toHaveCount(0);
    expect(await page.locator('.document-health-badge').count()).toBeLessThanOrEqual(1);

    // 4. Save state is always present — clamped by ESSENTIAL_STATUS_SECTION_IDS.
    await expect(page.getByRole('button', { name: /open Document Info/i })).toBeVisible();

    // 5. The grid-spacing field is labelled and only present while it can do
    //    something. Snapping is on by default, so it shows now; turning snapping
    //    off removes it instead of leaving a number that changes nothing.
    await expect(page.getByLabel('Grid spacing in pixels')).toBeVisible();
    await page.getByRole('button', { name: 'Disable snapping' }).click();
    await expect(page.getByLabel('Grid spacing in pixels')).toHaveCount(0);
    await page.getByRole('button', { name: 'Enable snapping' }).click();
    await expect(page.getByLabel('Grid spacing in pixels')).toBeVisible();

    // 6. Selection identity: SelectionInfoBar only.
    await seedLayers(page, 3);
    await page.getByRole('treeitem').first().click();
    const nodeName = await page.locator('.selection-info-bar__name').innerText({ timeout: 10_000 });
    expect(nodeName.trim().length).toBeGreaterThan(0);
    await expect(selectionStrip).toContainText(nodeName);
    // The status bar used to repeat the node name, a selection count, and a
    // layer count derived differently from the strip above it.
    await expect(status).not.toContainText(nodeName);
    await expect(status).not.toContainText('selected');
    await expect(status).not.toContainText('layers');

    // 7. …and with a selection, "Fit selection" appears.
    await expect(
      page.getByRole('button', { name: 'Fit selection to viewport', exact: true }),
    ).toHaveCount(1);
  });

  test('information reads left of controls, and the customize dialog drives both', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await seedLayers(page, 1);

    const status = page.locator('.editor-status');
    const saveBox = await page.getByRole('button', { name: /open Document Info/i }).boundingBox();
    const unitsBox = await status.getByRole('combobox', { name: 'Units' }).boundingBox();
    expect(saveBox).not.toBeNull();
    expect(unitsBox).not.toBeNull();
    expect(saveBox!.x).toBeLessThan(unitsBox!.x);

    const dialog = await openCustomize(page);
    // The whole row is described by its sections, so every section the dialog
    // lists resolves to something, and the one section a workspace may not hide
    // says so instead of offering a checkbox that silently fails.
    await expect(dialog.getByText('Status Bar Sections')).toBeVisible();
    const saveToggle = dialog.getByRole('checkbox', { name: /Save Status/ });
    await expect(saveToggle).toBeDisabled();
    await expect(dialog.getByText(/Always shown/)).toBeVisible();

    // Toggle through the row's own label. A force-click on the 1px native
    // input aims at whatever sits above it, and in a long dialog that can be
    // the sticky footer — which closes the dialog instead of toggling.
    const toggleSection = async (name: string) => {
      const label = dialog.getByText(name, { exact: true });
      await label.scrollIntoViewIfNeeded();
      await label.click();
      await expect(dialog).toBeVisible();
    };

    await toggleSection('View Toggles');
    await expect(page.locator('.editor-status__view-group')).toHaveCount(0);
    await toggleSection('View Toggles');
    await expect(page.locator('.editor-status__view-group')).toHaveCount(1);

    // Units is a deterministic section: a clean document has no health
    // findings to show or hide, so the round trip proves the dialog drives the
    // row on a section whose output is always present.
    await toggleSection('Units');
    await expect(status.getByRole('combobox', { name: 'Units' })).toHaveCount(0);
    await toggleSection('Units');
    await expect(status.getByRole('combobox', { name: 'Units' })).toHaveCount(1);

    const healthToggle = dialog.getByRole('checkbox', { name: 'Document Health' });
    await expect(healthToggle).toBeChecked();
    await toggleSection('Document Health');
    await expect(healthToggle).not.toBeChecked();
    await toggleSection('Document Health');
    await expect(healthToggle).toBeChecked();

    await dialog.getByRole('button', { name: 'Done' }).click();
    await expect(dialog).toBeHidden();
    await expect(page.locator('.editor-status__view-group')).toHaveCount(1);
  });

  test('every visible control is a 24px target with nothing clipped at any width', async ({
    page,
  }) => {
    await navigateToEditor(page, '/', { startupTimeout: 120_000 });
    await seedLayers(page, 2);

    for (const width of [1440, 1280, 1024, 900, 768, 640]) {
      await page.setViewportSize({ width, height: 900 });
      await page.waitForTimeout(250);
      const report = await page.evaluate(() => {
        const bar = document.querySelector('.editor-status');
        if (!bar) return null;
        const barRect = bar.getBoundingClientRect();
        // Buttons AND field-shaped controls. The first version of this check
        // measured only <button>, which is how the grid-spacing input shipped
        // at 28px in a 25.8px content box: a non-button control is still a
        // control in this row.
        const controls = Array.from(
          bar.querySelectorAll('button, input, [role="combobox"], [role="spinbutton"]'),
        ).filter(
          (control) =>
            getComputedStyle(control).display !== 'none' && control.getClientRects().length > 0,
        );
        return {
          barTop: barRect.top,
          barBottom: barRect.bottom,
          buttons: controls.map((button) => {
            const rect = button.getBoundingClientRect();
            return {
              label: button.getAttribute('aria-label') ?? button.textContent ?? '',
              w: rect.width,
              h: rect.height,
              top: rect.top,
              bottom: rect.bottom,
              clippedVertically: rect.bottom > barRect.bottom + 0.5 || rect.top < barRect.top - 0.5,
            };
          }),
          overflowX: getComputedStyle(bar).overflowX,
          scrollWidth: bar.scrollWidth,
          clientWidth: bar.clientWidth,
        };
      });
      expect(report, `status bar present at ${width}px`).not.toBeNull();
      expect(report!.buttons.length, `controls present at ${width}px`).toBeGreaterThan(3);
      for (const button of report!.buttons) {
        expect(button.w, `${button.label} width at ${width}px`).toBeGreaterThan(0);
        expect(button.h, `${button.label} height at ${width}px`).toBeGreaterThanOrEqual(23.5);
        expect(
          button.clippedVertically,
          `${button.label} clips at ${width}px — bar [${report!.barTop.toFixed(1)}, ${report!.barBottom.toFixed(1)}], control [${button.top.toFixed(1)}, ${button.bottom.toFixed(1)}]`,
        ).toBe(false);
      }
      expect(report!.overflowX).toBe('auto');
      if (report!.scrollWidth > report!.clientWidth + 1) {
        // Horizontal overflow must be a scroll surface, not a clip: whatever is
        // past the edge has to be reachable.
        const reachable = await page.locator('.editor-status').evaluate((bar) => {
          (bar as HTMLElement).scrollLeft = (bar as HTMLElement).scrollWidth;
          const barRect = bar.getBoundingClientRect();
          const buttons = Array.from(bar.querySelectorAll('button')).filter(
            (button) => button.getClientRects().length > 0,
          );
          const last = buttons[buttons.length - 1];
          if (!last) return false;
          const rect = last.getBoundingClientRect();
          return rect.left >= barRect.left - 0.5 && rect.right <= barRect.right + 0.5;
        });
        expect(reachable, `last control reachable by scrolling at ${width}px`).toBe(true);
      }
    }
  });
});
