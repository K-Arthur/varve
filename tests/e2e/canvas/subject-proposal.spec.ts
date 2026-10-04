import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
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
  foregroundCoreHardPixels: number;
  clearBackgroundHardPixels: number;
};

const HARD_MASK_THRESHOLD = 127;
const MODNET_MODEL_ID = 'modnet-portrait';
const SYNTHETIC_MODNET_BYTES = Buffer.from([1]);
const SYNTHETIC_MODNET_SHA256 = createHash('sha256').update(SYNTHETIC_MODNET_BYTES).digest('hex');
const SYNTHETIC_MODNET_PATH = '/__e2e__/modnet-portrait.onnx';

async function installSyntheticModnetRoutes(context: import('@playwright/test').BrowserContext) {
  const manifest = JSON.parse(
    readFileSync(path.resolve('apps/desktop/public/models/manifest.json'), 'utf8'),
  ) as {
    models: Array<{ id: string; sha256: string | null; remoteUrl: string }>;
  };
  const model = manifest.models.find((entry) => entry.id === MODNET_MODEL_ID);
  expect(model, 'The production manifest must still declare optional MODNet').toBeDefined();
  model!.sha256 = SYNTHETIC_MODNET_SHA256;
  model!.remoteUrl = SYNTHETIC_MODNET_PATH;

  await context.route('**/models/manifest.json', async (route) => {
    await route.fulfill({ status: 200, contentType: 'application/json', json: manifest });
  });
  await context.route(`**${SYNTHETIC_MODNET_PATH}`, async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'application/octet-stream',
      headers: { 'content-length': String(SYNTHETIC_MODNET_BYTES.length) },
      body: SYNTHETIC_MODNET_BYTES,
    });
  });
}

function installModnetWorkerStub() {
  const modelId = 'modnet-portrait';
  type InferMessage = {
    type?: string;
    requestId?: string;
    modelId?: string;
    method?: string;
    imageData?: { width: number; height: number };
    requestRevision?: number;
  };
  type ModnetWindow = Window & {
    __varveModnetWorkerMessages: Array<{ phase: string; modelId: string }>;
  };
  const testWindow = window as unknown as ModnetWindow;
  testWindow.__varveModnetWorkerMessages = [];
  const NativeWorker = window.Worker;

  class ModnetWorkerStub {
    private readonly messageListeners: Array<(event: MessageEvent) => void> = [];

    addEventListener(type: string, listener: EventListenerOrEventListenerObject) {
      if (type !== 'message' || typeof listener !== 'function') return;
      this.messageListeners.push(listener as (event: MessageEvent) => void);
    }

    removeEventListener() {}

    postMessage(message: InferMessage) {
      if (message.type !== 'infer' || message.modelId !== modelId) return;
      const width = message.imageData?.width ?? 0;
      const height = message.imageData?.height ?? 0;
      if (width <= 0 || height <= 0 || !message.requestId) return;
      testWindow.__varveModnetWorkerMessages.push({ phase: 'request', modelId: message.modelId });

      // Deterministic integration mask: a centered foreground ellipse with a
      // clear top-background region. The separately maintained model-quality
      // evidence must use a provisioned real artifact, never this fixture.
      const rawMask = new Uint8Array(width * height);
      const centerX = width * 0.5;
      const centerY = height * 0.48;
      const radiusX = width * 0.25;
      const radiusY = height * 0.4;
      for (let y = 0; y < height; y += 1) {
        for (let x = 0; x < width; x += 1) {
          const dx = (x - centerX) / radiusX;
          const dy = (y - centerY) / radiusY;
          if (dx * dx + dy * dy <= 1) rawMask[y * width + x] = 255;
        }
      }

      testWindow.__varveModnetWorkerMessages.push({ phase: 'response', modelId: message.modelId });
      queueMicrotask(() => {
        for (const listener of this.messageListeners) {
          listener({
            data: {
              type: 'result',
              requestId: message.requestId,
              result: {
                method: 'portrait',
                modelId,
                executionProvider: 'wasm',
                processingTimeMs: 1,
                width,
                height,
                rawMask,
                requestRevision: message.requestRevision,
              },
            },
          } as MessageEvent);
        }
      });
    }

    terminate() {}
  }

  Object.defineProperty(window, 'Worker', {
    configurable: true,
    value: new Proxy(NativeWorker, {
      construct(target, args) {
        if (String(args[0]).includes('backgroundRemoval/worker')) {
          return new ModnetWorkerStub();
        }
        return Reflect.construct(target, args);
      },
    }),
  });
}

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
    // Deterministic integration-mask windows: the center must be selected,
    // while the clear upper background remains untouched.
    foregroundCoreHardPixels: countHardPixelsInRect(png.data, png.width, {
      minX: 430,
      minY: 420,
      maxX: 850,
      maxY: 980,
    }),
    clearBackgroundHardPixels: countHardPixelsInRect(png.data, png.width, {
      minX: 560,
      minY: 20,
      maxX: 720,
      maxY: 90,
    }),
  };
}

/**
 * Automatic subject estimate workflows on photographic content.
 *
 * Fast estimates exercise the real bundled U²-Net Light model. The MODNet
 * specialist case uses a deterministic optional-model artifact and Worker
 * stub to verify the install, provider, review, and document-commit workflow
 * without downloading a large model in generic CI. This mock does not measure
 * portrait segmentation quality.
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

  test('portrait specialist: MODNet install and proposal workflow stays reviewable', async ({
    page,
    context,
  }, testInfo) => {
    test.setTimeout(180_000);
    await installSyntheticModnetRoutes(context);
    await page.addInitScript(installModnetWorkerStub);
    await resetPhotoGateStartup(page);
    await navigateToEditor(page, '/', { startupTimeout: 180000 });
    await importPhoto(page, 'real-life-katharine-hepburn.jpg');
    const inspector = await openSelectionSources(page);

    const quality = inspector.getByRole('combobox', { name: 'Subject estimate quality' });
    await quality.click();
    await page.getByRole('option', { name: 'Portrait (MODNet)' }).click();
    await inspector.getByRole('button', { name: /^Select subject$/ }).click();

    const proposals = inspector.getByLabel('Subject proposals');
    const install = inspector
      .getByRole('region', { name: 'Optional subject model' })
      .getByRole('button', { name: /^Download MODNet Portrait$/ });
    await expect(proposals.or(install)).toBeVisible({ timeout: 120_000 });
    await expect(install).toBeVisible();
    await install.click();
    await expect(proposals).toBeVisible({ timeout: 120_000 });
    await expect(proposals.getByText(/MODNet Portrait estimate/)).toBeVisible();
    await expect(proposals.getByText(/portrait-only matte/i)).toBeVisible();
    await expect(proposals.getByText(/Model-free estimate/i)).toHaveCount(0);
    await expect
      .poll(() =>
        page.evaluate(() =>
          (
            window as unknown as { __varveModnetWorkerMessages?: Array<{ phase: string }> }
          ).__varveModnetWorkerMessages?.some((message) => message.phase === 'response'),
        ),
      )
      .toBe(true);

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
    await canvas.screenshot({
      path: testInfo.outputPath('subject-portrait-modnet-integration-preview.png'),
    });
    await testInfo.attach('subject-portrait-modnet-integration-preview', {
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
      testInfo.outputPath('subject-portrait-modnet-integration-mask-metrics.json'),
      JSON.stringify(maskReport, null, 2),
    );
    await testInfo.attach('subject-portrait-modnet-integration-mask-metrics', {
      body: JSON.stringify(maskReport, null, 2),
      contentType: 'application/json',
    });
    expect(maskReport.width).toBe(1280);
    expect(maskReport.height).toBe(1696);
    expect(maskReport.foregroundCoreHardPixels).toBeGreaterThan(20_000);
    expect(maskReport.clearBackgroundHardPixels).toBe(0);
    await canvas.screenshot({
      path: testInfo.outputPath('subject-portrait-modnet-integration-mask.png'),
    });
    await testInfo.attach('subject-portrait-modnet-integration-mask', {
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
