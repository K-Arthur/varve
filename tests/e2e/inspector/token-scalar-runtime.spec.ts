/** Real UI coverage for scalar DTCG tokens projected onto scene properties. */

import { expect, type Locator, type Page, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { dragOnCanvas, navigateToEditor } from '../shared';

const SCREENSHOT_DIR = 'dtcg-scalar-2026-09-25';
const SOURCE = JSON.stringify(
  {
    foundation: {
      shape: {
        cornerRadius: { $type: 'dimension', $value: { value: 8, unit: 'px' } },
      },
      opacity: {
        surface: { $type: 'number', $value: 0.5 },
        rem: { $type: 'dimension', $value: { value: 1.25, unit: 'rem' } },
      },
    },
  },
  null,
  2,
);

async function openVariablesDialog(page: Page): Promise<Locator> {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const viewMenu = page.getByRole('menu', { name: 'View' });
  await viewMenu.getByRole('menuitem', { name: 'Panels', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Variables and Tokens…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function chooseBinding(page: Page, fieldLabel: string, tokenPath: string): Promise<void> {
  const sectionId = fieldLabel === 'Radius (px)' ? 'corner-radius' : 'appearance';
  const section = page.locator(`[data-section-id="${sectionId}"]`);
  const disclosure = section.locator('.insp-disclosure__trigger');
  await expect(disclosure).toBeVisible();
  if ((await disclosure.getAttribute('aria-expanded')) !== 'true') await disclosure.click();
  await section.getByText(fieldLabel, { exact: true }).click({ modifiers: ['Shift'] });
  const picker = page.locator('.binding-menu');
  const search = picker.getByRole('combobox', { name: 'Search variables' });
  await expect(search).toBeVisible();
  await search.fill(tokenPath);
  const option = picker.getByRole('option').filter({ hasText: tokenPath });
  await expect(option).toHaveCount(1);
  await option.click();
  const bindingStatus = page.getByRole('status', {
    name: `Bound to variable: ${tokenPath}`,
  });
  await expect(bindingStatus).toBeVisible();
  await expect(
    bindingStatus.getByRole('button', { name: `Unbind variable ${tokenPath}` }),
  ).toBeVisible();
}

async function readPixel(page: Page, point: { x: number; y: number }): Promise<number[]> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element, sample) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context || canvas.clientWidth === 0 || canvas.clientHeight === 0) return [];
    const x = Math.max(
      0,
      Math.min(canvas.width - 1, Math.round((sample.x * canvas.width) / canvas.clientWidth)),
    );
    const y = Math.max(
      0,
      Math.min(canvas.height - 1, Math.round((sample.y * canvas.height) / canvas.clientHeight)),
    );
    return Array.from(context.getImageData(x, y, 1, 1).data);
  }, point);
}

async function expectPixelRgb(page: Page, point: { x: number; y: number }, expected: number[]) {
  await expect
    .poll(
      async () => {
        const actual = (await readPixel(page, point)).slice(0, 3);
        return expected.every((channel, index) => Math.abs((actual[index] ?? 0) - channel) <= 4);
      },
      { timeout: 15000 },
    )
    .toBe(true);
}

async function expectPixelDifferentFrom(
  page: Page,
  point: { x: number; y: number },
  reference: number[],
) {
  await expect
    .poll(
      async () => {
        const actual = (await readPixel(page, point)).slice(0, 3);
        return actual.some((channel, index) => Math.abs(channel - (reference[index] ?? 0)) > 8);
      },
      { timeout: 15000 },
    )
    .toBe(true);
}

async function expectBlendedOpacity(
  page: Page,
  point: { x: number; y: number },
  fillRgb: number[],
  backgroundRgb: number[],
  opacity: number,
) {
  const expected = fillRgb.map((fill, index) =>
    Math.round(fill * opacity + (backgroundRgb[index] ?? 0) * (1 - opacity)),
  );
  await expectPixelRgb(page, point, expected);
}

async function compareAuthoritativeRedraw(
  page: Page,
  point: { x: number; y: number },
): Promise<{
  beforePixel: number[];
  afterPixel: number[];
  diff: { differingPixelRatio: number; maxChannelDelta: number };
  oracle: { authoritative: boolean; renderPath: string };
}> {
  return page.evaluate(async (sample) => {
    const canvas = document.querySelector('canvas.editor-canvas__content-layer');
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Content canvas is unavailable.');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || canvas.clientWidth === 0 || canvas.clientHeight === 0) {
      throw new Error('Content canvas cannot be sampled.');
    }
    const readSample = () => {
      const x = Math.max(
        0,
        Math.min(canvas.width - 1, Math.round((sample.x * canvas.width) / canvas.clientWidth)),
      );
      const y = Math.max(
        0,
        Math.min(canvas.height - 1, Math.round((sample.y * canvas.height) / canvas.clientHeight)),
      );
      return Array.from(context.getImageData(x, y, 1, 1).data);
    };
    const beforeImage = context.getImageData(0, 0, canvas.width, canvas.height);
    const beforeBytes = new Uint8ClampedArray(beforeImage.data);
    const beforePixel = readSample();
    const perf = (
      window as unknown as {
        __varvePerf?: {
          forceFullRedraw?: () => Promise<{ authoritative: boolean; renderPath: string }>;
        };
      }
    ).__varvePerf;
    if (typeof perf?.forceFullRedraw !== 'function') {
      throw new Error('The authoritative redraw oracle is unavailable; load with ?perf=1.');
    }
    const oracle = await perf.forceFullRedraw();
    const afterBytes = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let differingPixels = 0;
    let maxChannelDelta = 0;
    for (let offset = 0; offset < beforeBytes.length; offset += 4) {
      let pixelChanged = false;
      for (let channel = 0; channel < 4; channel += 1) {
        const delta = Math.abs(
          (beforeBytes[offset + channel] ?? 0) - (afterBytes[offset + channel] ?? 0),
        );
        if (delta > 0) pixelChanged = true;
        if (delta > maxChannelDelta) maxChannelDelta = delta;
      }
      if (pixelChanged) differingPixels += 1;
    }
    return {
      beforePixel,
      afterPixel: readSample(),
      diff: {
        differingPixelRatio: differingPixels / (canvas.width * canvas.height),
        maxChannelDelta,
      },
      oracle,
    };
  }, point);
}

test('px dimensions and number tokens drive corner radius and opacity through Variables edits', async ({
  page,
}) => {
  await page.setViewportSize({ width: 1600, height: 1000 });
  await navigateToEditor(page, '/?perf=1');

  let dialog = await openVariablesDialog(page);
  await dialog.locator('input[type="file"][aria-label="Import DTCG token file"]').setInputFiles({
    name: 'scalar-foundations.tokens.json',
    mimeType: 'application/json',
    buffer: Buffer.from(SOURCE, 'utf8'),
  });
  await expect(dialog.getByText(/3 tokens ready to import/i)).toBeVisible({ timeout: 15000 });
  await dialog.getByRole('button', { name: 'Apply import' }).click();
  await expect(
    dialog
      .locator('.token-sync-panel__source')
      .filter({ hasText: 'scalar-foundations.tokens.json' }),
  ).toContainText('3 tokens');
  await dialog.screenshot({ path: evidencePath(`${SCREENSHOT_DIR}/scalar-source-imported.png`) });
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  // Draw/select a real shape; no document state is seeded by the test.
  await page.keyboard.press('r');
  await dragOnCanvas(page, 220, 170, 460, 360);
  const shape = page.locator(
    '.layers-panel [role="treeitem"][data-layer-type="shape"][aria-selected="true"]',
  );
  await expect(shape).toHaveCount(1);

  await chooseBinding(page, 'Radius (px)', 'foundation.shape.cornerRadius');
  const radius = page.getByRole('spinbutton', { name: 'Radius (px)', exact: true });
  await expect(radius).toHaveValue('8');

  const roundedEdge = { x: 222, y: 182 };
  const center = { x: 340, y: 265 };
  const backgroundPoint = { x: 100, y: 100 };
  const opaquePixel = await readPixel(page, center);
  const backgroundPixel = await readPixel(page, backgroundPoint);
  expect(opaquePixel).toHaveLength(4);
  expect(backgroundPixel).toHaveLength(4);
  const opaqueFillRgb = opaquePixel.slice(0, 3);
  const backgroundRgb = backgroundPixel.slice(0, 3);
  expect(opaqueFillRgb).not.toEqual(backgroundRgb);

  // This candidate is a valid DTCG dimension but a length cannot drive the
  // unitless opacity ratio. The disabled option must explain the mismatch.
  const appearance = page.locator('[data-section-id="appearance"]');
  const appearanceDisclosure = appearance.locator('.insp-disclosure__trigger');
  if ((await appearanceDisclosure.getAttribute('aria-expanded')) !== 'true') {
    await appearanceDisclosure.click();
  }
  await appearance.getByText('Opacity (%)', { exact: true }).click({ modifiers: ['Shift'] });
  const picker = page.locator('.binding-menu');
  const search = picker.getByRole('combobox', { name: 'Search variables' });
  await expect(search).toBeVisible();
  await search.fill('foundation.opacity.rem');
  const remOption = picker.getByRole('option').filter({ hasText: 'foundation.opacity.rem' });
  await expect(remOption).toHaveCount(1);
  await expect(remOption).toHaveAttribute('aria-disabled', 'true');
  await expect(remOption).toHaveAttribute('title', /length-valued property|ratio/i);
  await page.screenshot({
    path: evidencePath(`${SCREENSHOT_DIR}/rem-dimension-opacity-explanation.png`),
  });
  await page.keyboard.press('Escape');

  await chooseBinding(page, 'Opacity (%)', 'foundation.opacity.surface');
  const opacity = page.getByRole('spinbutton', { name: 'Opacity (%)', exact: true });
  await expect(opacity).toHaveValue('50');

  await expectBlendedOpacity(page, center, opaqueFillRgb, backgroundRgb, 0.5);
  await expectPixelDifferentFrom(page, roundedEdge, backgroundRgb);
  await page.screenshot({ path: evidencePath(`${SCREENSHOT_DIR}/scalar-bindings-applied.png`) });

  // Edit the imported foundations through the Variables table. Numeric text
  // retains the source dimension's explicit px unit.
  dialog = await openVariablesDialog(page);
  if (
    !(await dialog
      .getByRole('table', { name: 'Variables' })
      .isVisible()
      .catch(() => false))
  ) {
    await dialog.getByRole('button', { name: 'Show variables' }).click();
  }
  const variables = dialog.getByRole('table', { name: 'Variables' });
  const radiusRow = variables.getByRole('row').filter({ hasText: 'foundation.shape.cornerRadius' });
  const radiusValue = radiusRow.locator('.variable-panel__value-btn');
  await radiusValue.click();
  const variableValue = dialog.getByRole('textbox', { name: 'Variable value' });
  await variableValue.fill('32');
  await variableValue.press('Enter');
  await expect(radiusValue).toHaveText('32 px');

  const opacityRow = variables.getByRole('row').filter({ hasText: 'foundation.opacity.surface' });
  const opacityValue = opacityRow.locator('.variable-panel__value-btn');
  await opacityValue.click();
  await dialog.getByRole('textbox', { name: 'Variable value' }).fill('0.75');
  await dialog.getByRole('textbox', { name: 'Variable value' }).press('Enter');
  await expect(opacityValue).toHaveText('0.75');
  await dialog.getByRole('button', { name: 'Close dialog' }).click();

  await expect(radius).toHaveValue('32');
  await expect(opacity).toHaveValue('75');
  await expectPixelRgb(page, roundedEdge, backgroundRgb);
  await expectBlendedOpacity(page, center, opaqueFillRgb, backgroundRgb, 0.75);
  const redraw = await compareAuthoritativeRedraw(page, roundedEdge);
  // The content canvas is opaque, so verify the composited color against the
  // 75% foreground/background blend. At (2,12), 32px rounding cuts the corner.
  expect(redraw.oracle.authoritative).toBe(true);
  expect(redraw.afterPixel).toEqual(backgroundPixel);
  expect(redraw.beforePixel).toEqual(redraw.afterPixel);
  // Worker/compositor antialiasing differs by at most one channel unit on a
  // small edge fraction; the scalar sample and the rest of the surface agree.
  expect(redraw.diff.maxChannelDelta).toBeLessThanOrEqual(1);
  expect(redraw.diff.differingPixelRatio).toBeLessThan(0.0001);
  await page.screenshot({ path: evidencePath(`${SCREENSHOT_DIR}/scalar-foundations-edited.png`) });

  await page.keyboard.press('ControlOrMeta+z');
  await expect(opacity).toHaveValue('50');
  await expectBlendedOpacity(page, center, opaqueFillRgb, backgroundRgb, 0.5);
  await page.keyboard.press('ControlOrMeta+z');
  await expect(radius).toHaveValue('8');
  await expectPixelDifferentFrom(page, roundedEdge, backgroundRgb);
  await page.screenshot({ path: evidencePath(`${SCREENSHOT_DIR}/scalar-foundations-undone.png`) });
});
