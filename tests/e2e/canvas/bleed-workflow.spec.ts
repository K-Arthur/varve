/**
 * Bleed print workflow (end to end): configure bleed through the Page tool
 * inspector, verify the canvas guide, toggle visibility without changing
 * the setting, extend artwork into the bleed region, move/resize the page
 * with bleed following, undo/redo the bleed change, save and verify the
 * persisted document carries the bleed, and check the export dialog opens.
 *
 * Geometry assertions read the SVG guide's attributes and bounding boxes —
 * the overlay lives in screen space (origins via worldToCanvas, sizes
 * scaled by zoom), so expected values are computed from the live zoom
 * readout.
 */
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

async function waitForContentCanvas(page: import('@playwright/test').Page) {
  await page
    .locator('canvas.editor-canvas__content-layer')
    .waitFor({ state: 'attached', timeout: 20000 });
}

async function currentZoom(page: import('@playwright/test').Page): Promise<number> {
  return page.evaluate(() => {
    const input = document.querySelector('input[aria-label*="Zoom"]') as HTMLInputElement | null;
    const v = input ? Number.parseFloat(input.value) : NaN;
    return Number.isFinite(v) ? v / 100 : 1;
  });
}

/** Fit the active page and wait until the camera actually settles (the
 * workspace switch races the fit; poll the zoom readout instead of
 * assuming, and re-press under heavy machine load). */
async function fitActivePage(page: import('@playwright/test').Page) {
  await expect
    .poll(
      async () => {
        await page.keyboard.press('Shift+3');
        await page.waitForTimeout(250);
        return (await currentZoom(page)) < 0.95;
      },
      { timeout: 25000 },
    )
    .toBe(true);
  await page.waitForTimeout(300);
}

/** Click the page centre with the page tool (canvas centre after fit). */
async function activatePageToolAndPage(page: import('@playwright/test').Page) {
  await page.keyboard.press('Escape');
  await page.keyboard.press('q');
  const box = (await page.locator('canvas.editor-canvas__content-layer').boundingBox())!;
  await page.mouse.click(box.x + box.width / 2, box.y + box.height / 2);
  await page.getByText('Page Print').first().waitFor({ timeout: 5000 });
}

async function setBleed(page: import('@playwright/test').Page, value: string) {
  await page.getByLabel(/bleed top/i).fill(value);
  await page.getByLabel(/bleed right/i).fill(value);
  await page.getByLabel(/bleed bottom/i).fill(value);
  await page.getByLabel(/bleed left/i).fill(value);
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

test.describe('Bleed print workflow', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(420000);

  test('configure, visualize, toggle, edit, move, resize, undo, persist, export', async ({
    page,
  }) => {
    // Capture the saved document so persistence can be asserted on the
    // actual bytes the save coordinator writes.
    await page.addInitScript(() => {
      const win = window as unknown as Record<string, unknown>;
      win.__varveSavedDoc = null;
      // Crash-loop debugging in shared dev environments must not force
      // safe mode on the next boot.
      localStorage.removeItem('varve:crash-loop');
      localStorage.removeItem('varve:safe-mode');
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

    // 1. Open/create a document with a page (bleed is a page concept).
    await navigateToEditor(page);
    await page.getByRole('button', { name: 'Add page' }).click();
    await page.waitForTimeout(400);
    await waitForContentCanvas(page);

    // Artwork: a rectangle crossing the right and bottom trim edges
    // (default camera, same pattern the bleed-canvas spec validates).
    await page.keyboard.press('r');
    await dragOnCanvas(page, 300, 300, 2300, 1400);
    await page.keyboard.press('Escape');

    // 2-4. Print workspace (bleed guides default on), fit.
    await page.keyboard.press('Control+Shift+2');
    await page.waitForTimeout(400);
    await fitActivePage(page);

    // No bleed configured yet — nothing beyond the trim outline.
    await expect(page.locator('.print-bleed-guide')).toHaveCount(0);

    // 3. Set bleed through the inspector (page tool).
    await activatePageToolAndPage(page);
    await setBleed(page, '20');

    // 4. Guide appears: trim expanded by 20px per edge, scaled by zoom.
    await expect(page.locator('.print-bleed-guide')).toHaveCount(1);
    const z = await currentZoom(page);
    await expectGuideAttrs(page, z);
    // The production-region band between trim and bleed is present.
    expect(await page.locator('.print-bleed-band').count()).toBe(1);

    // 5-8. Toggle visibility from the View menu: setting stays, guide hides.
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

    // 9-10. Artwork extends beyond trim into the bleed region and stays
    // visible (pages are not content-clipped; the guide only marks the
    // production extent).
    await fitActivePage(page);
    const z2 = await currentZoom(page);
    const beyond = await page.evaluate(
      ([z]) => {
        const canvas = document.querySelector('canvas.editor-canvas__content-layer') as
          | HTMLCanvasElement
          | undefined;
        if (!canvas) return null;
        const ctx = canvas.getContext('2d');
        if (!ctx) return null;
        const scaleX = canvas.width / canvas.clientWidth;
        const scaleY = canvas.height / canvas.clientHeight;
        const rect = canvas.getBoundingClientRect();
        // Inside the bleed band (x between trim 1920 and bleed 1940), on
        // the rect's vertical span — the artwork must be visible there.
        const sx = rect.x + 1930 * z;
        const sy = rect.y + 900 * z;
        const x = Math.round(sx * scaleX);
        const y = Math.round(sy * scaleY);
        if (x < 0 || y < 0 || x >= canvas.width || y >= canvas.height) return null;
        const d = ctx.getImageData(x, y, 1, 1).data;
        return { r: d[0]!, g: d[1]!, b: d[2]! };
      },
      [z2] as const,
    );
    expect(
      beyond && !(beyond.r < 200 && beyond.g < 200 && beyond.b < 200),
      `artwork must be visible inside the bleed band (got ${JSON.stringify(beyond)})`,
    ).toBeTruthy();

    // 11-12. Move the page: the guide follows the placement.
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

    // 13-14. Resize the page: bleed distance stays physically constant
    // (still 20px per edge; never a percentage of the new size).
    await activatePageToolAndPage(page);
    await page.getByLabel(/^page width$/i).fill('1480');
    await page.getByLabel(/^page height$/i).fill('980');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expectGuideAttrs(page, await currentZoom(page), 20, 1480, 980);

    // 15-16. Undo/redo a bleed change.
    await activatePageToolAndPage(page);
    const zu = await currentZoom(page);
    await page.getByLabel(/bleed top/i).fill('40');
    await page.keyboard.press('Escape');
    await page.keyboard.press('Escape');
    await page.waitForTimeout(300);
    await expect.poll(async () => (await guideAttrs(page))?.x).toBeCloseTo(-40 * zu, 0.5);
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await expect.poll(async () => (await guideAttrs(page))?.x).toBeCloseTo(-20 * zu, 0.5);
    await page.keyboard.press('Control+Shift+z');
    await page.waitForTimeout(300);
    await expect.poll(async () => (await guideAttrs(page))?.x).toBeCloseTo(-40 * zu, 0.5);
    // Restore a consistent state for persistence.
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);

    // 17-19. Save and verify the document bytes carry the bleed config.
    await page
      .getByRole('menubar')
      .getByRole('menuitem', { name: /^File$/ })
      .click();
    await page.getByRole('menuitem', { name: /^Save$/ }).click();
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

    // 20-21. Export dialog opens (PDF/X bleed seeding is covered by unit
    // tests against the same canonical resolver).
    await page.keyboard.press('Control+e');
    await page.locator('dialog[open]').waitFor({ timeout: 10000 });
    expect(await page.locator('dialog[open]').count()).toBeGreaterThan(0);
  });
});
