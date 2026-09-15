import { createRequire } from 'node:module';
import path from 'node:path';
import { test as base, chromium, expect } from '@playwright/test';

const requireFromEngine = createRequire(path.resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: {
    sync: {
      read(input: Buffer): {
        width: number;
        height: number;
        data: Buffer;
      };
    };
  };
};

type SerializedFiber = {
  memoizedProps?: { value?: unknown };
  child?: SerializedFiber | null;
  sibling?: SerializedFiber | null;
};

type SerializedDocument = {
  nodes?: Record<
    string,
    {
      kind?: string;
      mask?: { rasterMask?: { assetId?: string } };
    }
  >;
  rasterMaskAssets?: Record<string, { dataUrl?: string; width?: number; height?: number }>;
};

type MaskReport = {
  width: number;
  height: number;
  hardPixels: number;
  componentCount: number;
  appleHardPixels: number;
  mugHardPixels: number;
};

const HARD_MASK_THRESHOLD = 127;
const COMPONENT_NEIGHBOURS: ReadonlyArray<readonly [number, number]> = [
  [-1, -1],
  [0, -1],
  [1, -1],
  [-1, 0],
  [1, 0],
  [-1, 1],
  [0, 1],
  [1, 1],
];

async function serializeEditorDocument(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    const root = document.getElementById('root');
    if (!root) throw new Error('Missing editor root');
    const property = Object.keys(root).find(
      (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
    );
    if (!property) throw new Error('Missing editor React container');
    const findEditor = (
      fiber: SerializedFiber | null | undefined,
    ): Record<string, unknown> | null => {
      if (!fiber) return null;
      const value = fiber.memoizedProps?.value;
      if (value && typeof value === 'object' && 'serializeDocument' in value) {
        const candidate = value as Record<string, unknown>;
        if (typeof candidate.serializeDocument === 'function') return candidate;
      }
      return findEditor(fiber.child) ?? findEditor(fiber.sibling);
    };
    const editor = findEditor(
      (root as unknown as Record<string, unknown>)[property] as SerializedFiber,
    );
    if (!editor || typeof editor.serializeDocument !== 'function') {
      throw new Error('Missing editor serialization method');
    }
    return String(editor.serializeDocument());
  });
}

function maskPixelsInRect(
  data: Buffer,
  width: number,
  rect: { minX: number; minY: number; maxX: number; maxY: number },
): number {
  let count = 0;
  const minX = Math.max(0, Math.floor(rect.minX));
  const minY = Math.max(0, Math.floor(rect.minY));
  const maxX = Math.min(width - 1, Math.floor(rect.maxX));
  const maxY = Math.floor(rect.maxY);
  for (let y = minY; y <= maxY; y += 1) {
    for (let x = minX; x <= maxX; x += 1) {
      if ((data[(y * width + x) * 4 + 3] ?? 0) > HARD_MASK_THRESHOLD) count += 1;
    }
  }
  return count;
}

function countHardMaskComponents(data: Buffer, width: number, height: number): number {
  const pixels = width * height;
  const visited = new Uint8Array(pixels);
  const queue = new Int32Array(pixels);
  let components = 0;
  for (let start = 0; start < pixels; start += 1) {
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
      for (const [dx, dy] of COMPONENT_NEIGHBOURS) {
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

function inspectAcceptedMask(serialized: string): MaskReport {
  const document = JSON.parse(serialized) as SerializedDocument;
  const maskedNode = Object.values(document.nodes ?? {}).find(
    (node) => node.mask?.rasterMask?.assetId,
  );
  const assetId = maskedNode?.mask?.rasterMask?.assetId;
  const asset = assetId ? document.rasterMaskAssets?.[assetId] : undefined;
  if (!asset?.dataUrl || !asset.width || !asset.height) {
    throw new Error('The accepted object-selection mask was not persisted');
  }
  const payload = asset.dataUrl.split(',')[1];
  if (!payload) throw new Error('The accepted object-selection mask is not a data URL');
  const png = PNG.sync.read(Buffer.from(payload, 'base64'));
  let hardPixels = 0;
  for (let index = 3; index < png.data.length; index += 4) {
    if ((png.data[index] ?? 0) > HARD_MASK_THRESHOLD) hardPixels += 1;
  }
  return {
    width: png.width,
    height: png.height,
    hardPixels,
    componentCount: countHardMaskComponents(png.data, png.width, png.height),
    // Ground-truth review windows for the licensed still-life fixture: the
    // apple occupies the right edge; this interior window is the mug and must
    // stay outside a specific-apple selection.
    appleHardPixels: maskPixelsInRect(png.data, png.width, {
      minX: 1040,
      minY: 580,
      maxX: 1270,
      maxY: 940,
    }),
    mugHardPixels: maskPixelsInRect(png.data, png.width, {
      minX: 925,
      minY: 790,
      maxX: 995,
      maxY: 930,
    }),
  };
}

/**
 * Real-model Object Selection gate.
 *
 * This spec exercises the actual SAM2-Hiera-Tiny pipeline end to end:
 * click -> prompt -> encoder + decoder inference -> preview -> candidate
 * cycling -> Apply as mask (one undoable document operation) -> undo/redo.
 *
 * Requirements (see docs/quality/object-selection-parity.md):
 * - Set VARVE_SAM2_REAL_MODEL=1 to enable.
 * - The repaired encoder + decoder must be served at /models/ (install them
 *   via Settings > Offline Models, or place the repaired files in the web root's
 *   models directory).
 * - The app must run on a server that sends COOP/COEP headers
 *   (crossOriginIsolated) OR a browser that reports navigator.deviceMemory;
 *   otherwise the conservative wasm memory gate blocks the encoder.
 * - A persistent profile is used so the app bundle is served from the disk
 *   cache and navigation stays within the shared helper's goto budget.
 */
const PROFILE_DIR = process.env.VARVE_SAM2_PROFILE_DIR ?? 'test-results/profile-sam2-real';
const BASE_URL =
  process.env.VARVE_SAM2_BASE_URL ?? `http://localhost:${process.env.VARVE_E2E_PORT ?? '1420'}`;

const test = base.extend({
  page: async ({ browser }, use) => {
    void browser;
    const ctx = await chromium.launchPersistentContext(PROFILE_DIR, {
      headless: true,
      channel: 'chromium',
      viewport: { width: 1440, height: 900 },
      args: [],
    });
    const page = ctx.pages()[0] ?? (await ctx.newPage());
    await use(page);
    await page.evaluate(() => localStorage.setItem('strata-clean-shutdown', 'true'));
    await ctx.close();
  },
});

async function navigateToEditorSlow(page: import('@playwright/test').Page) {
  await page.goto(BASE_URL, { timeout: 600000, waitUntil: 'domcontentloaded' });
  const recovery = page.locator('dialog[open]').filter({
    hasText: /closed unexpectedly|recover unsaved|recover your documents/i,
  });
  if (
    await recovery
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await recovery
      .getByRole('button', { name: /close|dismiss|got it|not now/i })
      .first()
      .click();
  }
  await page.getByRole('button', { name: /^new$/i }).waitFor({ timeout: 600000 });
  await page.getByRole('button', { name: /^new$/i }).click();
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .waitFor({ timeout: 300000 });
  await page
    .locator('dialog')
    .getByRole('button', { name: /create/i })
    .click();
  await page.locator('.layers-panel').waitFor({ timeout: 900000 });
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 3000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test.describe('Object Selection real-model gate', () => {
  test.skip(
    !process.env.VARVE_SAM2_REAL_MODEL,
    'Set VARVE_SAM2_REAL_MODEL=1 (model files + COOP/COEP server required)',
  );

  test('clicks an object, gets a real mask preview, applies it, and survives undo/redo', async ({
    page,
  }, testInfo) => {
    test.setTimeout(1_200_000);
    await navigateToEditorSlow(page);
    // Use the verified portrait fixture: cat.jpg is mislabelled in the legacy
    // background-removal corpus and is actually a coastal landscape, so its
    // centre point prompts sky/sea rather than an object.
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/fixtures/bg-removal-corpus/human.jpg'));
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120000 });
    // Import selects the new image in a clean profile, but a restored session
    // may open without it; select the layer explicitly so the image-specific
    // Inspector tabs are deterministic.
    await page.getByRole('treeitem').first().click();

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    const modelPreference = inspector.getByRole('combobox', {
      name: 'Object Selection model preference',
    });
    await modelPreference.click();
    await page.getByRole('option', { name: /Higher detail — SAM2 Tiny/i }).click();
    const installModel = inspector.getByRole('button', {
      name: /Install higher-detail Object Selection model|Retry Higher-detail local model/i,
    });
    if (await installModel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await installModel.click();
      await expect(inspector.getByText(/Object Selection model ready/i)).toBeVisible({
        timeout: 900000,
      });
    }
    await inspector.getByRole('button', { name: 'Select Object' }).click();
    await expect(
      page.getByTestId('toolbar').getByRole('button', { name: 'Object Selection' }),
    ).toHaveAttribute('aria-pressed', 'true');

    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();
    // Use an off-centre point on the person's torso. This exercises the
    // non-square source mapping and the decoder's removal of model padding;
    // a centre click can pass while a vertically displaced mask is wrong.
    const promptX = bounds!.x + bounds!.width * 0.5;
    const promptY = bounds!.y + bounds!.height * 0.6;

    // Session 1: cold path (model load + image encode + decoder).
    const t0 = Date.now();
    await page.mouse.click(promptX, promptY);
    const status = inspector.getByText(/Preview ready/).first();
    await status.waitFor({ timeout: 600000 });
    const statusText = (await status.textContent()) ?? '';
    console.log(
      'COLD PREVIEW:',
      statusText,
      '| latency:',
      `${Math.round((Date.now() - t0) / 1000)}s`,
    );
    expect(statusText).toMatch(
      /Preview ready · predicted IoU score [\d.]+ · prompt match 100% · \d+ candidate masks?/i,
    );
    expect(statusText).not.toMatch(/0 candidate mask/);
    await testInfo.attach('real-model-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('real-model-preview.png') });

    // Candidate cycling wraps. Return to the initial candidate before Apply;
    // a later candidate may intentionally be a lower-confidence alternative.
    const nextBtn = inspector.getByRole('button', { name: 'Next object-selection candidate' });
    if (await nextBtn.count().then((n) => n > 0)) {
      const before = (await inspector.getByText(/Candidate \d+ of \d+/).textContent()) ?? '';
      const total = Number(before.match(/of (\d+)/)?.[1] ?? 0);
      expect(total).toBeGreaterThan(1);
      for (let index = 0; index < total; index += 1) {
        await nextBtn.click();
      }
      await page.waitForTimeout(1000);
      const after = (await inspector.getByText(/Candidate \d+ of \d+/).textContent()) ?? '';
      expect(after).toBe(before);
      console.log('CANDIDATE CYCLE:', before, '->', after, '(wrapped)');
    }

    // Candidate cycling invalidates review. Confirm the exact visible target
    // before applying so this gate exercises the same safety contract as a user.
    const targetReview = inspector.getByRole('checkbox', {
      name: 'I reviewed the highlighted target before applying',
    });
    await expect(targetReview).toBeVisible();
    await targetReview.check();

    // Apply as mask -> one undoable document operation; the apply path reveals
    // the Background Removal disclosure so provenance is immediately visible.
    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    const backgroundRemovalToggle = inspector.getByRole('button', {
      name: 'Background Removal',
      exact: true,
    });
    await expect(backgroundRemovalToggle).toHaveAttribute('aria-expanded', 'true');
    const appliedScore = inspector
      .getByText(/(?:predicted IoU score [\d.]+|mask score \d+%|score [\d.]+)/i)
      .first();
    await expect(appliedScore).toBeVisible({ timeout: 120000 });
    console.log('APPLIED PROVENANCE:', await appliedScore.textContent());
    await testInfo.attach('real-model-applied', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('real-model-applied.png') });

    // Undo removes the committed mask; redo restores it.
    await page.keyboard.press('Control+KeyZ');
    await expect(appliedScore).toBeHidden({ timeout: 60000 });
    await page.keyboard.press('Control+Shift+KeyZ');
    // Undo/redo restores the document snapshot and may return the Inspector
    // to its Design tab; return to the adjustment surface before reviewing
    // the restored mask provenance.
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await expect(
      inspector.getByText(/(?:predicted IoU score [\d.]+|mask score \d+%|score [\d.]+)/i).first(),
    ).toBeVisible({ timeout: 60000 });
    console.log('UNDO/REDO OK');

    // Session 2: same image, warm embedding cache — the encoder must be
    // reused (prompt-only latency, well under the cold path).
    await inspector.getByRole('button', { name: 'Select Object' }).click();
    const t1 = Date.now();
    await page.mouse.click(promptX, promptY);
    const warm = inspector.getByText(/Preview ready/).first();
    await warm.waitFor({ timeout: 120000 });
    const warmText = (await warm.textContent()) ?? '';
    const warmLatency = Date.now() - t1;
    console.log('WARM PREVIEW:', warmText, '| latency:', `${Math.round(warmLatency / 1000)}s`);
    expect(warmLatency).toBeLessThan(60000);
    await expect(targetReview).toBeVisible();
    await targetReview.check();

    // Use as selection must commit the reviewed candidate without another
    // encode/decode: the announcement exposes the score provenance and the
    // selection is immediately available to save.
    const selectionStart = Date.now();
    await inspector.getByRole('button', { name: 'Use as selection' }).click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toContainText(
      /Selected subject \((?:predicted IoU score [\d.]+|model score \d+%|score [\d.]+)\)/i,
      { timeout: 60000 },
    );
    const selectionLatency = Date.now() - selectionStart;
    console.log('USE AS SELECTION latency:', `${Math.round(selectionLatency / 1000)}s`);
    expect(selectionLatency).toBeLessThan(10000);
    // The Selection Sources panel lives on the Design (properties) tab; open
    // it and confirm the reviewed candidate became a saveable area selection.
    await inspector.getByRole('tab', { name: 'Design' }).click();
    const sourcesToggle = inspector.getByRole('button', { name: 'Selection Sources' });
    if ((await sourcesToggle.getAttribute('aria-expanded')) !== 'true') {
      await sourcesToggle.click();
    }
    await expect(inspector.getByRole('button', { name: 'Save selection' })).toBeEnabled();
    await testInfo.attach('real-model-selection', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });
    await canvas.screenshot({ path: testInfo.outputPath('real-model-selection.png') });
  });

  test('keeps a prompted apple separate from other objects in a real still life', async ({
    page,
  }, testInfo) => {
    test.setTimeout(1_200_000);
    await navigateToEditorSlow(page);
    await page
      .locator('#file-import-input')
      .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-still-life.jpg'));
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 120000 });
    await page.getByRole('treeitem').first().click();

    const inspector = page.locator('.editor__inspector-panel');
    await inspector.getByRole('tab', { name: 'Adjustments' }).click();
    await inspector.getByRole('button', { name: 'Object Selection' }).click();
    const modelPreference = inspector.getByRole('combobox', {
      name: 'Object Selection model preference',
    });
    await modelPreference.click();
    await page.getByRole('option', { name: /Higher detail — SAM2 Tiny/i }).click();
    const installModel = inspector.getByRole('button', {
      name: /Install higher-detail Object Selection model|Retry Higher-detail local model/i,
    });
    if (await installModel.isVisible({ timeout: 3000 }).catch(() => false)) {
      await installModel.click();
      await expect(inspector.getByText(/Object Selection model ready/i)).toBeVisible({
        timeout: 900000,
      });
    }
    await inspector.getByRole('button', { name: 'Select Object' }).click();
    await page.getByRole('button', { name: 'Fit sel' }).click();
    await page.waitForTimeout(400);
    const canvas = page.getByTestId('editor-canvas');
    const bounds = await canvas.boundingBox();
    expect(bounds).not.toBeNull();

    // The source is 1280×960. The apple is the right-hand object; the point
    // is deliberately well inside its body, away from the handle, flowers,
    // and the dark background. The screenshot is the visual target evidence.
    const applePoint = {
      x: bounds!.x + bounds!.width * 0.86,
      y: bounds!.y + bounds!.height * 0.72,
    };
    await page.mouse.click(applePoint.x, applePoint.y);
    const preview = inspector.getByText(/Preview ready/).first();
    await preview.waitFor({ timeout: 600000 });
    const previewText = (await preview.textContent()) ?? '';
    expect(previewText).toMatch(
      /Preview ready · predicted IoU score [\d.]+ · prompt match 100% · \d+ candidate masks?/i,
    );
    await canvas.screenshot({ path: testInfo.outputPath('real-still-life-apple-preview.png') });
    const targetEvidence = inspector.getByText(/target evidence \d+% anchored/i).first();
    await expect(targetEvidence).toBeVisible();
    const targetEvidenceText = (await targetEvidence.textContent()) ?? '';
    expect(targetEvidenceText).toMatch(/target evidence 100% anchored/i);
    await testInfo.attach('real-still-life-apple-preview', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    await inspector
      .getByRole('checkbox', { name: 'I reviewed the highlighted target before applying' })
      .check();
    await inspector.getByRole('button', { name: 'Apply as mask' }).click();
    await expect(
      inspector.getByRole('button', { name: 'Background Removal', exact: true }),
    ).toHaveAttribute('aria-expanded', 'true');
    await expect(inspector.getByText(/(?:predicted IoU score|mask score)/i).first()).toBeVisible({
      timeout: 120000,
    });
    await canvas.screenshot({ path: testInfo.outputPath('real-still-life-apple-applied.png') });
    await testInfo.attach('real-still-life-apple-applied', {
      body: await canvas.screenshot(),
      contentType: 'image/png',
    });

    // Inspect the persisted source-resolution mask, not only the rendered
    // screenshot or the diagnostic label. A successful specific-object
    // selection must contain one hard connected region, retain apple pixels,
    // and exclude the independently visible mug interior. This catches a
    // regression where the preview was correct but Apply wrote a raw model
    // candidate containing an unrelated disconnected island.
    const maskReport = inspectAcceptedMask(await serializeEditorDocument(page));
    expect(maskReport.width).toBe(1280);
    expect(maskReport.height).toBe(960);
    expect(maskReport.hardPixels).toBeGreaterThan(0);
    expect(maskReport.componentCount).toBe(1);
    expect(maskReport.appleHardPixels).toBeGreaterThan(0);
    expect(maskReport.mugHardPixels).toBe(0);
  });
});
