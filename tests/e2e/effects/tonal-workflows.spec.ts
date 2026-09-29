import { mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ video: 'on' });
test.beforeEach(async ({ page }) => {
  page.setDefaultTimeout(15000);
});
test.afterEach(async ({ page }, info) => {
  const video = page.video();
  if (!video) return;
  const name = info.title.includes('drag crossing')
    ? 'curve-interaction'
    : info.title.includes('editing sharpening')
      ? 'sharpen-reopen'
      : 'controls';
  await page.close();
  mkdirSync(path.resolve('reports/ui-review/tonal-workflows'), { recursive: true });
  await video.saveAs(path.resolve(`reports/ui-review/tonal-workflows/${name}.webm`));
});

async function navigateTonalEditor(page: Page) {
  try {
    await navigateToEditor(page);
  } catch (error) {
    // The shared startup helper can observe a transient shell before web
    // storage returns to Home. Continue through the actual created file card.
    const card = page.getByRole('gridcell').first();
    if (!(await card.isVisible().catch(() => false))) throw error;
    await card.dblclick();
    await page
      .locator('canvas.editor-canvas__content-layer')
      .waitFor({ state: 'visible', timeout: 30000 });
  }
}

/** Observe real diagnostic paint completion; do not intercept the renderer. */
async function observeDetailLatency(page: Page) {
  await page.evaluate(() => {
    const timings: number[] = [];
    let started = 0;
    Object.defineProperty(window, '__tonalDetailLatency', { value: timings, configurable: true });
    document.addEventListener(
      'click',
      (event) => {
        const button = (event.target as Element).closest('button');
        if (button?.textContent?.trim() === 'Compare document-pixel detail')
          started = performance.now();
      },
      true,
    );
    new MutationObserver((mutations) => {
      if (
        started &&
        mutations.some(
          (mutation) =>
            mutation.type === 'attributes' &&
            (mutation.target as Element).getAttribute('aria-label') === 'Sharpen detail output',
        )
      ) {
        // Canvas dimensions are assigned immediately before synchronous pixel
        // upload. Observer delivery follows that completed upload.
        timings.push(performance.now() - started);
        started = 0;
      }
    }).observe(document.body, {
      subtree: true,
      attributes: true,
      attributeFilter: ['width', 'height'],
    });
  });
}

async function detailLatencies(page: Page): Promise<number[]> {
  return page.evaluate(
    () => (window as unknown as Window & { __tonalDetailLatency: number[] }).__tonalDetailLatency,
  );
}

const review = path.resolve('reports/ui-review/tonal-workflows');
async function add(page: Page, name: string) {
  await page.getByRole('button', { name: /add adjustment/i }).click();
  await page.getByRole('menuitem', { name, exact: true }).click();
}
async function number(page: Page, name: string, value: string) {
  const field = page.getByRole('spinbutton', { name, exact: true });
  await field.fill(value);
  await field.press('Enter');
}
test('retains curve channels, precise points and mixer rows through actual controls', async ({
  page,
}) => {
  mkdirSync(review, { recursive: true });
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/photo-fixture.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('Shift+1');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await expect(page.locator('.adj-panel__header-name')).toHaveText('Adjustment Filters');
  await add(page, 'Curves');
  await page.getByRole('radio', { name: 'R', exact: true }).click();
  await number(page, 'Curve output', '12.5');
  await page.getByRole('radio', { name: 'B', exact: true }).click();
  await number(page, 'Curve output', '5.25');
  await page.getByRole('radio', { name: 'R', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Curve output', exact: true })).toHaveValue(
    '12.5',
  );
  await page.getByRole('button', { name: 'Add point', exact: true }).click();
  await number(page, 'Curve input', '77.25');
  await number(page, 'Curve output', '144.75');
  const graph = page.getByRole('img', { name: /Curve editor/ });
  await graph.scrollIntoViewIfNeeded();
  const graphBox = await graph.boundingBox();
  const panelBox = await page.getByRole('region', { name: 'Inspector', exact: true }).boundingBox();
  expect(graphBox!.width).toBeLessThanOrEqual(panelBox!.width);
  await page.screenshot({ path: path.join(review, '01-curves-light.png') });
  await add(page, 'Channel Mixer');
  await number(page, 'Red percent', '70');
  await page.getByRole('combobox', { name: 'Output channel', exact: true }).click();
  await page.getByRole('option', { name: 'Blue', exact: true }).click();
  await number(page, 'Green percent', '30');
  await page.getByRole('combobox', { name: 'Output channel', exact: true }).click();
  await page.getByRole('option', { name: 'Red', exact: true }).click();
  await expect(page.getByRole('spinbutton', { name: 'Red percent', exact: true })).toHaveValue(
    '70',
  );
  await page.screenshot({ path: path.join(review, '02-mixer-light.png') });
});

test('white balance samples upstream pixels, repeats, undoes, and split toning has real controls', async ({
  page,
}) => {
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('Shift+1');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await add(page, 'White Balance');
  await expect(
    page.getByRole('button', { name: 'Sample neutral patch', exact: true }),
  ).toBeVisible();
  await number(page, 'Source sample X', '20');
  await number(page, 'Source sample Y', '20');
  await page.getByRole('button', { name: 'Sample neutral patch', exact: true }).click();
  const red = page.getByRole('spinbutton', { name: 'red gain', exact: true });
  await expect(red).not.toHaveValue('1');
  const gain = await red.inputValue();
  await page.getByRole('button', { name: 'Sample neutral patch', exact: true }).click();
  await expect(red).toHaveValue(gain);
  await page.getByRole('button', { name: 'Reset white balance', exact: true }).click();
  await expect(red).toHaveValue('1');
  await page.keyboard.press('Control+z');
  await expect(red).toHaveValue(gain);
  await page.screenshot({ path: path.join(review, '03-white-balance-light.png') });
  await add(page, 'Split Toning');
  await page.getByRole('combobox', { name: 'Split tone preset', exact: true }).click();
  await page.getByRole('option', { name: 'Cool shadows · warm highlights', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Shadow saturation value (%)', exact: true }),
  ).toHaveValue('18');
  await number(page, 'Shadow range pivot value (%)', '61');
  await page.screenshot({ path: path.join(review, '04-split-tone-light.png') });
  await page.getByRole('button', { name: 'Reset split toning', exact: true }).click();
  await expect(
    page.getByRole('spinbutton', { name: 'Shadow saturation value (%)', exact: true }),
  ).toHaveValue('0');
});

test('channel inspection creates reusable selection coverage through the existing inspector', async ({
  page,
}) => {
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('button', { name: 'Selection Sources', exact: true }).click();
  await page.getByRole('button', { name: 'Channels · selected image source', exact: true }).click();
  await page.getByRole('combobox', { name: 'Inspect channel', exact: true }).click();
  await page.getByRole('option', { name: 'Red', exact: true }).click();
  await expect(
    page.getByRole('button', { name: 'Channel to selection', exact: true }),
  ).toBeEnabled();
  await page.getByRole('button', { name: 'Channel to selection', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Save selection', exact: true })).toBeEnabled();
  await page.getByRole('button', { name: 'Save selection', exact: true }).click();
  // Pixel-selection context mounts the same source panel afresh; view state is transient.
  await page.getByRole('button', { name: 'Channels · selected image source', exact: true }).click();
  await page.getByRole('button', { name: 'Restore composite', exact: true }).click();
  await page.getByRole('button', { name: 'Show original pixel detail', exact: true }).click();
  await expect(page.locator('canvas[aria-label="Original source pixel detail"]')).toHaveAttribute(
    'width',
    '128',
  );
  await page.screenshot({ path: path.join(review, '05-channel-selection.png') });
  const historyWarnings: string[] = [];
  page.on('console', (message) => {
    if (message.text().includes('updateDoc called outside transaction'))
      historyWarnings.push(message.text());
  });
  await page.getByRole('button', { name: 'Create mask from selection', exact: true }).click();
  await page.getByRole('button', { name: 'Mask', exact: true }).click();
  await expect(page.getByRole('button', { name: 'Remove mask', exact: true })).toBeVisible();
  expect(historyWarnings).toEqual([]);
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('button', { name: 'Remove mask', exact: true })).toHaveCount(0);
  await expect(page.getByRole('treeitem', { name: /tonal-reference/ })).toBeVisible();
});

test('editing sharpening has real domain controls, camera-independent detail and offline reopen', async ({
  page,
  context,
}) => {
  await navigateTonalEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.keyboard.press('Shift+1');
  await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
  await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
  await add(page, 'Sharpen');
  await number(page, 'Sharpen amount value (%)', '80');
  await number(page, 'Sharpen radius value (units)', '3.5');
  await number(page, 'Detail vertical position (%)', '86');
  await observeDetailLatency(page);
  await page.getByRole('button', { name: 'Compare document-pixel detail', exact: true }).click();
  const output = page.locator('canvas[aria-label="Sharpen detail output"]');
  await expect(output).toHaveAttribute('width', '128');
  const signature = () =>
    page.evaluate(() => {
      const canvases = ['Sharpen detail input', 'Sharpen detail output'].map(
        (label) => document.querySelector(`canvas[aria-label="${label}"]`) as HTMLCanvasElement,
      );
      return canvases.map((canvas) =>
        Array.from(
          canvas.getContext('2d')!.getImageData(0, 0, canvas.width, canvas.height).data,
        ).reduce((hash, value) => Math.imul(hash ^ value, 16777619), 2166136261),
      );
    });
  const hashes = await signature();
  expect(hashes[0]).not.toEqual(hashes[1]);
  await expect.poll(async () => (await detailLatencies(page)).length).toBe(1);
  // Request another region, then return to the original cached upstream
  // source. The selected filter is still evaluated for the warm comparison.
  await number(page, 'Detail horizontal position (%)', '51');
  await page.getByRole('button', { name: 'Compare document-pixel detail', exact: true }).click();
  await expect.poll(async () => (await detailLatencies(page)).length).toBe(2);
  await number(page, 'Detail horizontal position (%)', '50');
  await page.getByRole('button', { name: 'Compare document-pixel detail', exact: true }).click();
  await expect.poll(async () => (await detailLatencies(page)).length).toBe(3);
  const durations = await detailLatencies(page);
  expect(durations.every((duration) => Number.isFinite(duration) && duration >= 0)).toBe(true);
  expect(await signature()).toEqual(hashes);
  writeFileSync(
    path.join(review, 'detail-latency.json'),
    JSON.stringify(
      {
        fixture: '512x384 tonal-reference; Sharpen 80%, radius 3.5, linear sRGB',
        region: '128x128 document pixels with canonical spatial halo',
        measurement: 'captured UI click to completed output canvas upload; app already loaded',
        coldRegionMs: durations[0],
        differentColdRegionMs: durations[1],
        cachedSourceRegionMs: durations[2],
        limits:
          'Three requests on one shared Linux host; no p95, cold app, peak RSS or device claim',
      },
      null,
      2,
    ) + '\n',
  );
  await page.keyboard.press('Shift+2');
  expect(await signature()).toEqual(hashes);
  await output.scrollIntoViewIfNeeded();
  await page.screenshot({ path: path.join(review, '06-sharpen-detail-light.png') });
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved');
  await page.reload();
  const card = page.getByRole('gridcell').first();
  await card.waitFor({ timeout: 30000 });
  await card.dblclick();
  await expect(page.getByRole('treeitem')).toHaveCount(2);
  // The reopened application has empty module-level effect/sample caches.
  // Disable network after loading its application modules and source assets.
  await page
    .getByRole('treeitem', { name: /Adjustment Layer/ })
    .first()
    .click();
  await page.getByRole('button', { name: 'Sharpen', exact: true }).first().click();
  await expect(
    page.getByRole('spinbutton', { name: 'Sharpen radius value (units)', exact: true }),
  ).toHaveValue('3.5');
  await context.setOffline(true);
  await number(page, 'Detail vertical position (%)', '86');
  await page.getByRole('button', { name: 'Compare document-pixel detail', exact: true }).click();
  await expect(output).toHaveAttribute('width', '128');
  expect(await signature()).toEqual(hashes);
  await context.setOffline(false);
});

test.describe('curve pointer and visual detail', () => {
  test.use({
    viewport: { width: 1024, height: 900 },
    deviceScaleFactor: 2,
    hasTouch: true,
  });
  test('drag crossing, Escape cancellation, touch alternatives and theme states', async ({
    page,
  }) => {
    await navigateTonalEditor(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/tonal-reference.png'));
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await page.getByRole('menuitem', { name: 'Object', exact: true }).click();
    await page.getByRole('menuitem', { name: /new adjustment layer/i }).click();
    await add(page, 'Curves');
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
    await number(page, 'Curve input', '100');
    await number(page, 'Curve output', '100');
    await page.getByRole('button', { name: 'Add point', exact: true }).click();
    await number(page, 'Curve input', '140');
    await number(page, 'Curve output', '180');
    const graph = page.getByRole('img', { name: /Curve editor/ });
    await graph.scrollIntoViewIfNeeded();
    const point = page.getByRole('button', { name: 'Curve point 3', exact: true });
    const left = await page
      .getByRole('button', { name: 'Curve point 1', exact: true })
      .boundingBox();
    const right = await page
      .getByRole('button', { name: 'Curve point 2', exact: true })
      .boundingBox();
    const box = await point.boundingBox();
    const dx = ((right!.x - left!.x) * 80) / 255;
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + dx, box!.y + box!.height / 2, { steps: 12 });
    await page.mouse.up();
    expect(
      Number(await page.getByRole('spinbutton', { name: 'Curve input', exact: true }).inputValue()),
    ).toBeCloseTo(180, 0);
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('spinbutton', { name: 'Curve input', exact: true })).toHaveValue(
      '100',
    );
    await page.mouse.move(box!.x + box!.width / 2, box!.y + box!.height / 2);
    await page.mouse.down();
    await page.mouse.move(box!.x + box!.width / 2 + dx / 2, box!.y + box!.height / 2, { steps: 6 });
    await page.keyboard.press('Escape');
    await page.mouse.up();
    await expect(page.getByRole('spinbutton', { name: 'Curve input', exact: true })).toHaveValue(
      '100',
    );
    const addBox = await page.getByRole('button', { name: 'Add point', exact: true }).boundingBox();
    await page.touchscreen.tap(addBox!.x + addBox!.width / 2, addBox!.y + addBox!.height / 2);
    await expect(page.getByRole('button', { name: 'Curve point 5', exact: true })).toBeAttached();
    for (const theme of ['dark', 'high-contrast']) {
      await page.evaluate((value) => {
        document.documentElement.dataset.theme = value;
      }, theme);
      await graph.scrollIntoViewIfNeeded();
      await page.screenshot({ path: path.join(review, `07-curves-${theme}-dpr2.png`) });
      const graphBox = await graph.boundingBox();
      const inspector = await page
        .getByRole('region', { name: 'Inspector', exact: true })
        .boundingBox();
      expect(graphBox!.width).toBeLessThanOrEqual(inspector!.width);
    }
    await page.getByRole('combobox', { name: 'Curve preset', exact: true }).click();
    await page.getByRole('option', { name: 'Soft contrast', exact: true }).click();
    await expect(page.getByRole('button', { name: /^Curve point \d+$/ })).toHaveCount(4);
    await page.getByRole('button', { name: 'Curve point 1', exact: true }).focus();
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('button', { name: /^Curve point \d+$/ })).toHaveCount(5);
  });
});
