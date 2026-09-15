import { writeFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(path.resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    sync: {
      read(input: Buffer): { width: number; height: number; data: Buffer };
    };
  };
};

type SubjectDocumentFiber = {
  memoizedProps?: { value?: unknown };
  child?: SubjectDocumentFiber | null;
  sibling?: SubjectDocumentFiber | null;
};

type SubjectSerializedDocument = {
  nodes?: Record<string, { mask?: { rasterMask?: { assetId?: string } } }>;
  rasterMaskAssets?: Record<string, { dataUrl?: string; width?: number; height?: number }>;
};

type PortraitMaskReport = {
  width: number;
  height: number;
  hardPixels: number;
  componentCount: number;
  personInteriorHardPixels: number;
  backgroundHardPixels: number;
};

const HARD_MASK_THRESHOLD = 127;

async function serializeEditorDocument(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('Missing editor root');
    const property = Object.keys(root).find(
      (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
    );
    if (!property) throw new Error('Missing editor React container');
    const findEditor = (
      fiber: SubjectDocumentFiber | null | undefined,
    ): Record<string, unknown> | null => {
      if (!fiber) return null;
      const value = fiber.memoizedProps?.value;
      if (value && typeof value === 'object' && 'serializeDocument' in value) {
        const editor = value as Record<string, unknown>;
        if (typeof editor.serializeDocument === 'function') return editor;
      }
      return findEditor(fiber.child) ?? findEditor(fiber.sibling);
    };
    const editor = findEditor(
      (root as unknown as Record<string, unknown>)[property] as SubjectDocumentFiber,
    );
    if (!editor || typeof editor.serializeDocument !== 'function') {
      throw new Error('Missing editor serialization method');
    }
    return String(editor.serializeDocument());
  });
}

function countHardPixelsInRect(
  data: Buffer,
  width: number,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  let count = 0;
  for (let y = Math.max(0, Math.floor(rect.minY)); y <= rect.maxY; y += 1) {
    for (let x = Math.max(0, Math.floor(rect.minX)); x <= rect.maxX; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > HARD_MASK_THRESHOLD) count += 1;
    }
  }
  return count;
}

function countHardComponents(data: Buffer, width: number, height: number): number {
  const visited = new Uint8Array(width * height);
  const queue = new Int32Array(width * height);
  let components = 0;
  for (let start = 0; start < visited.length; start += 1) {
    if (visited[start] !== 0 || (data[start * 4 + 3] ?? 0) <= HARD_MASK_THRESHOLD) continue;
    components += 1;
    let head = 0;
    let tail = 0;
    queue[tail++] = start;
    visited[start] = 1;
    while (head < tail) {
      const current = queue[head++]!;
      const x = current % width;
      const y = Math.floor(current / width);
      for (const [dx, dy] of [
        [-1, 0],
        [1, 0],
        [0, -1],
        [0, 1],
      ] as const) {
        const nextX = x + dx;
        const nextY = y + dy;
        if (nextX < 0 || nextY < 0 || nextX >= width || nextY >= height) continue;
        const next = nextY * width + nextX;
        if (visited[next] !== 0 || (data[next * 4 + 3] ?? 0) <= HARD_MASK_THRESHOLD) continue;
        visited[next] = 1;
        queue[tail++] = next;
      }
    }
  }
  return components;
}

function inspectPortraitMask(serialized: string): PortraitMaskReport {
  const document = JSON.parse(serialized) as SubjectSerializedDocument;
  const node = Object.values(document.nodes ?? {}).find((candidate) => candidate.mask?.rasterMask);
  const assetId = node?.mask?.rasterMask?.assetId;
  const asset = assetId ? document.rasterMaskAssets?.[assetId] : undefined;
  if (!asset?.dataUrl || !asset.width || !asset.height) {
    throw new Error('The portrait mask was not persisted');
  }
  const payload = asset.dataUrl.split(',')[1];
  if (!payload) throw new Error('The portrait mask is not a data URL');
  const png = PNG.sync.read(Buffer.from(payload, 'base64'));
  let hardPixels = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if ((png.data[index] ?? 0) > HARD_MASK_THRESHOLD) hardPixels += 1;
  }
  return {
    width: png.width,
    height: png.height,
    hardPixels,
    componentCount: countHardComponents(png.data, png.width, png.height),
    // Ground-truth review windows for real-life-katharine-hepburn.jpg: the
    // face/hair interior must be selected, while the clear upper background
    // must remain untouched. These windows deliberately avoid the soft hair
    // boundary and the frame edges.
    personInteriorHardPixels: countHardPixelsInRect(png.data, png.width, {
      minX: 430,
      minY: 420,
      maxX: 850,
      maxY: 980,
    }),
    backgroundHardPixels: countHardPixelsInRect(png.data, png.width, {
      minX: 560,
      minY: 20,
      maxX: 720,
      maxY: 90,
    }),
  };
}

/**
 * Real-photo coverage for the model-backed automatic subject estimate.
 *
 * The bundled U2-Net Light and optional MODNet models run through the real
 * worker/WASM path, so these tests exercise automatic foreground proposals on
 * photographic content: a still life, a portrait with hair, and an interior
 * scene where a foreground estimate is expected to be weak. The specialist
 * portrait lane also decodes the persisted mask and checks target/background
 * review windows; screenshots are retained for visual inspection because a
 * synthetic fixture cannot establish cutout quality.
 */

async function importPhoto(page: import('@playwright/test').Page, fixture: string) {
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve(`tests/e2e/fixtures/${fixture}`));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 15000 });
}

async function resetPhotoGateStartup(page: import('@playwright/test').Page) {
  // A previous real-model or image-processing run can leave the shared app's
  // crash-loop markers behind. This only resets startup flags for this fresh
  // Playwright context; it does not touch documents, models, or the profile.
  await page.addInitScript(() => {
    localStorage.setItem('strata-clean-shutdown', 'true');
    localStorage.removeItem('varve:crash-loop');
    localStorage.removeItem('varve:safe-mode');
  });
}

async function openSelectionSources(page: import('@playwright/test').Page) {
  const inspector = page.locator('.editor__inspector-panel');
  // Selection Sources sits on the Properties tab (the default), not on the
  // Adjustments tab that hosts the promptable Object Selection section.
  const trigger = inspector.getByRole('button', { name: 'Selection Sources' });
  await expect(trigger).toBeVisible({ timeout: 15000 });
  await trigger.click();
  return inspector;
}

async function readCandidateCoverage(inspector: import('@playwright/test').Locator) {
  const buttons = inspector.locator('[aria-label$="percent"]');
  const count = await buttons.count();
  const labels: string[] = [];
  for (let index = 0; index < count; index += 1) {
    const label = await buttons.nth(index).getAttribute('aria-label');
    if (label) labels.push(label);
  }
  return labels;
}

test.describe('Automatic subject estimate on real photographs', () => {
  test('still life: Fast estimate previews, applies as selection, and applies as a mask', async ({
    page,
  }, testInfo) => {
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-still-life.jpg');
    const inspector = await openSelectionSources(page);

    await expect(
      inspector.getByRole('combobox', { name: 'Subject estimate quality' }),
    ).toBeVisible();
    await inspector.getByRole('button', { name: /^Select subject$/ }).click();

    const proposals = inspector.getByLabel('Subject proposals');
    await expect(proposals).toBeVisible({ timeout: 120000 });
    await expect(proposals.getByText(/U²-Net Light estimate/)).toBeVisible();

    const coverage = await readCandidateCoverage(inspector);
    expect(coverage.length).toBeGreaterThan(0);
    for (const label of coverage) {
      const match = /covers (\d+) percent/.exec(label);
      expect(match).not.toBeNull();
      const percent = Number(match![1]);
      expect(percent).toBeGreaterThan(0);
      expect(percent).toBeLessThan(100);
    }
    writeFileSync(testInfo.outputPath('subject-still-life-coverage.txt'), coverage.join('\n'));
    await testInfo.attach('subject-still-life-coverage', {
      body: coverage.join('\n'),
      contentType: 'text/plain',
    });

    const canvas = page.getByTestId('editor-canvas');
    const firstProposal = proposals.locator('button[aria-label$="percent"]').first();
    await firstProposal.click();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-still-life-unconfirmed-preview.png'),
    });
    await testInfo.attach('subject-still-life-unconfirmed-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeEnabled();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-still-life-preview.png'),
    });
    await testInfo.attach('subject-still-life-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    // Review the highlighted proposal before committing it. A proposal is not
    // an area selection until the user explicitly confirms this action.
    await inspector.getByRole('button', { name: 'Use selected candidate' }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /selected \(U²-Net Light estimate\)/i,
      { timeout: 10000 },
    );
    await expect(inspector.getByText('Refine selection')).toBeVisible({ timeout: 10000 });
    await expect(inspector.getByRole('button', { name: 'Save selection' })).toBeEnabled();

    // Re-review the same candidate before creating the separate persistent
    // mask output. The two commit paths must not share a hidden auto-apply.
    await inspector
      .getByLabel('Subject proposals')
      .locator('button[aria-label$="percent"]')
      .first()
      .click();
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();
    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await expect(
      page
        .getByText(/Selection applied as a mask|subject.*applied as a mask|applied as a mask/i)
        .first(),
    ).toBeVisible({ timeout: 10000 });
    await canvas.screenshot({
      path: testInfo.outputPath('subject-still-life-mask.png'),
    });
    await testInfo.attach('subject-still-life-mask', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });

  test('portrait with hair: Fast estimate produces a reviewable proposal and mask', async ({
    page,
  }, testInfo) => {
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-braided-portrait.jpg');
    const inspector = await openSelectionSources(page);

    await inspector.getByRole('button', { name: /^Select subject$/ }).click();
    const proposals = inspector.getByLabel('Subject proposals');
    await expect(proposals).toBeVisible({ timeout: 120000 });
    await expect(proposals.getByText(/U²-Net Light estimate/)).toBeVisible();
    await proposals.locator('button[aria-label$="percent"]').first().click();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeDisabled();
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();
    await expect(inspector.getByRole('button', { name: 'Apply as mask' })).toBeEnabled();

    const canvas = page.getByTestId('editor-canvas');
    // Frame the subject before capturing so the overlay and the applied mask
    // are judged at a useful zoom rather than a corner crop.
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-portrait-hair-preview.png'),
    });
    await testInfo.attach('subject-portrait-hair-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await page.waitForTimeout(500);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-portrait-hair-mask.png'),
    });
    await testInfo.attach('subject-portrait-hair-mask', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await expect(canvas).toBeVisible();
  });

  test('portrait specialist: MODNet selects the person and preserves background', async ({
    page,
  }, testInfo) => {
    test.setTimeout(180_000);
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-katharine-hepburn.jpg');
    const inspector = await openSelectionSources(page);

    const quality = inspector.getByRole('combobox', { name: 'Subject estimate quality' });
    await quality.click();
    await page.getByRole('option', { name: 'Portrait (MODNet)' }).click();
    await inspector.getByRole('button', { name: /^Select subject$/ }).click();

    const proposals = inspector.getByLabel('Subject proposals');
    await expect(proposals).toBeVisible({ timeout: 120_000 });
    await expect(proposals.getByText(/MODNet Portrait estimate/)).toBeVisible();
    await expect(proposals.getByText(/portrait-only matte/i)).toBeVisible();
    await expect(proposals.getByText(/Model-free estimate/i)).toHaveCount(0);

    const candidate = proposals.locator('button[aria-label$="percent"]').first();
    await candidate.click();
    await expect(
      inspector.getByRole('checkbox', {
        name: 'I reviewed the highlighted subject before applying',
      }),
    ).toBeEnabled();
    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted subject before applying' })
      .check();

    const canvas = page.getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({ path: testInfo.outputPath('subject-portrait-modnet-preview.png') });
    await testInfo.attach('subject-portrait-modnet-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /applied as a mask/i,
      { timeout: 10_000 },
    );
    await expect
      .poll(
        async () => {
          try {
            const report = inspectPortraitMask(await serializeEditorDocument(page));
            return report.hardPixels > 0;
          } catch {
            return false;
          }
        },
        { timeout: 10_000 },
      )
      .toBe(true);
    const maskReport = inspectPortraitMask(await serializeEditorDocument(page));
    writeFileSync(
      testInfo.outputPath('subject-portrait-modnet-mask-metrics.json'),
      JSON.stringify(maskReport, null, 2),
    );
    await testInfo.attach('subject-portrait-modnet-mask-metrics', {
      body: JSON.stringify(maskReport, null, 2),
      contentType: 'application/json',
    });
    expect(maskReport.width).toBe(1280);
    expect(maskReport.height).toBe(1696);
    expect(maskReport.personInteriorHardPixels).toBeGreaterThan(20_000);
    expect(maskReport.backgroundHardPixels).toBe(0);
    await canvas.screenshot({ path: testInfo.outputPath('subject-portrait-modnet-mask.png') });
    await testInfo.attach('subject-portrait-modnet-mask', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
  });

  test('interior scene: the estimate stays reviewable and honest about its limits', async ({
    page,
  }, testInfo) => {
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-interior-room.jpg');
    const inspector = await openSelectionSources(page);

    await inspector.getByRole('button', { name: /^Select subject$/ }).click();

    const proposals = inspector.getByLabel('Subject proposals');
    const failure = inspector.locator('.insp-selection-sources__error');
    await expect(proposals.or(failure)).toBeVisible({ timeout: 120000 });

    const canvas = page.getByTestId('editor-canvas');
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-interior-room-outcome.png'),
    });
    await testInfo.attach('subject-interior-room-outcome', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    if (await proposals.isVisible()) {
      // Honest copy is required whether the model ran or the model-free
      // fallback was used: the hint must never claim semantic recognition.
      await expect(
        proposals.getByText(/Review it before applying|model-free estimate/i),
      ).toBeVisible();
    } else {
      await expect(failure).toContainText(/subject|foreground/i);
    }
  });
});
