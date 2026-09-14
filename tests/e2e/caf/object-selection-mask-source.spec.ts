import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * This is a workflow-wiring test, not model-quality evidence. It seeds the
 * same transient ready-candidate shape produced by the real Object Selection
 * provider, then drives the actual CAF dialog and mask canvas. The real-model
 * qualification lane remains responsible for SAM2 quality.
 */
async function seedReadyObjectSelectionAndOpenCaf(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(async () => {
    const root = document.querySelector('#root > *') as any;
    if (!root) throw new Error('editor root not found');
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber not found');
    const seen = new Set<any>();
    let dispatch: ((updater: (previous: any) => any) => void) | undefined;
    let imageSource = '';
    let imageNodeId = '';
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || dispatch) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const current = hook.queue.lastRenderedState;
          if (current?.document?.nodes) {
            const imageNode = Object.values(current.document.nodes).find(
              (node: any) =>
                node?.kind === 'shape' && node.fills?.some((fill: any) => fill.type === 'image'),
            ) as
              | {
                  id: string;
                  fills?: Array<{ type?: string; image?: { src?: string | null } }>;
                }
              | undefined;
            if (imageNode) {
              const imageFill = imageNode.fills?.find((fill) => fill.type === 'image');
              imageSource = imageFill?.image?.src ?? '';
              imageNodeId = imageNode.id;
              dispatch = hook.queue.dispatch;
            }
          }
        }
        hook = hook.next;
      }
      walk(fiber.child);
      walk(fiber.sibling);
    })(root[fiberKey]);
    if (!dispatch || !imageSource || !imageNodeId) throw new Error('image state was not found');

    const image = new Image();
    const loaded = new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('image source could not be decoded'));
    });
    image.src = imageSource;
    await loaded;
    const width = image.naturalWidth;
    const height = image.naturalHeight;
    const canvas = document.createElement('canvas');
    canvas.width = width;
    canvas.height = height;
    const context = canvas.getContext('2d', { willReadFrequently: true });
    if (!context || width <= 0 || height <= 0) throw new Error('image dimensions unavailable');
    context.drawImage(image, 0, 0, width, height);
    const pixels = context.getImageData(0, 0, width, height).data;
    const header = new TextEncoder().encode(`${width}x${height}:`);
    const input = new Uint8Array(header.length + pixels.byteLength);
    input.set(header);
    input.set(pixels, header.length);
    const digest = await crypto.subtle.digest('SHA-256', input);
    const sourceFingerprint = `sha256:${Array.from(new Uint8Array(digest))
      .map((byte) => byte.toString(16).padStart(2, '0'))
      .join('')}`;
    const mask = new Uint8Array(width * height);
    const left = Math.floor(width * 0.35);
    const top = Math.floor(height * 0.35);
    const right = Math.ceil(width * 0.65);
    const bottom = Math.ceil(height * 0.65);
    for (let y = top; y < bottom; y += 1) {
      mask.fill(255, y * width + left, y * width + right);
    }
    dispatch((previous: any) => ({
      ...previous,
      selection: [imageNodeId],
      cafDialogNodeId: imageNodeId,
      objectSelectionSession: {
        documentId: previous.document.id,
        nodeId: imageNodeId,
        width,
        height,
        candidates: [{ mask, confidence: 0.99, scoreSource: 'model-iou' }],
        selectedCandidate: 0,
        points: [{ x: width * 0.5, y: height * 0.5, label: 1 }],
        box: null,
        confidence: 0.99,
        confidenceSource: 'model-iou',
        sourceLocator: imageSource,
        sourceFingerprint,
        status: 'ready',
        modelId: 'sam2-hiera-tiny',
      },
    }));
  });
  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  await expect(dialog).toBeVisible();
}

async function seedBackgroundRemovalPreviewAndOpenCaf(
  page: import('@playwright/test').Page,
): Promise<void> {
  await page.evaluate(() => {
    const root = document.querySelector('#root > *') as any;
    if (!root) throw new Error('editor root not found');
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber not found');
    const seen = new Set<any>();
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber)) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const current = hook.queue.lastRenderedState;
          if (current?.document?.nodes) {
            const imageNode = Object.values(current.document.nodes).find(
              (node: any) =>
                node?.kind === 'shape' && node.fills?.some((fill: any) => fill.type === 'image'),
            ) as any;
            if (!imageNode) {
              hook = hook.next;
              continue;
            }
            const imageFill = imageNode.fills.find((fill: any) => fill.type === 'image');
            const image = imageFill?.image;
            const asset = image?.assetId ? current.document.assets?.[image.assetId] : undefined;
            const width = image?.imageWidth ?? asset?.naturalWidth ?? 0;
            const height = image?.imageHeight ?? asset?.naturalHeight ?? 0;
            if (!image?.src || !Number.isSafeInteger(width) || !Number.isSafeInteger(height)) {
              throw new Error('imported image dimensions are unavailable');
            }
            const mask = document.createElement('canvas');
            mask.width = width;
            mask.height = height;
            const context = mask.getContext('2d');
            if (!context) throw new Error('mask canvas unavailable');
            context.fillStyle = 'black';
            context.fillRect(0, 0, width, height);
            context.fillStyle = 'white';
            context.fillRect(
              Math.floor(width * 0.35),
              Math.floor(height * 0.35),
              Math.max(1, Math.floor(width * 0.3)),
              Math.max(1, Math.floor(height * 0.3)),
            );
            const crop = image.crop;
            const placementRevision = JSON.stringify([
              image.x ?? 0,
              image.y ?? 0,
              image.scale ?? 1,
              image.fit ?? '',
              image.rotation ?? 0,
              image.flipH ?? false,
              image.flipV ?? false,
              crop ? [crop.x, crop.y, crop.w, crop.h] : null,
            ]);
            hook.queue.dispatch((previous: any) => ({
              ...previous,
              selection: [imageNode.id],
              cafDialogNodeId: imageNode.id,
              backgroundRemovalPreviewSession: {
                nodeId: imageNode.id,
                documentId: previous.document.id,
                sourceLocator: image.src,
                placementRevision,
                maskDataUrl: mask.toDataURL('image/png'),
                width,
                height,
                sourceWidth: width,
                sourceHeight: height,
                requestedMethod: 'quick',
                actualMethod: 'quick',
                confidence: 0.92,
                feather: 0.5,
                decontaminate: false,
              },
            }));
            return;
          }
        }
        hook = hook.next;
      }
      walk(fiber.child);
      walk(fiber.sibling);
    })(root[fiberKey]);
  });
  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  await expect(dialog).toBeVisible();
}

test('uses a confirmed Object Selection candidate as an editable CAF mask', async ({ page }) => {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-portrait.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30_000 });

  await seedReadyObjectSelectionAndOpenCaf(page);
  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  const objectSelection = dialog.getByRole('button', { name: 'Use Object Selection' });
  await expect(objectSelection).toBeEnabled({ timeout: 10_000 });
  await objectSelection.click();
  await expect(dialog).toContainText(
    'Using the confirmed Object Selection candidate; refine it with the brush.',
  );
  await expect(dialog.getByRole('button', { name: /clear paint/i })).toBeEnabled();
  await expect(dialog.getByRole('button', { name: /remove && fill/i })).toBeEnabled();
  await dialog.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dialog).not.toBeVisible();
});

test('uses a current Background Removal preview as an editable CAF mask', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-portrait.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30_000 });

  await seedBackgroundRemovalPreviewAndOpenCaf(page);
  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  const previewButton = dialog.getByRole('button', {
    name: 'Use Background Removal Preview',
  });
  await expect(previewButton).toBeEnabled({ timeout: 10_000 });
  await previewButton.click();
  await expect(dialog).toContainText(
    'Using the Background Removal preview as an editable mask; refine it with the brush before generating.',
  );
  await expect(dialog.getByRole('button', { name: /clear paint/i })).toBeEnabled();
  await testInfo.attach('caf-background-removal-mask-source', {
    body: await dialog.screenshot(),
    contentType: 'image/png',
  });
  await dialog.getByRole('button', { name: /^cancel$/i }).click();
  await expect(dialog).not.toBeVisible();
});

test('can launch Object Selection from the modal mask-source controls', async ({
  page,
}, testInfo) => {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-portrait.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30_000 });

  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments' }).click();
  const generativeSection = inspector.getByRole('button', {
    name: 'Generative Edit',
    exact: true,
  });
  if ((await generativeSection.getAttribute('aria-expanded')) !== 'true') {
    await generativeSection.click();
  }
  await inspector.getByRole('button', { name: 'Open Generative Edit dialog' }).click();

  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('button', { name: 'Start Object Selection' }).click();
  await expect(dialog).not.toBeVisible();
  await expect(
    page.getByTestId('toolbar').getByRole('button', { name: 'Object Selection' }),
  ).toHaveAttribute('aria-pressed', 'true');
  const canvas = page.getByTestId('editor-canvas');
  await testInfo.attach('caf-object-selection-handoff', {
    body: await canvas.screenshot(),
    contentType: 'image/png',
  });
  await canvas.screenshot({ path: testInfo.outputPath('caf-object-selection-handoff.png') });
});

test('keeps the Object Selection handoff disabled after mask painting begins', async ({ page }) => {
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('tests/e2e/fixtures/real-life-portrait.jpg'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30_000 });

  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments' }).click();
  const generativeSection = inspector.getByRole('button', {
    name: 'Generative Edit',
    exact: true,
  });
  if ((await generativeSection.getAttribute('aria-expanded')) !== 'true') {
    await generativeSection.click();
  }
  await inspector.getByRole('button', { name: 'Open Generative Edit dialog' }).click();

  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  const maskCanvas = dialog.locator('canvas.caf-dialog__mask-canvas');
  await expect
    .poll(() => maskCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).width))
    .toBeGreaterThan(300);
  await expect
    .poll(() => maskCanvas.evaluate((canvas) => (canvas as HTMLCanvasElement).height))
    .toBeGreaterThan(300);
  await expect
    .poll(() =>
      maskCanvas.evaluate((canvas) => {
        const rect = canvas.getBoundingClientRect();
        return rect.width * rect.height;
      }),
    )
    .toBeGreaterThan(10_000);
  const bounds = await maskCanvas.boundingBox();
  expect(bounds).not.toBeNull();
  const y = bounds!.y + bounds!.height / 2;
  const hitTarget = await page.evaluate(
    ({ x, y: targetY }) => document.elementFromPoint(x, targetY)?.className ?? '',
    { x: bounds!.x + bounds!.width * 0.5, y },
  );
  expect(hitTarget).toContain('caf-dialog__mask-canvas');
  await page.mouse.move(bounds!.x + bounds!.width * 0.35, y);
  await page.mouse.down();
  await page.mouse.move(bounds!.x + bounds!.width * 0.65, y);
  await page.mouse.up();
  await page.waitForTimeout(200);

  await expect(dialog.getByRole('button', { name: 'Start Object Selection' })).toBeDisabled();
  await expect(dialog.getByRole('button', { name: /clear paint/i })).toBeEnabled();
});
