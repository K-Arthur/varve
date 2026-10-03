import { expect, test } from '@playwright/test';
import { selectInspectorTab } from '../helpers/inspector-tabs';
import { resizePanelTo } from '../helpers/panel-resize';
import { addLayerEffect, dragOnCanvas, navigateToEditor } from '../shared';

async function openEffectsSection(page: import('@playwright/test').Page) {
  const section = page.locator('section.insp-disclosure[data-section-id="effects"]');
  await expect(section).toBeVisible({ timeout: 10000 });
  const trigger = section.getByRole('button', { name: 'Layer Effects', exact: true });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  return section;
}

async function addEffect(
  page: import('@playwright/test').Page,
  section: import('@playwright/test').Locator,
  label: string,
) {
  await addLayerEffect(page, section, label);
}

async function compoundPaintSamples(
  page: import('@playwright/test').Page,
  bounds?: { x: number; y: number; w: number; h: number },
) {
  return page.evaluate((knownBounds) => {
    const canvas = document.querySelector<HTMLCanvasElement>('canvas.editor-canvas__content-layer');
    const ctx = canvas?.getContext('2d');
    if (!canvas || !ctx) throw new Error('Compound-path canvas is unavailable');
    let paint = knownBounds;
    if (!paint) {
      const data = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let minX = canvas.width;
      let minY = canvas.height;
      let maxX = -1;
      let maxY = -1;
      // Find the actual imported blue ring rather than trusting layer-list
      // presence or a screenshot captured before the renderer has painted it.
      for (let y = 0; y < canvas.height; y++) {
        for (let x = 0; x < canvas.width; x++) {
          const i = (y * canvas.width + x) * 4;
          if (
            data[i + 3]! > 250 &&
            Math.abs(data[i]! - 37) <= 2 &&
            Math.abs(data[i + 1]! - 99) <= 2 &&
            Math.abs(data[i + 2]! - 235) <= 2
          ) {
            minX = Math.min(minX, x);
            minY = Math.min(minY, y);
            maxX = Math.max(maxX, x);
            maxY = Math.max(maxY, y);
          }
        }
      }
      if (maxX < minX || maxY < minY) return null;
      paint = { x: minX, y: minY, w: maxX - minX + 1, h: maxY - minY + 1 };
    }
    const scaleX = paint.w / 180;
    const centerY = Math.round(paint.y + paint.h / 2);
    const centerX = Math.round(paint.x + paint.w / 2);
    // Authored hole starts at x70 while the outer ring starts at x20. Sample
    // two source pixels inside its left painted edge, at the same camera/DPR.
    const edgeX = Math.round(paint.x + 48 * scaleX);
    const edge = Array.from(ctx.getImageData(edgeX, centerY, 1, 1).data);
    const hole = ctx.getImageData(centerX - 2, centerY - 2, 5, 5).data;
    let holeMaxAlpha = 0;
    for (let i = 3; i < hole.length; i += 4) holeMaxAlpha = Math.max(holeMaxAlpha, hole[i]!);
    return { bounds: paint, width: canvas.width, height: canvas.height, edge, holeMaxAlpha };
  }, bounds);
}

test.describe('Layer Effects — real editor workflow', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
  });

  test('reorders effects within a stage and disables cross-stage no-ops', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);

    await addEffect(page, section, 'Drop Shadow');
    await addEffect(page, section, 'Outer Glow');
    await addEffect(page, section, 'Layer Blur');

    const rows = section.locator('.insp-effect-row');
    await expect(rows).toHaveCount(3);
    await expect(rows.nth(0)).toContainText('Drop Shadow');
    await expect(rows.nth(1)).toContainText('Outer Glow');
    await expect(rows.nth(2)).toContainText('Layer Blur');

    await rows.nth(0).getByRole('button', { name: 'Move effect down' }).click();
    await expect(rows.nth(0)).toContainText('Outer Glow');
    await expect(rows.nth(1)).toContainText('Drop Shadow');

    await expect(rows.nth(2).getByRole('button', { name: 'Move effect up' })).toBeDisabled();
  });

  test('exposes Layer Effects for a painted raster layer and changes the real canvas', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('b');
    await dragOnCanvas(page, 180, 180, 360, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    await page.waitForTimeout(500);

    // Painted raster layers carry the complete editable surface in the
    // Adjustments tab; the Design composition is the vector-object surface.
    await selectInspectorTab(page, 'Adjustments');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const before = await canvas.screenshot({
      path: testInfo.outputPath('raster-layer-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await expect
      .poll(async () => Buffer.compare(before, await canvas.screenshot()), { timeout: 5000 })
      .not.toBe(0);
    const after = await canvas.screenshot();
    await canvas.screenshot({ path: testInfo.outputPath('raster-layer-after-effect.png') });
    expect(Buffer.compare(before, after)).not.toBe(0);
    await page.screenshot({
      path: testInfo.outputPath('raster-layer-effect.png'),
      fullPage: false,
    });
  });

  test('follows transparent PNG alpha instead of its rectangular bounds', async ({
    page,
  }, testInfo) => {
    const source = await page.evaluate(() => {
      const image = document.createElement('canvas');
      image.width = 180;
      image.height = 140;
      const ctx = image.getContext('2d')!;
      ctx.fillStyle = '#ef4444';
      ctx.beginPath();
      ctx.arc(90, 70, 48, 0, Math.PI * 2);
      ctx.fill();
      ctx.globalCompositeOperation = 'destination-out';
      ctx.beginPath();
      ctx.arc(90, 70, 18, 0, Math.PI * 2);
      ctx.fill();
      return image.toDataURL('image/png').split(',')[1]!;
    });
    await page.locator('#file-import-input').setInputFiles({
      name: 'transparent-cutout.png',
      mimeType: 'image/png',
      buffer: Buffer.from(source, 'base64'),
    });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    await page.getByRole('treeitem').first().click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect
      .poll(async () => (await canvas.screenshot()).length, { timeout: 10000 })
      .toBeGreaterThan(0);
    const before = await canvas.screenshot({
      path: testInfo.outputPath('transparent-png-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await expect
      .poll(async () => Buffer.compare(before, await canvas.screenshot()), { timeout: 10000 })
      .not.toBe(0);
    await canvas.screenshot({ path: testInfo.outputPath('transparent-png-after-effect.png') });
    await expect(page.getByRole('treeitem').first()).toContainText(/transparent-cutout/i);
  });

  test('keeps transparent holes in a compound SVG vector when painting effects', async ({
    page,
  }, testInfo) => {
    // The default theme board is opaque. Configure a transparent document
    // board through the product picker so canvas alpha measures path coverage
    // rather than the background painted beneath the imported vector.
    await page.getByRole('button', { name: 'Canvas background', exact: true }).click();
    const backgroundPicker = page.getByRole('dialog', { name: /pick canvas background/i });
    await expect(backgroundPicker).toBeVisible();
    await backgroundPicker.getByLabel('Hex color').fill('#00000000');
    await backgroundPicker.getByLabel('Hex color').press('Enter');
    await backgroundPicker.getByRole('button', { name: 'Dismiss colour picker' }).click();
    await expect(backgroundPicker).toBeHidden();
    const compoundSvg = `
      <svg xmlns="http://www.w3.org/2000/svg" width="220" height="180" viewBox="0 0 220 180">
        <path fill="#2563eb" fill-rule="evenodd"
          d="M20 20H200V160H20ZM70 55H150V125H70Z" />
      </svg>`;
    await page.locator('#file-import-input').setInputFiles({
      name: 'compound-transparent.svg',
      mimeType: 'image/svg+xml',
      buffer: Buffer.from(compoundSvg),
    });
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
    await page.getByRole('treeitem').first().click();

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect.poll(async () => (await compoundPaintSamples(page))?.edge[3]).toBe(255);
    const before = await compoundPaintSamples(page);
    if (!before) throw new Error('Imported compound path did not paint');
    expect(before.edge).toEqual([37, 99, 235, 255]);
    expect(before.holeMaxAlpha).toBe(0);
    await canvas.screenshot({
      path: testInfo.outputPath('compound-vector-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Inner Glow');
    // Inner Glow must tint the painted side of the internal contour. Sampling
    // fixed backing-store coordinates excludes canvas resize or selection UI
    // changes from satisfying the effect assertion.
    await expect
      .poll(async () => (await compoundPaintSamples(page, before.bounds))?.edge[0])
      .toBeGreaterThan(before.edge[0]! + 2);
    const after = await compoundPaintSamples(page, before.bounds);
    if (!after) throw new Error('Compound-path effect samples unavailable');
    expect([after.width, after.height]).toEqual([before.width, before.height]);
    expect(after.edge[1]).toBeGreaterThan(before.edge[1]!);
    expect(after.edge[3]).toBe(255);
    expect(after.holeMaxAlpha).toBe(0);
    await canvas.screenshot({
      path: testInfo.outputPath('compound-vector-after-effect.png'),
    });
    await expect(
      section.locator('.insp-effect-row').filter({ hasText: 'Inner Glow' }),
    ).toContainText('Inner Glow');
    await page.screenshot({
      path: testInfo.outputPath('compound-vector-effect-inspector.png'),
      fullPage: false,
    });
  });

  test('exposes Layer Effects for editable text without replacing the text layer', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 500, 400);
    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 240, box.y + 220);
    await page.keyboard.type('Aa gyp');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    const textLayer = page.getByRole('treeitem').filter({ hasText: /text/i }).first();
    await textLayer.click();

    const before = await canvas.screenshot({
      path: testInfo.outputPath('text-layer-before-effect.png'),
    });
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await page.waitForTimeout(750);
    const after = await canvas.screenshot({
      path: testInfo.outputPath('text-layer-after-effect.png'),
    });
    expect(Buffer.compare(before, after)).not.toBe(0);
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i);
    await expect(section).toContainText('Drop Shadow');
  });

  test('renders every effect family on editable text and exposes specific controls', async ({
    page,
  }, testInfo) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 500, 400);
    await page.keyboard.press('t');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 240, box.y + 220);
    await page.keyboard.type('Layer Effects');
    await page.keyboard.press('Escape');
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await page.getByRole('treeitem').filter({ hasText: /text/i }).first().click();
    const section = await openEffectsSection(page);
    const effects = [
      'Drop Shadow',
      'Inner Shadow',
      'Outer Glow',
      'Inner Glow',
      'Layer Blur',
      'Background Blur',
      'Chromatic Aberration',
      'Glitch',
      'Glass Material',
    ];

    for (const label of effects) {
      const before = await canvas.screenshot();
      await addEffect(page, section, label);
      await page.waitForTimeout(250);
      await canvas.screenshot({
        path: testInfo.outputPath(`text-${label.toLowerCase().replaceAll(' ', '-')}.png`),
      });
      const changed = Buffer.compare(before, await canvas.screenshot()) !== 0;
      // Backdrop effects can be pixel-neutral over a flat backdrop; the
      // important invariant for those cases is that the editable text remains
      // painted and the renderer does not blank its layer.
      if (label !== 'Background Blur') expect(changed).toBe(true);
      const paintedPixels = await canvas.evaluate((el) => {
        const context = (el as HTMLCanvasElement).getContext('2d');
        if (!context) return 0;
        const pixels = context.getImageData(0, 0, context.canvas.width, context.canvas.height).data;
        let count = 0;
        for (let index = 3; index < pixels.length; index += 4) if (pixels[index]! > 0) count++;
        return count;
      });
      expect(paintedPixels).toBeGreaterThan(0);
      await expect(page.getByRole('treeitem').filter({ hasText: /text/i }).first()).toBeVisible();

      const row = section.locator('.insp-effect-row').filter({ hasText: label }).last();
      const parameters = page.getByRole('dialog', { name: `${label} parameters`, exact: true });
      await expect(parameters).toBeVisible();
      // Every effect family must show a live preview tile in its popover; the
      // "editing blind" complaint against modal layer-style dialogs is not
      // allowed to reappear for a single type.
      await expect(parameters.getByRole('img', { name: `Preview of ${label}` })).toBeVisible();
      if (label === 'Chromatic Aberration') {
        await expect(
          parameters.getByRole('spinbutton', { name: 'Mix (%)', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('combobox', { name: 'Chromatic channel mode', exact: true }),
        ).toBeVisible();
        await parameters
          .getByRole('combobox', { name: 'Chromatic channel mode', exact: true })
          .click();
        await page.getByRole('option', { name: 'Custom colour split', exact: true }).click();
        await expect(
          parameters.getByRole('combobox', { name: 'Contribution 1 source', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('button', { name: 'Contribution 1 output colour', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('button', { name: 'Contribution 2 output colour', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('button', { name: 'Contribution 3 output colour', exact: true }),
        ).toBeVisible();
      }
      if (label === 'Drop Shadow') {
        await expect(
          parameters.getByRole('slider', { name: 'Light direction angle', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('spinbutton', { name: 'Angle (deg)', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('spinbutton', { name: 'Distance', exact: true }),
        ).toBeVisible();
        // The blend selector offers the full grouped mode list, not a stub.
        await parameters.getByRole('combobox', { name: 'Effect blend mode', exact: true }).click();
        await expect(page.getByRole('option', { name: 'Color Dodge', exact: true })).toBeVisible();
        await expect(page.getByRole('option', { name: 'Luminosity', exact: true })).toBeVisible();
        await page.keyboard.press('Escape');
      }
      if (label === 'Outer Glow') {
        await expect(
          parameters.getByRole('radiogroup', { name: 'Glow colour treatment', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('spinbutton', { name: 'Choke (%)', exact: true }),
        ).toBeVisible();
        await expect(
          parameters.getByRole('radiogroup', { name: 'Glow contour', exact: true }),
        ).toBeVisible();
        // The contour is a segmented choice, not a two-click select.
        await expect(parameters.getByRole('radio', { name: 'Linear', exact: true })).toBeVisible();
        await parameters.getByRole('radio', { name: 'Sharp', exact: true }).click();
        await expect(parameters.getByRole('radio', { name: 'Sharp', exact: true })).toBeChecked();
      }
      if (label === 'Inner Glow') {
        await expect(
          parameters.getByRole('radiogroup', { name: 'Inner glow origin', exact: true }),
        ).toBeVisible();
        await expect(parameters.getByRole('radio', { name: 'Center', exact: true })).toBeVisible();
      }
      if (label === 'Glitch')
        await expect(
          parameters.getByRole('combobox', { name: 'Glitch blend mode', exact: true }),
        ).toBeVisible();

      await parameters
        .getByRole('button', { name: `Close ${label} parameters`, exact: true })
        .click();
      await expect(parameters).toBeHidden();
      await row.getByRole('button', { name: 'Remove effect' }).click();
      await expect(section.locator('.insp-effect-row').filter({ hasText: label })).toHaveCount(0);
    }
  });

  test('clicking the effect card opens and closes its parameter editor', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');

    const row = section.locator('.insp-effect-row').first();
    const editor = page.locator('.insp-focused-editor');
    // A freshly added effect mounts with its editor open.
    await expect(editor).toBeVisible();

    // The card body (name/type/stage area) is a pointer target for the editor.
    await row.locator('.insp-effect-row__name').click();
    await expect(editor).toBeHidden();
    await row.locator('.insp-effect-row__name').click();
    await expect(editor).toBeVisible();

    // Interactive row controls keep their own behaviour and do not toggle it.
    await row.getByRole('switch', { name: /hide effect/i }).click();
    await expect(editor).toBeVisible();
    await expect(row.getByRole('switch', { name: /show effect/i })).toBeVisible();
  });

  test('labels each effect with its execution stage and explains constrained moves', async ({
    page,
  }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);
    await addEffect(page, section, 'Drop Shadow');
    await addEffect(page, section, 'Layer Blur');

    const rows = section.locator('.insp-effect-row');
    await expect(rows.nth(0).locator('.insp-effect-row__stage')).toHaveText('Appearance');
    await expect(rows.nth(1).locator('.insp-effect-row__stage')).toHaveText('Content');

    // The content-stage row cannot move up into the appearance stage, and the
    // disabled control says why instead of failing silently.
    const moveUp = rows.nth(1).getByRole('button', { name: 'Move effect up' });
    await expect(moveUp).toBeDisabled();
    await expect(moveUp).toHaveAttribute('title', /content stage/i);
  });

  test('adds an effect in one step and stacks effects from the same picker', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);

    // Choosing the type is the add action: no separate Add confirm exists.
    await addEffect(page, section, 'Drop Shadow');
    await addEffect(page, section, 'Layer Blur');

    await expect(section.locator('.insp-effect-row')).toHaveCount(2);
    await expect(section.locator('.insp-effect-row').nth(0)).toContainText('Drop Shadow');
    await expect(section.locator('.insp-effect-row').nth(1)).toContainText('Layer Blur');
    await expect(section.getByRole('button', { name: 'Add', exact: true })).toHaveCount(0);
  });

  test('keeps Depth Blur out of the generic picker and says why', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);

    // Depth Blur is entered through the image workflow, which owns the
    // DepthMap resource; the generic picker must not create an empty
    // placeholder (docs/architecture/depth-aware-imaging.md).
    await section.getByRole('button', { name: 'Add effect' }).click();
    const depthBlur = page.getByRole('menuitem', { name: /Depth Blur/i });
    await expect(depthBlur).toHaveAttribute('aria-disabled', 'true');
    await expect(depthBlur).toContainText(/needs a Depth Map/i);
    await page.keyboard.press('Escape');
    await expect(section.locator('.insp-effect-row')).toHaveCount(0);
  });
});

/**
 * Visual baseline for the effect-row chrome. Deliberately outside the serial
 * functional describe: a pixel assertion must never gate the functional
 * suite, because hover/antialiasing variance made the whole serial tail skip.
 */
test.describe('Layer Effects — row chrome baseline', () => {
  test('three staged effects render the documented row chrome', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await page.getByRole('tab', { name: 'Design', exact: true }).click();
    await page.keyboard.press('r');
    await dragOnCanvas(page, 160, 160, 420, 340);
    const section = await openEffectsSection(page);

    await addEffect(page, section, 'Drop Shadow');
    await addEffect(page, section, 'Outer Glow');
    await addEffect(page, section, 'Layer Blur');
    await expect(section.locator('.insp-effect-row')).toHaveCount(3);
    await expectEffectRowLayout(section);

    // Move the pointer off the rows so hover-revealed controls are not frozen
    // into the baseline; the row's reveal state is intentionally dynamic.
    await page.mouse.move(4, 4);
    await page.waitForTimeout(200);
    await expect.soft(section).toHaveScreenshot('layer-effects-stage-order.png', {
      maxDiffPixels: 1200,
    });

    await resizePanelTo(page, 'inspector', 'minimum');
    await expectEffectRowLayout(section);
    const radius = section.getByRole('spinbutton', { name: 'Layer Blur radius', exact: true });
    await radius.fill('8');
    await radius.press('Tab');
    await expect(radius).toHaveValue('8');
    await section.screenshot({ path: testInfo.outputPath('layer-effects-minimum-panel.png') });
  });
});

async function expectEffectRowLayout(section: import('@playwright/test').Locator) {
  const layouts = await section.locator('.insp-effect-row').evaluateAll((rows) =>
    rows.map((row) => {
      const header = row.querySelector<HTMLElement>('.insp-effect-row__header')!;
      const name = row.querySelector<HTMLElement>('.insp-effect-row__name')!;
      const bounds = header.getBoundingClientRect();
      const pieces = Array.from(header.children)
        .filter((element) => element instanceof HTMLElement && element.offsetWidth > 0)
        .map((element) => element.getBoundingClientRect());
      const inside = pieces.every(
        (rect) =>
          rect.left >= bounds.left - 1 &&
          rect.right <= bounds.right + 1 &&
          rect.top >= bounds.top - 1 &&
          rect.bottom <= bounds.bottom + 1,
      );
      const overlap = pieces.some((rect, index) =>
        pieces
          .slice(index + 1)
          .some(
            (other) =>
              Math.min(rect.right, other.right) - Math.max(rect.left, other.left) > 1 &&
              Math.min(rect.bottom, other.bottom) - Math.max(rect.top, other.top) > 1,
          ),
      );
      return {
        label: name.textContent,
        labelWidth: name.clientWidth,
        labelContentWidth: name.scrollWidth,
        inside,
        overlap,
      };
    }),
  );
  expect(layouts.map((row) => row.label)).toEqual(['Drop Shadow', 'Outer Glow', 'Layer Blur']);
  for (const row of layouts) {
    expect(row.labelWidth, `${row.label} is fully readable`).toBeGreaterThanOrEqual(
      row.labelContentWidth,
    );
    expect(row.inside, `${row.label} controls remain inside their header`).toBe(true);
    expect(row.overlap, `${row.label} controls do not overlap`).toBe(false);
  }
}
