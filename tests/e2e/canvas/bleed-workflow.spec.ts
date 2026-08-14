/**
 * Bleed print workflow (end to end): configure bleed through the Page tool
 * inspector, verify the canvas guide, toggle visibility without changing
 * the setting, extend artwork into the bleed region, move/resize the page
 * with bleed following, undo/redo the bleed change, save and verify the
 * persisted document carries the bleed, and check the export dialog opens.
 *
 * Geometry assertions read the SVG guide's attributes and bounding boxes —
 * the overlay lives in screen space (origins via worldToCanvas, sizes
 * scaled by zoom), so expected values are computed from the exact fit
 * camera (fitBoundsCamera contract, padding 40).
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function waitForContentCanvas(page: import('@playwright/test').Page) {
  await page
    .locator('canvas.editor-canvas__content-layer')
    .waitFor({ state: 'attached', timeout: 20000 });
}

/**
 * Exact fit-zoom for the active page (1920x1080, padding 40) — the
 * fitBoundsCamera contract the multipage specs reproduce. The status-bar
 * zoom readout rounds to an integer percent, which is too coarse for
 * pixel-exact geometry assertions.
 */
async function fitZoom(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
      | HTMLCanvasElement
      | undefined;
    const w = canvas?.clientWidth ?? 800;
    const h = canvas?.clientHeight ?? 600;
    return Math.min(Math.max(1, w - 80) / 1920, Math.max(1, h - 80) / 1080);
  });
}

/** Fit the active page and wait until the camera actually settles. */
async function fitActivePage(page: import('@playwright/test').Page) {
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Shift+3');
        await page.waitForTimeout(250);
        return (await fitZoom(page)) < 0.95;
      },
      { timeout: 25000 },
    )
    .toBe(true);
  await page.waitForTimeout(300);
}

/** Click the page with the page tool: the page centre after fit, or the
 * rendered guide's centre when the page has been moved (the guide is
 * concentric with the trim). Blurs any focused inspector field FIRST via
 * the DOM — a 'q' keystroke while a NumberField holds focus lands in the
 * field (staged as dirty text) and the tool never switches. */
async function activatePageToolAndPage(page: import('@playwright/test').Page) {
  await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
  await page.keyboard.press('Escape');
  await page.keyboard.press('q');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const canvasBox = (await canvas.boundingBox())!;
  const guide = page.locator('.print-bleed-guide');
  const guideBox = (await guide.count()) ? await guide.first().boundingBox() : null;
  if (guideBox) {
    await page.mouse.click(guideBox.x + guideBox.width / 2, guideBox.y + guideBox.height / 2);
  } else {
    await page.mouse.click(canvasBox.x + canvasBox.width / 2, canvasBox.y + canvasBox.height / 2);
  }
  await page.getByText('Page Print').first().waitFor({ timeout: 5000 });
}

async function setBleed(page: import('@playwright/test').Page, value: string) {
  await page.getByLabel(/bleed top/i).fill(value);
  await page.getByLabel(/bleed right/i).fill(value);
  await page.getByLabel(/bleed bottom/i).fill(value);
  await page.getByLabel(/bleed left/i).fill(value);
  // NumberField commits on blur; the last filled field stays focused, so
  // Enter commits the final edge (Escape would revert the staged value).
  await page.getByLabel(/bleed left/i).press('Enter');
}

async function guideAttrs(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const g = document.querySelector('.print-bleed-guide');
    if (!g) return null;
    return {
      x: Number.parseFloat(g.getAttribute('x') ?? 'NaN'),
      y: Number.parseFloat(g.getAttribute('y') ?? 'NaN'),
      width: Number.parseFloat(g.getAttribute('width') ?? 'NaN'),
      height: Number.parseFloat(g.getAttribute('height') ?? 'NaN'),
      dash: g.getAttribute('stroke-dasharray'),
    };
  });
}

async function expectGuideAttrs(
  page: import('@playwright/test').Page,
  z: number,
  bleed = 20,
  pageW = 1920,
  pageH = 1080,
) {
  await expect
    .poll(async () => guideAttrs(page))
    .toEqual(
      expect.objectContaining({
        x: expect.closeTo(-bleed * z, 0.5),
        y: expect.closeTo(-bleed * z, 0.5),
        width: expect.closeTo((pageW + bleed * 2) * z, 0.5),
        height: expect.closeTo((pageH + bleed * 2) * z, 0.5),
      }),
    );
  // Dash pattern is screen-constant (4/zoom CSS px), parsed numerically —
  // React renders full float precision, so string equality would flake.
  const dash = (await guideAttrs(page))?.dash?.split(',').map((v) => Number.parseFloat(v));
  expect(dash?.[0]).toBeCloseTo(4 / z, 1);
  expect(dash?.[1]).toBeCloseTo(4 / z, 1);
}

/** Shared prelude: flat doc → one page + a rect crossing right/bottom trim. */
async function seedPrintDocument(page: import('@playwright/test').Page) {
  await page.addInitScript(() => {
    // Crash-loop debugging in shared dev environments must not force
    // safe mode on the next boot.
    localStorage.removeItem('varve:crash-loop');
    localStorage.removeItem('varve:safe-mode');
  });
  await navigateToEditor(page);
  await page.getByRole('button', { name: 'Add page' }).click();
  await page.waitForTimeout(400);
  await waitForContentCanvas(page);
  await page.keyboard.press('r');
  await dragOnCanvas(page, 300, 300, 2300, 1400);
  await page.keyboard.press('Escape');
  await page.keyboard.press('Control+Shift+2');
  await page.waitForTimeout(400);
  await fitActivePage(page);
}

test.describe('Bleed print workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(420000);

  test('configures bleed, draws the guide, and toggles it from the View menu', async ({ page }) => {
    await seedPrintDocument(page);

    // No bleed configured yet — nothing beyond the trim outline.
    await expect(page.locator('.print-bleed-guide')).toHaveCount(0);

    // Set bleed through the inspector (page tool).
    await activatePageToolAndPage(page);
    await setBleed(page, '20');

    // Guide appears: trim expanded by 20px per edge, scaled by zoom.
    await expect(page.locator('.print-bleed-guide')).toHaveCount(1);
    await expectGuideAttrs(page, await fitZoom(page));
    // The production-region band between trim and bleed is present.
    expect(await page.locator('.print-bleed-band').count()).toBe(1);

    // Toggle visibility from the View menu: setting stays, guide hides.
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^View$/ })
      .click();
    await page.getByRole('menuitem', { name: /hide bleed guides/i }).click();
    await expect(page.locator('.print-bleed-guide')).toHaveCount(0);
    // The setting itself is unchanged.
    await activatePageToolAndPage(page);
    expect(await page.getByLabel(/bleed top/i).inputValue()).toBe('20');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^View$/ })
      .click();
    await page.getByRole('menuitem', { name: /show bleed guides/i }).click();
    await expect(page.locator('.print-bleed-guide')).toHaveCount(1);

    // Artwork extends beyond trim into the bleed region and stays visible
    // (pages are not content-clipped; the guide only marks the extent).
    await fitActivePage(page);
    const z = await fitZoom(page);
    const beyond = await page.evaluate(
      ([bleedPx]) => {
        const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
          | HTMLCanvasElement
          | undefined;
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const scaleX = canvas.width / canvas.clientWidth;
        const scaleY = canvas.height / canvas.clientHeight;
        const canvasRect = canvas.getBoundingClientRect();
        const guide = document.querySelector('.print-bleed-guide')?.getBoundingClientRect();
        if (!guide) return null;
        // Derive the sample from the rendered guide rather than assuming the
        // page's world origin is the canvas's CSS origin. Fit-to-page centers
        // the page on the infinite canvas, so that shortcut misses the band.
        // getBoundingClientRect is viewport-relative — normalize to the
        // canvas element before scaling to device pixels.
        const sx = guide.right - canvasRect.left - bleedPx / 2;
        const sy = guide.top - canvasRect.top + guide.height / 2;
        const x = Math.round(sx * scaleX);
        const y = Math.round(sy * scaleY);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0]!, g: d[1]!, b: d[2]! };
      },
      [20 * z] as const,
    );
    expect(
      beyond && !(beyond.r < 200 && beyond.g < 200 && beyond.b < 200),
      `artwork must be visible inside the bleed band (got ${JSON.stringify(beyond)})`,
    ).toBeTruthy();

    const box = await page.locator('canvas.editor-canvas__content-layer').boundingBox();
    await page.screenshot({
      path: 'reports/bleed-baseline/04-workflow-guides-light.png',
      clip: box ?? undefined,
    });
  });

  test('bleed follows the page, resizes with constant distance, undoes, persists, exports', async ({
    page,
  }) => {
    await seedPrintDocument(page);

    // Capture the saved document so persistence can be asserted on the
    // actual bytes the save coordinator writes.
    // This test has already navigated through the editor setup. Install the
    // picker stub in the live page; addInitScript would only affect a future
    // navigation and would leave Save waiting on a real browser picker.
    await page.evaluate(() => {
      const win = window as unknown as Record<string, unknown>;
      win.__varveSavedDoc = null;
      win.showSaveFilePicker = async (opts: { suggestedName?: string }) => {
        return {
          name: opts.suggestedName ?? 'document.varve',
          queryPermission: async () => 'granted',
          createWritable: async () => ({
            write: async (data: string | ArrayBuffer | Uint8Array) => {
              const text =
                typeof data === 'string'
                  ? data
                  : new TextDecoder().decode(
                      data instanceof ArrayBuffer ? new Uint8Array(data) : data,
                    );
              win.__varveSavedDoc = text;
            },
            close: async () => undefined,
          }),
        };
      };
    });

    await activatePageToolAndPage(page);
    await setBleed(page, '20');
    await expect(page.locator('.print-bleed-guide')).toHaveCount(1);
    await expectGuideAttrs(page, await fitZoom(page));

    // Undo/redo a bleed change. Runs right after the bleed setup, before
    // any move/resize, so the undo chain is simple and deterministic.
    const zu = await fitZoom(page);
    await page.getByLabel(/bleed top/i).fill('40');
    await page.getByLabel(/bleed top/i).press('Enter');
    // Blur the field without any canvas click: Escape does not blur (the
    // NumberField's Escape handler only clears the staged value), Tab just
    // cycles to the next input, and a canvas click with the page tool
    // active opens a new gesture transaction. A focused input also swallows
    // Ctrl+Z as the browser's text-undo instead of the document undo.
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    // Assert x AND width together: x alone cannot tell "bleed 40 on the
    // resized page" apart from "bleed 20" (same x at this zoom), but the
    // width distinguishes an undone bleed change (1520z) from an undone
    // resize (1960z).
    await expect
      .poll(async () => {
        const a = await guideAttrs(page);
        return a ? { x: a.x, width: a.width } : null;
      })
      .toEqual({
        // Bleed is linked: editing top set all four edges to 40, so the
        // guide spans 1480 + 40 + 40 = 1560 world px.
        x: expect.closeTo(-40 * zu, 0.5),
        width: expect.closeTo(2000 * zu, 0.5),
      });
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);
    await expect
      .poll(async () => {
        const a = await guideAttrs(page);
        return a ? { x: a.x, width: a.width } : null;
      })
      .toEqual({
        x: expect.closeTo(-20 * zu, 0.5),
        width: expect.closeTo(1960 * zu, 0.5),
      });
    // Redo via the toolbar button. Undo/redo run through the persistent
    // revision store (async) whose canRedo flag lags the action, so wait
    // for the button to enable before clicking.
    const redoBtn = page.getByRole('button', { name: /^Redo$/ });
    await expect
      .poll(
        async () => (await redoBtn.count()) && (await redoBtn.first().isEnabled()),
        { timeout: 15000 },
      )
      .toBe(true);
    await redoBtn.first().click();
    await page.waitForTimeout(400);
    await expect
      .poll(async () => {
        const a = await guideAttrs(page);
        return a ? { x: a.x, width: a.width } : null;
      })
      .toEqual({
        x: expect.closeTo(-40 * zu, 0.5),
        width: expect.closeTo(2000 * zu, 0.5),
      });
    // Restore a consistent state for persistence.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(600);

    // Move the page: the guide follows the placement.
    await activatePageToolAndPage(page);
    await page.keyboard.press('Escape');
    const before = await page.locator('.print-bleed-guide').boundingBox();
    await page.keyboard.press('q');
    await dragOnCanvas(page, 400, 400, 700, 500); // page tool drag moves the page
    await page.waitForTimeout(400);
    const after = await page.locator('.print-bleed-guide').boundingBox();
    expect(before && after).toBeTruthy();
    expect(after!.x - before!.x).toBeCloseTo(300, 1);
    expect(after!.y - before!.y).toBeCloseTo(100, 1);

    // Resize the page: bleed distance stays physically constant (still
    // 20px per edge; never a percentage of the new size).
    await activatePageToolAndPage(page);
    const printSection = page.locator('.page-print');
    await printSection.getByLabel(/page width/i).fill('1480');
    await printSection.getByLabel(/page height/i).fill('980');
    await printSection.getByLabel(/page height/i).press('Enter');
    await page.evaluate(() => (document.activeElement as HTMLElement | null)?.blur());
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expectGuideAttrs(page, await fitZoom(page), 20, 1480, 980);

    // Save and verify the document bytes carry the bleed config.
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^File$/ })
      .click();
    // The accessible name includes the accelerator ("Save Ctrl+S").
    await page.getByRole('menuitem', { name: /^Save Ctrl\+S$/ }).click();
    await page.waitForTimeout(600);
    const saved = await page.evaluate(
      () => (window as unknown as Record<string, string | null>).__varveSavedDoc,
    );
    expect(saved).toBeTruthy();
    const savedDoc = JSON.parse(saved!) as {
      pages?: Array<{
        bleed?: {
          top: number;
          right: number;
          bottom: number;
          left: number;
          linked: boolean;
          unit: string;
        };
      }>;
    };
    // The inspector wrote a page-level override; it must persist with the
    // page (the resolver reads the same override back on reload).
    expect(savedDoc.pages?.[0]?.bleed).toEqual({
      top: 20,
      right: 20,
      bottom: 20,
      left: 20,
      linked: true,
      unit: 'px',
    });

    // Export dialog opens (PDF/X bleed seeding is covered by unit tests
    // against the same canonical resolver). File menu path — the Ctrl+E
    // shortcut can be swallowed by a focused element after the save flow.
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^File$/ })
      .click();
    await page.getByRole('menuitem', { name: /^Export… Ctrl\+E$/ }).click();
    // The Export dialog renders without the native [open] attribute; its
    // heading is the reliable open-state signal.
    await page
      .getByRole('dialog')
      .getByRole('heading', { name: /^Export$/ })
      .waitFor({ timeout: 10000 });
  });
});
