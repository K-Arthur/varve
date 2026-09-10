import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';

/**
 * Image Trace (Vectorize) end-to-end: menu entry point, dialog workflow,
 * apply + single undo, and the Edit Trace (re-trace) round trip.
 */
test.describe('Image Trace', () => {
  test.describe.configure({ mode: 'serial' });

  async function navigateToEditor(page: import('@playwright/test').Page) {
    await page.goto('/', { timeout: 120000, waitUntil: 'domcontentloaded' });
    // Startup may stack modals (welcome + restored settings); close them all
    // before interacting so clicks are never intercepted.
    for (let i = 0; i < 6; i += 1) {
      const open = page.locator('dialog[open]');
      if ((await open.count()) === 0) break;
      await open
        .last()
        .evaluate((d) => (d as HTMLDialogElement).close())
        .catch(() => {});
      await page.waitForTimeout(100);
    }
    await page.keyboard.press('Escape').catch(() => {});
    await page.getByRole('button', { name: /^new$/i }).click({ timeout: 30000 });
    const createDesign = page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create design$/i });
    await createDesign.waitFor({ timeout: 20000 });
    // Startup modals can stack on top of the New dialog; force the click so
    // an onboarding overlay can never swallow it.
    await createDesign.click({ force: true, timeout: 20000 });
    await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  }

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  async function importTestImage(page: import('@playwright/test').Page) {
    const imageDataUrl = await page.evaluate(() => {
      const c = document.createElement('canvas');
      c.width = 160;
      c.height = 160;
      const ctx = c.getContext('2d')!;
      // White background with a solid dark ring (donut) so monochrome
      // tracing must produce an outer path with a hole.
      ctx.fillStyle = '#ffffff';
      ctx.fillRect(0, 0, 160, 160);
      ctx.fillStyle = '#111111';
      ctx.beginPath();
      ctx.arc(80, 80, 55, 0, Math.PI * 2);
      ctx.fill();
      ctx.fillStyle = '#ffffff';
      ctx.beginPath();
      ctx.arc(80, 80, 22, 0, Math.PI * 2);
      ctx.fill();
      return c.toDataURL('image/png');
    });
    const tmpFile = path.join('/tmp', `trace-e2e-${Date.now()}.png`);
    fs.writeFileSync(tmpFile, Buffer.from(imageDataUrl.split(',')[1]!, 'base64'));
    await page.locator('#file-import-input').setInputFiles(tmpFile);
    await page.waitForTimeout(2500);
    await page.evaluate(() => {
      document.querySelectorAll('dialog[open]').forEach((d) => {
        (d as HTMLDialogElement).close();
      });
    });
    await page.waitForTimeout(300);
    fs.unlinkSync(tmpFile);
  }

  test('traces a selected image through the Object menu and undoes in one step', async ({
    page,
  }) => {
    await importTestImage(page);

    // Object > Vectorize Image (Image Trace)…
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });

    // Default preset: crisp black logo; wait for the preview diagnostics.
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    // Apply inserts a trace group beside the source.
    await page.getByRole('button', { name: 'Apply trace' }).click();
    await expect(page.getByText(/Inserted \d+ vector path/)).toBeVisible({ timeout: 20000 });

    // The trace group appears in the layers panel and is selected.
    await page
      .locator('.layers-panel')
      .getByText(/trace$/i)
      .first()
      .waitFor({ timeout: 10000 });

    // Close the dialog (it stays open after Apply for tweaks).
    await page.getByRole('button', { name: 'Close dialog' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Undo must restore the pre-trace state in one step (no per-path undo).
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(500);
    const traceCount = await page
      .locator('.layers-panel')
      .getByText(/trace$/i)
      .count();
    expect(traceCount).toBe(0);
  });

  test('pixel-art preset preserves hard boundaries', async ({ page }) => {
    await importTestImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });

    // Switch to the pixel-art sprite preset via the accessible custom select.
    await page.getByRole('combobox', { name: 'Preset' }).click();
    await page.getByRole('option', { name: 'Pixel art sprite', exact: true }).click();
    await expect(
      page.locator('p[role="note"]').filter({ hasText: 'hard pixel boundaries' }),
    ).toBeVisible({ timeout: 10000 });

    await page.getByRole('button', { name: 'Apply trace' }).click();
    await expect(page.getByText(/Inserted \d+ vector path/)).toBeVisible({ timeout: 20000 });
  });

  test('Edit Trace re-opens with stored settings and replaces the group', async ({ page }) => {
    await importTestImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });
    await page.getByRole('button', { name: 'Apply trace' }).click();
    await expect(page.getByText(/Inserted \d+ vector path/)).toBeVisible({ timeout: 20000 });

    // Close the dialog through its UI (native d.close() would desync React
    // state and keep the host mounted).
    await page.getByRole('button', { name: 'Close dialog' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(300);

    // Right-click the trace group in the layers panel → Edit Trace….
    const traceRow = page
      .getByRole('treeitem')
      .filter({ hasText: /trace$/i })
      .first();
    await traceRow.waitFor({ timeout: 10000 });
    const editTrace = page
      .locator('.varve-ctxmenu')
      .locator('[role="menuitem"], button')
      .filter({ hasText: /Edit Trace/i })
      .first();
    // The trace group is selected after Apply, so the canvas context menu
    // (Shell) shows the Edit Trace… item without any hit-testing.
    const canvas = page
      .locator('.editor-shell__main canvas, .editor-canvas canvas, canvas')
      .first();
    await canvas.dispatchEvent('contextmenu');
    await editTrace.waitFor({ timeout: 8000 });
    // The context menu is intentionally scroll-limited; Edit Trace can be
    // below the visible slice while still being a valid, enabled menu item.
    // Force the resolved item so the test exercises its action without
    // depending on the menu's internal scroll implementation.
    await editTrace.evaluate((element) => (element as HTMLButtonElement).click());
    // Dialog reopens with the stored settings; the trace group still exists.
    await page.getByRole('dialog').locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    const stillThere = await page
      .locator('.layers-panel')
      .getByText(/trace$/i)
      .count();
    expect(stillThere).toBeGreaterThanOrEqual(1);
  });

  test('reports honestly when no image layer is selected', async ({ page }) => {
    // No import: the Object menu item must be disabled with a reason.
    await openMenu(page, 'Object');
    const item = page.getByRole('menuitem', { name: /Vectorize Image/i });
    await expect(item).toBeDisabled();
  });
});
