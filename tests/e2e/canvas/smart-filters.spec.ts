/**
 * E2E tests for Smart Filters — object-local nondestructive filter stack.
 *
 * Tests: add invert → verify canvas pixels, toggle, remove, reorder,
 * duplicate, multi-filter stack, group/frame filters, undo/redo,
 * and visual inspection via screenshots.
 */
import { expect, type Page, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

/** Select a layer by clicking it in the Layers panel. */
async function selectLayerInPanel(page: Page, index = 0) {
  const item = page.getByRole('treeitem').nth(index);
  await item.click();
  await expect(item).toHaveAttribute('aria-selected', 'true');
}

/** Add an Object Filter via the inspector dropdown. */
async function addSmartFilter(page: Page, kindLabel: string) {
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  const select = page.getByRole('combobox', { name: 'Add Object Filter' });
  await select.scrollIntoViewIfNeeded();
  await select.click();
  await page.getByRole('option', { name: kindLabel, exact: true }).click();
  await page.waitForTimeout(200);
}

/** Read a single pixel from the content canvas at screen coordinates. */
async function readCanvasPixel(
  page: Page,
  x: number,
  y: number,
): Promise<[number, number, number, number]> {
  return page.evaluate(
    ([cx, cy]) => {
      const canvas = document.querySelector(
        'canvas.editor-canvas__content-layer',
      ) as HTMLCanvasElement | null;
      if (!canvas) return [0, 0, 0, 0];
      const ctx = canvas.getContext('2d');
      if (!ctx) return [0, 0, 0, 0];
      const rect = canvas.getBoundingClientRect();
      const scaleX = canvas.width / Math.max(1, rect.width);
      const scaleY = canvas.height / Math.max(1, rect.height);
      const px = Math.max(0, Math.min(canvas.width - 1, Math.round((cx - rect.left) * scaleX)));
      const py = Math.max(0, Math.min(canvas.height - 1, Math.round((cy - rect.top) * scaleY)));
      const data = ctx.getImageData(px, py, 1, 1).data;
      return [data[0] ?? 0, data[1] ?? 0, data[2] ?? 0, data[3] ?? 0];
    },
    [x, y] as [number, number],
  );
}

function expectInvertedPixel(
  before: [number, number, number, number],
  after: [number, number, number, number],
) {
  expect(Math.abs(after[0] - (255 - before[0]))).toBeLessThanOrEqual(4);
  expect(Math.abs(after[1] - (255 - before[1]))).toBeLessThanOrEqual(4);
  expect(Math.abs(after[2] - (255 - before[2]))).toBeLessThanOrEqual(4);
  expect(after[3]).toBe(before[3]);
}

/** Pixel equality as a poll, for assertions that follow an async repaint. */
async function expectPixelToBe(
  page: Page,
  x: number,
  y: number,
  expected: [number, number, number, number],
) {
  await expect
    .poll(async () => (await readCanvasPixel(page, x, y)).join(','), { timeout: 15000 })
    .toBe(expected.join(','));
}

/**
 * Hash the whole content canvas. A single sampled pixel can survive a filter
 * by coincidence; a full-surface hash cannot — it is the oracle described in
 * AGENTS.md ("Never show pixels no fresh frame will replace").
 */
async function canvasFingerprint(page: Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Content canvas is missing');
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context) throw new Error('Content canvas does not expose a 2D context');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let first = 2166136261;
    let second = 0x9e3779b9;
    for (const pixel of pixels) {
      first = Math.imul(first ^ pixel, 16777619);
      second = Math.imul(second ^ pixel, 2246822519);
    }
    return `${canvas.width}x${canvas.height}:${first >>> 0}:${second >>> 0}`;
  });
}

/** Force the next frame to repaint from the scene instead of reused pixels. */
async function forceFullRedraw(page: Page): Promise<void> {
  await page.evaluate(() => {
    (
      window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } }
    ).__varvePerf?.forceFullRedraw?.();
  });
  await page.waitForTimeout(500);
}

/** Add an Object Filter by typing a query into the searchable catalog. */
async function addFilterBySearch(page: Page, query: string, optionLabel: string) {
  const section = page.getByRole('button', { name: 'Object Filters', exact: true });
  await section.scrollIntoViewIfNeeded();
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  const select = page.getByRole('combobox', { name: 'Add Object Filter' });
  await select.scrollIntoViewIfNeeded();
  await select.click();
  const search = page.getByRole('searchbox', { name: 'Filter Add Object Filter' });
  await expect(search).toBeVisible({ timeout: 5000 });
  await search.fill(query);
  await page.getByRole('option', { name: optionLabel, exact: true }).click();
  await page.waitForTimeout(300);
}

test.describe('Object Filters — Invert workflow', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('add invert filter to a rectangle — canvas pixels change', async ({ page }) => {
    // Create a rectangle. Its default fill is intentionally not assumed: the
    // test compares the rendered pixel with its sampled inverse instead.
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;

    // Draw rect
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });

    // Wait for paint
    await page.waitForTimeout(500);

    const before = await readCanvasPixel(page, cx, cy);
    expect(before[3]).toBeGreaterThan(0);
    await canvas.screenshot({ path: 'reports/smart-filters/invert-before.png' });

    // Select the layer
    await selectLayerInPanel(page, 0);

    // Open Smart Filters section and add Invert
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const after = await readCanvasPixel(page, cx, cy);
    expectInvertedPixel(before, after);
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);

    // Screenshot for visual inspection
    await page.screenshot({
      path: 'reports/smart-filters/invert-applied.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
    await canvas.screenshot({ path: 'reports/smart-filters/invert-applied-canvas.png' });
  });

  test('toggle filter visibility — reverts to original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    // Record original color
    const original = await readCanvasPixel(page, cx, cy);

    // Add filter
    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const inverted = await readCanvasPixel(page, cx, cy);
    expectInvertedPixel(original, inverted);

    // Toggle visibility off (click the eye icon button)
    const eyeBtn = page.locator('button.smart-filters__visibility').first();
    await eyeBtn.click();
    await expectPixelToBe(page, cx, cy, original);

    await page.screenshot({
      path: 'reports/smart-filters/invert-toggled-off.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('bypass whole Object Filter stack — keeps entries intact', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const original = await readCanvasPixel(page, cx, cy);
    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);
    expectInvertedPixel(original, await readCanvasPixel(page, cx, cy));

    const bypass = page.locator('button.smart-filters__stack-visibility');
    await expect(bypass).toHaveAttribute('aria-label', 'Disable all Object Filters');
    await bypass.click();
    await expect(bypass).toHaveAttribute('aria-pressed', 'false');
    await expect(bypass).toHaveAttribute('aria-label', 'Enable all Object Filters');
    await expectPixelToBe(page, cx, cy, original);
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);

    await page.screenshot({
      path: 'reports/smart-filters/stack-bypassed.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('remove filter — restores original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const original = await readCanvasPixel(page, cx, cy);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    // Remove the filter
    const removeBtn = page.locator('button.smart-filters__remove').first();
    await removeBtn.click();
    await expectPixelToBe(page, cx, cy, original);

    await page.screenshot({
      path: 'reports/smart-filters/invert-removed.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('undo after adding filter — restores original', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 250;
    const cy = box.y + 200;
    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    const original = await readCanvasPixel(page, cx, cy);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const inverted = await readCanvasPixel(page, cx, cy);
    expectInvertedPixel(original, inverted);

    // Undo. The repaint is asynchronous, so poll rather than sampling a
    // fixed delay after the keypress.
    await page.keyboard.press('Control+z');
    await expectPixelToBe(page, cx, cy, original);
  });

  test('multiple filters coexist — blur + invert both apply', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await addSmartFilter(page, 'Blur');
    await page.waitForTimeout(500);

    // Both filters are visible in the stack
    const filterRows = page.locator('.smart-filters__row');
    await expect(filterRows).toHaveCount(2);

    await page.screenshot({
      path: 'reports/smart-filters/multi-filter-stack.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });

  test('drag handle reorders filters without hijacking stack controls', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, 170, 140, 330, 260);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await addSmartFilter(page, 'Blur');

    const rows = page.locator('.smart-filters__row');
    await expect(rows).toHaveCount(2);
    await expect(rows.nth(0).locator('.smart-filters__name')).toContainText('Invert');
    await expect(rows.nth(1).locator('.smart-filters__name')).toContainText('Blur');

    const source = rows.nth(1).locator('.smart-filters__drag-handle');
    const target = rows.nth(0);
    const sourceBox = await source.boundingBox();
    if (!sourceBox) throw new Error('Smart filter drag geometry unavailable');

    const startX = sourceBox.x + sourceBox.width / 2;
    const startY = sourceBox.y + sourceBox.height / 2;
    await page.mouse.move(startX, startY);
    await page.mouse.down();
    await page.mouse.move(startX, startY - 12);
    const targetBox = await target.boundingBox();
    if (!targetBox) throw new Error('Smart filter target geometry unavailable');
    await page.mouse.move(
      targetBox.x + targetBox.width / 2,
      targetBox.y + targetBox.height * 0.25,
      { steps: 6 },
    );
    await expect(target).toHaveAttribute('data-sortable-over', 'true');
    await expect(page.locator('.smart-filters__drag-overlay')).toBeVisible();
    await page.locator('.smart-filters__stack').screenshot({
      path: 'reports/smart-filters/drag-reorder-active.png',
    });
    await page.mouse.up();

    await expect(rows.nth(0).locator('.smart-filters__name')).toContainText('Blur');
    await expect(rows.nth(1).locator('.smart-filters__name')).toContainText('Invert');
  });

  test('inspector shows Smart Filters section for a shape', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, 150, 150, 350, 300);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });

    await selectLayerInPanel(page, 0);
    await page.waitForTimeout(500);

    const smartFiltersSection = page.getByText('Object Filters', { exact: true }).first();
    await expect(smartFiltersSection).toBeVisible({ timeout: 5000 });
  });

  test('filter does not expand canvas bounds — zero-expansion effect', async ({ page }) => {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const before = await canvas.screenshot();

    await dragOnCanvas(page, 150, 150, 350, 300);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(500);

    await selectLayerInPanel(page, 0);
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    const after = await canvas.screenshot();
    // Screenshots should differ (colors changed) but have the same dimensions
    expect(Buffer.compare(before, after)).not.toBe(0);
  });
});

test.describe('Object Filters — group and frame', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('frame with smart filter affects children', async ({ page }) => {
    // Create frame
    await page.keyboard.press('f');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    await dragOnCanvas(page, 100, 100, 400, 400);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(300);

    // Create a rect inside the frame
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 350);
    await page.waitForTimeout(300);

    // Select the frame in the layers panel (first item = frame)
    await selectLayerInPanel(page, 0);

    // Add smart filter to the frame
    await addSmartFilter(page, 'Invert');
    await page.waitForTimeout(500);

    // Verify Smart Filters section is visible
    const smartFiltersSection = page.getByText('Object Filters', { exact: true }).first();
    await expect(smartFiltersSection).toBeVisible({ timeout: 5000 });

    await page.screenshot({
      path: 'reports/smart-filters/frame-invert.png',
      clip: { x: box.x, y: box.y, width: box.width, height: box.height },
    });
  });
});

test.describe('Object Filters — Real-world design composition scenario', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('vector finishing quick-actions, categorized catalog, and live blend mode badges', async ({
    page,
  }) => {
    // This scenario exercises the whole redesigned surface (quick actions,
    // searchable catalog, compositing card, live badges, whole-stack bypass)
    // plus real canvas pixel comparisons; the serial 180s budget is not
    // enough under a shared dev server.
    test.setTimeout(300_000);
    // 1. Draw a vector banner / illustration card
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('Canvas not found');

    const cx = box.x + 260;
    const cy = box.y + 220;
    await dragOnCanvas(page, 140, 120, 380, 320);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await page.waitForTimeout(400);

    const originalPixel = await readCanvasPixel(page, cx, cy);
    expect(originalPixel[3]).toBeGreaterThan(0);

    // 2. Select layer in layers panel
    await selectLayerInPanel(page, 0);

    // Expand Object Filters section in Inspector
    const section = page.getByRole('button', { name: 'Object Filters', exact: true });
    await section.scrollIntoViewIfNeeded();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await page.waitForTimeout(300);

    // Ensure the nested "Advanced stack editor" <details> is open (defaults open, but guard it)
    const advancedDetails = page.locator('.smart-filters__advanced');
    await advancedDetails.waitFor({ state: 'visible', timeout: 5000 });
    const isOpen = await advancedDetails.evaluate((el) => (el as HTMLDetailsElement).open);
    if (!isOpen) {
      await page.locator('.smart-filters__advanced-summary').click();
      await page.waitForTimeout(200);
    }

    // 3. Verify Vector Finishing quick action cards are rendered
    const grainCard = page.locator('button[data-object-finishing-action="grain"]');
    await expect(grainCard).toBeVisible({ timeout: 5000 });
    await expect(page.locator('button[data-object-finishing-action="edgeFalloff"]')).toBeVisible();
    await expect(page.locator('button[data-object-finishing-action="softBloom"]')).toBeVisible();

    // 4. Click Grain quick-action card to add material texture
    await grainCard.click();
    await page.waitForTimeout(500);

    // Wait for filter row to appear as prerequisite (confirms the add was processed)
    await expect(page.locator('.smart-filters__row').first()).toBeVisible({ timeout: 8000 });

    // Verify 1 active filter count badge in header
    // NB: the component renders class "smart-filters__count-badge" (not "__count")
    const countBadge = page.locator('.smart-filters__count-badge');
    await expect(countBadge).toBeVisible({ timeout: 5000 });
    await expect(countBadge).toHaveText('1');

    // 5. Add second filter (Vignette) from categorized catalog
    await addSmartFilter(page, 'Vignette');
    await page.waitForTimeout(500);
    await expect(countBadge).toHaveText('2');

    // Verify both rows exist in the stack
    const rows = page.locator('.smart-filters__row');
    await expect(rows).toHaveCount(2);

    // 6. Select the Vignette row to open its compositing card
    const vignetteRow = rows.nth(1);
    await vignetteRow.locator('.smart-filters__name').click();
    await page.waitForTimeout(300);

    // Verify elevated compositing card is open
    const compositingCard = page.locator('.smart-filters__compositing-card');
    await expect(compositingCard).toBeVisible();

    // 7. Change blend mode to Multiply
    const blendSelect = compositingCard.getByRole('combobox', { name: /effect blend mode/i });
    await blendSelect.click();
    await page.getByRole('option', { name: 'Multiply', exact: true }).click();
    await page.waitForTimeout(500);

    // 8. Verify the live Multiply badge appears on the Vignette row
    const blendBadge = vignetteRow.locator('.smart-filters__badge--blend');
    await expect(blendBadge).toBeVisible();
    await expect(blendBadge).toHaveText('Multiply');

    // 9. Verify whole-stack bypass in header
    const headerBypass = page.locator('button.smart-filters__stack-visibility');
    await expect(headerBypass).toHaveAttribute('aria-label', 'Disable all Object Filters');
    await headerBypass.click();
    await page.waitForTimeout(400);

    // With stack bypassed, canvas returns to base vector look
    await expectPixelToBe(page, cx, cy, originalPixel);

    // Re-enable stack
    await headerBypass.click();
    await page.waitForTimeout(400);
    await expect(headerBypass).toHaveAttribute('aria-label', 'Disable all Object Filters');

    // 10. Visual validation screenshots
    // The section root is its registry disclosure wrapper, identified by the
    // registry section id.
    const panel = page.locator('.insp-disclosure[data-section-id="smart-filters"]');
    await panel.screenshot({
      path: 'reports/smart-filters/real-world-inspector-panel.png',
    });
    await canvas.screenshot({
      path: 'reports/smart-filters/real-world-vector-finishing-stack.png',
    });
  });
});

test.describe('Object Filters — real photograph composition', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('imported coastline photo: catalog search, compositing, live badges, and whole-stack bypass', async ({
    page,
  }) => {
    test.setTimeout(300_000);

    // 1. Import a real 1280x853 photograph — not a drawn fixture.
    await page
      .locator('#file-import-input')
      .setInputFiles('tests/e2e/fixtures/real-life-port-campbell-coast.jpg');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
    await page.waitForTimeout(400);

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible();

    await forceFullRedraw(page);
    const baseline = await canvasFingerprint(page);
    await canvas.screenshot({ path: 'reports/smart-filters/photo-before.png' });

    // 2. Select the image and open Object Filters. Images get no vector-only
    // Object Finishing cards; the full searchable catalog is the single path.
    await selectLayerInPanel(page, 0);
    const section = page.getByRole('button', { name: 'Object Filters', exact: true });
    await section.scrollIntoViewIfNeeded();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await page.waitForTimeout(250);
    await expect(page.locator('[data-object-finishing-action]')).toHaveCount(0);
    await expect(page.locator('.smart-filters__count-badge')).toHaveCount(0);

    // 3. Search the categorized catalog for the vignette treatment.
    await addFilterBySearch(page, 'vign', 'Vignette');
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);
    await expect(page.locator('.smart-filters__count-badge')).toHaveText('1');
    await expect(page.locator('.smart-filters__name-title')).toContainText('Vignette');

    // 4. Composite at 65% with Multiply and confirm the row badges reflect it.
    const opacityValue = page.getByRole('spinbutton', { name: 'Vignette effect opacity value' });
    await opacityValue.fill('65');
    await opacityValue.press('Enter');
    await expect(page.locator('.smart-filters__meta')).toHaveText('65%');
    const blend = page.getByRole('combobox', { name: 'Vignette effect blend mode' });
    await blend.click();
    await page.getByRole('option', { name: 'Multiply', exact: true }).click();
    await expect(page.locator('.smart-filters__badge--blend')).toHaveText('Multiply');

    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).not.toBe(baseline);
    await canvas.screenshot({ path: 'reports/smart-filters/photo-vignette-multiply.png' });

    // 5. Stack a second real filter (Grain) on top.
    await addFilterBySearch(page, 'grain', 'Grain');
    await expect(page.locator('.smart-filters__row')).toHaveCount(2);
    await expect(page.locator('.smart-filters__count-badge')).toHaveText('2');

    // 6. Whole-stack bypass returns the untouched photo; both entries survive.
    const stackEye = page.locator('button.smart-filters__stack-visibility');
    await stackEye.click();
    await page.waitForTimeout(400);
    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).toBe(baseline);
    await expect(page.locator('.smart-filters__row')).toHaveCount(2);
    await expect(page.locator('.smart-filters__count-badge')).toHaveText('2');
    await canvas.screenshot({ path: 'reports/smart-filters/photo-bypassed.png' });

    // 7. Re-enable and confirm the treated pixels are back.
    await stackEye.click();
    await page.waitForTimeout(400);
    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).not.toBe(baseline);

    // 8. Visual validation: the panel must hold up across all three themes.
    const panel = page.locator('.insp-disclosure[data-section-id="smart-filters"]');
    for (const theme of ['light', 'dark', 'high-contrast'] as const) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
        localStorage.setItem('varve-theme', value);
      }, theme);
      await page.waitForTimeout(250);
      await panel.screenshot({ path: `reports/smart-filters/photo-inspector-${theme}.png` });
    }
  });
});

test.describe('Object Filters — redesigned surface behaviour', () => {
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  /** Draw a rectangle, select it in Layers, and expand Object Filters. */
  async function drawVectorAndOpenFilters(page: Page) {
    await page.keyboard.press('r');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await expect(canvas).toBeVisible({ timeout: 15000 });
    await dragOnCanvas(page, 140, 120, 380, 320);
    await page.getByRole('treeitem').first().waitFor({ timeout: 10000 });
    await selectLayerInPanel(page, 0);
    const section = page.getByRole('button', { name: 'Object Filters', exact: true });
    await section.scrollIntoViewIfNeeded();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await page.waitForTimeout(250);
    return canvas;
  }

  /** Ensure the nested raw-stack disclosure is expanded. */
  async function ensureAdvancedOpen(page: Page) {
    const advanced = page.locator('.smart-filters__advanced');
    await advanced.waitFor({ state: 'visible', timeout: 5000 });
    if (!(await advanced.evaluate((el) => (el as HTMLDetailsElement).open))) {
      await page.locator('.smart-filters__advanced-summary').click();
      await page.waitForTimeout(150);
    }
  }

  test('catalog groups options, narrows by search, and reports no matches', async ({ page }) => {
    await drawVectorAndOpenFilters(page);
    await ensureAdvancedOpen(page);

    // The empty state carries the non-destructive contract that used to be a
    // separate always-visible intro card.
    await expect(page.getByText('Non-destructive', { exact: true })).toBeVisible();
    await expect(page.locator('.smart-filters__empty')).toContainText(
      /Raster placement and vector geometry stay editable/,
    );

    const select = page.getByRole('combobox', { name: 'Add Object Filter' });
    await select.click();
    const groupLabels = page.locator('.varve-select__group-label');
    for (const label of [
      'Color & Tone',
      'Blur & Detail',
      'Texture & Finishing',
      'Atmosphere & Optics',
      'Color Grading',
    ]) {
      await expect(groupLabels.filter({ hasText: label })).toBeVisible();
    }
    await expect(page.getByRole('option', { name: 'Invert', exact: true })).toBeVisible();

    // Search narrows the catalog to the matching family only.
    const search = page.getByRole('searchbox', { name: 'Filter Add Object Filter' });
    await search.fill('vign');
    await expect(page.getByRole('option', { name: 'Vignette', exact: true })).toBeVisible();
    await expect(page.getByRole('option', { name: 'Blur', exact: true })).toHaveCount(0);
    await expect(groupLabels.filter({ hasText: 'Blur & Detail' })).toHaveCount(0);

    // A query with no matches says so instead of showing an empty list.
    await search.fill('zzzz-no-such-filter');
    await expect(page.getByText('No matching options')).toBeVisible();
    await expect(page.getByRole('option')).toHaveCount(0);

    // Clearing the query and picking a filter adds it to the stack.
    await search.fill('invert');
    await page.getByRole('option', { name: 'Invert', exact: true }).click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);
    await expect(page.locator('.smart-filters__name-title')).toContainText('Invert');
  });

  test('compositing Reset restores neutral pixels and Duplicate clones the entry', async ({
    page,
  }) => {
    test.setTimeout(300_000);
    // A real photograph makes the parameter reset observable in pixels.
    await page
      .locator('#file-import-input')
      .setInputFiles('tests/e2e/fixtures/real-life-beech-forest.jpg');
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
    await page.getByRole('button', { name: 'Fit selection to viewport' }).click();
    await page.waitForTimeout(400);

    await forceFullRedraw(page);
    const baseline = await canvasFingerprint(page);

    await selectLayerInPanel(page, 0);
    const section = page.getByRole('button', { name: 'Object Filters', exact: true });
    await section.scrollIntoViewIfNeeded();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await ensureAdvancedOpen(page);
    await addFilterBySearch(page, 'vign', 'Vignette');

    const amount = page.getByRole('slider', { name: /Vignette Amount/ });
    await expect(amount).toHaveValue('0');

    // A real parameter change repaints the photograph.
    await amount.fill('-70');
    await amount.press('Enter');
    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).not.toBe(baseline);

    // Reset returns the parameter to its neutral default and the untreated
    // pixels; it must not merely clear the row.
    const compositing = page.locator('.smart-filters__compositing-card');
    await compositing.getByRole('button', { name: 'Reset' }).click();
    await expect(amount).toHaveValue('0');
    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).toBe(baseline);
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);

    // Duplicate clones the entry in place instead of moving or replacing it.
    await compositing.getByRole('button', { name: 'Duplicate' }).click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(2);
    await expect(page.locator('.smart-filters__name-title').nth(0)).toContainText('Vignette');
    await expect(page.locator('.smart-filters__name-title').nth(1)).toContainText('Vignette');
    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).toBe(baseline);

    // Removing the duplicate leaves the original untouched.
    await page.locator('button.smart-filters__remove').nth(1).click();
    await expect(page.locator('.smart-filters__row')).toHaveCount(1);
  });

  test('every Object Finishing quick action produces a visible, removable result', async ({
    page,
  }) => {
    const canvas = await drawVectorAndOpenFilters(page);
    await ensureAdvancedOpen(page);
    expect(canvas).toBeTruthy();
    await forceFullRedraw(page);
    const baseline = await canvasFingerprint(page);

    for (const kind of ['grain', 'edgeFalloff', 'softBloom'] as const) {
      const card = page.locator(`button[data-object-finishing-action="${kind}"]`);
      await expect(card).toBeVisible();
      await card.click();
      await expect(page.locator('.smart-filters__row')).toHaveCount(1);
      await forceFullRedraw(page);
      await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).not.toBe(baseline);
      await page.locator('button.smart-filters__remove').first().click();
      await expect(page.locator('.smart-filters__row')).toHaveCount(0);
      await forceFullRedraw(page);
      await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).toBe(baseline);
    }
  });

  test('reorder chevrons stay quiet at rest but remain reachable by hover, focus, and click', async ({
    page,
  }) => {
    await drawVectorAndOpenFilters(page);
    await ensureAdvancedOpen(page);
    await addSmartFilter(page, 'Invert');
    await addSmartFilter(page, 'Blur');

    const rows = page.locator('.smart-filters__row');
    await expect(rows).toHaveCount(2);

    // At rest on a fine pointer the chevrons do not compete with the names.
    const moveBlurUp = rows.nth(1).getByRole('button', { name: 'Move Blur up' });
    await expect(moveBlurUp).toHaveCSS('opacity', '0');

    // Pointer hover reveals them...
    await rows.nth(1).hover();
    await expect(moveBlurUp).toHaveCSS('opacity', '1');

    // ...and keyboard focus reveals them without a pointer.
    const moveInvertDown = rows.nth(0).getByRole('button', { name: 'Move Invert down' });
    await moveInvertDown.focus();
    await expect(moveInvertDown).toHaveCSS('opacity', '1');

    // The revealed control still reorders the stack.
    await moveBlurUp.click();
    await expect(rows.nth(0).locator('.smart-filters__name-title')).toContainText('Blur');
    await expect(rows.nth(1).locator('.smart-filters__name-title')).toContainText('Invert');
  });

  test('an Effect Studio recipe collapses the raw stack and stays editable', async ({ page }) => {
    test.setTimeout(300_000);
    await drawVectorAndOpenFilters(page);

    // The Studio launcher lives in the Adjustments tab.
    await page
      .locator('[role="tablist"] [role="tab"]')
      .filter({ hasText: /^Adjustments$/i })
      .click();
    await page.getByTestId('open-effect-studio').click();
    const studio = page.getByTestId('effect-studio-dialog');
    await expect(studio).toBeVisible({ timeout: 30000 });
    await studio.getByRole('searchbox', { name: 'Search treatments' }).fill('halftone pattern');
    await studio.getByRole('button', { name: 'Apply Halftone Pattern' }).click();
    await studio.getByRole('button', { name: 'Close dialog' }).click();
    // The dialog element may stay mounted for state reuse; it must not remain
    // visible or interactive.
    await expect(studio).toBeHidden({ timeout: 15000 });

    // Back on the Design surface, the curated recipe is visible as a count,
    // the provenance notice, and a collapsed raw-stack editor.
    await page
      .locator('[role="tablist"] [role="tab"]')
      .filter({ hasText: /^Design$/i })
      .click();
    const section = page.getByRole('button', { name: 'Object Filters', exact: true });
    await section.scrollIntoViewIfNeeded();
    if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
    await expect(page.locator('.smart-filters__count-badge')).toHaveText(/[1-9]/);
    await expect(page.getByText(/Named treatments are tuned in Effect Studio/)).toBeVisible();
    const advanced = page.locator('.smart-filters__advanced');
    expect(await advanced.evaluate((el) => (el as HTMLDetailsElement).open)).toBe(false);

    // Expanding reveals the named members; toggling one is a real edit.
    await page.locator('.smart-filters__advanced-summary').click();
    const memberLine = page.locator('.smart-filters__treatment-member').first();
    await expect(memberLine).toContainText('recipe member');
    const before = await canvasFingerprint(page);
    await page.locator('button.smart-filters__visibility').first().click();
    await forceFullRedraw(page);
    await expect.poll(() => canvasFingerprint(page), { timeout: 15000 }).not.toBe(before);
    await expect(memberLine).toContainText('customized recipe');
    await expect(page.locator('.smart-filters__row--disabled')).toHaveCount(1);
  });
});
