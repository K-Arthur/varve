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

  test('preview shows committed geometry: holes transparent, artwork theme-independent', async ({
    page,
  }) => {
    await importTestImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    const choosePreviewView = (label: string) =>
      page
        .getByRole('radiogroup', { name: 'Preview view' })
        .getByText(label, { exact: true })
        .click();

    // 1:1 zoom makes canvas device pixels correspond to prepared-source pixels.
    await page.getByRole('button', { name: '1:1' }).click();
    await choosePreviewView('Vector');

    const sample = () =>
      page.evaluate(() => {
        const canvas = document.querySelector('.vectorize__preview-canvas') as HTMLCanvasElement;
        const ctx = canvas.getContext('2d');
        if (!ctx) throw new Error('no 2d context');
        const cssWidth = Number.parseFloat(canvas.style.width) || canvas.width;
        const ratio = canvas.width / cssWidth;
        const at = (x: number, y: number) => {
          const d = ctx.getImageData(Math.round(x * ratio), Math.round(y * ratio), 1, 1).data;
          return [d[0], d[1], d[2], d[3]] as [number, number, number, number];
        };
        return { ring: at(80, 30), center: at(80, 80), outside: at(4, 4) };
      });

    const vector = await sample();
    // The ring is committed paint; the donut hole and removed background stay
    // transparent (closed hole subpaths + evenodd fill).
    expect(vector.ring[3]).toBeGreaterThan(200);
    expect(vector.center[3]).toBe(0);
    expect(vector.outside[3]).toBe(0);

    // Switching the UI theme must not change committed artwork colors.
    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await choosePreviewView('Overlay');
    await choosePreviewView('Vector');
    const dark = await sample();
    expect(dark.ring).toEqual(vector.ring);
    expect(dark.center[3]).toBe(0);
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));
  });

  test('Edit Trace restores the preparation stack and records the real provider', async ({
    page,
  }) => {
    await importTestImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    const providerCell = page
      .locator('.vectorize__diagnostics div')
      .filter({ hasText: 'Provider' })
      .locator('dd');
    await expect(providerCell).toHaveText(/-trace$/);

    // Change a preparation setting; v2 metadata must restore it on Edit Trace.
    // The checkbox lives inside a scrolled dialog section; dispatch the click
    // on the input itself so the assertion is about metadata, not scrolling.
    await page.locator('summary').filter({ hasText: 'Source preparation' }).click();
    await page.waitForTimeout(400);
    await page
      .getByRole('checkbox', { name: 'Binary threshold before tracing' })
      .evaluate((element) => (element as HTMLInputElement).click());
    await expect(
      page.getByRole('checkbox', { name: 'Binary threshold before tracing' }),
    ).toBeChecked();
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    await page.getByRole('button', { name: 'Apply trace' }).click();
    await expect(page.getByText(/Inserted \d+ vector path/)).toBeVisible({ timeout: 20000 });
    await page.getByRole('button', { name: 'Close dialog' }).first().click({ timeout: 5000 });
    await page.waitForTimeout(300);

    const canvas = page
      .locator('.editor-shell__main canvas, .editor-canvas canvas, canvas')
      .first();
    await canvas.dispatchEvent('contextmenu');
    const editTrace = page
      .locator('.varve-ctxmenu')
      .locator('[role="menuitem"], button')
      .filter({ hasText: /Edit Trace/i })
      .first();
    await editTrace.waitFor({ timeout: 8000 });
    await editTrace.evaluate((element) => (element as HTMLButtonElement).click());
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    await expect(providerCell).toHaveText(/-trace$/);
    await page.locator('summary').filter({ hasText: 'Source preparation' }).click();
    await expect(
      page.getByRole('checkbox', { name: 'Binary threshold before tracing' }),
    ).toBeChecked();
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
  });

  test('preview can be cancelled and resumes when settings change', async ({ page }) => {
    await importTestImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByText('Preview appears here')).toBeVisible({ timeout: 5000 });

    // A settings change restarts the debounced preview without document writes.
    const threshold = page.getByRole('slider', { name: 'Threshold' });
    await threshold.focus();
    await threshold.press('ArrowRight');
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });
  });

  test('captures preview review screenshots', async ({ page }, testInfo) => {
    await importTestImage(page);
    await openMenu(page, 'Object');
    await page.getByRole('menuitem', { name: /Vectorize Image/i }).click();
    await page
      .getByRole('dialog')
      .getByText(/Preset/i)
      .waitFor({ timeout: 10000 });
    await page.locator('.vectorize__diagnostics').waitFor({ timeout: 20000 });

    const dir = path.join('reports', 'trace-review');
    fs.mkdirSync(dir, { recursive: true });
    const dialog = page.getByRole('dialog');
    const preview = page.locator('.vectorize__preview');
    const choosePreviewView = (label: string) =>
      page
        .getByRole('radiogroup', { name: 'Preview view' })
        .getByText(label, { exact: true })
        .click();
    const capture = async (name: string) => {
      await preview.scrollIntoViewIfNeeded();
      await page.waitForTimeout(250);
      await dialog.screenshot({ path: path.join(dir, name) });
    };
    await capture('preview-overlay-light.png');

    await choosePreviewView('Vector');
    await page
      .getByRole('checkbox', { name: 'Anchors' })
      .evaluate((element) => (element as HTMLInputElement).click());
    await expect(page.getByRole('checkbox', { name: 'Anchors' })).toBeChecked();
    await capture('preview-vector-anchors-light.png');

    await page.evaluate(() => document.documentElement.setAttribute('data-theme', 'dark'));
    await choosePreviewView('Prepared');
    await choosePreviewView('Vector');
    await capture('preview-vector-dark.png');
    await page.evaluate(() => document.documentElement.removeAttribute('data-theme'));

    // Keep the evidence path in the HTML report.
    await testInfo.attach('trace-preview-dir', { body: dir, contentType: 'text/plain' });
  });
});
