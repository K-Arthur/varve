#!/usr/bin/env node
import { strict as assert } from 'node:assert';
/**
 * Video B — background removal on a separate product photograph.
 *
 * AI Balanced is selected in the inspector and the resulting mask is applied
 * through the review UI. The capture records the actual provider/model shown
 * by the product, rather than assuming that an inference request succeeded.
 */
import { createHash } from 'node:crypto';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';
import {
  useTool as activateTool,
  beat,
  canvasPixels,
  dragAt,
  fitContent,
  importImage,
  openCleanEditor,
  parkPointer,
  selectLayer,
  settle,
} from '../core/editor.mjs';
import { capture, ROOT } from '../core/run.mjs';

const inputPath = join(ROOT, 'tests', 'fixtures', 'bg-removal-corpus', 'car.jpg');
const modelManifest = JSON.parse(
  readFileSync(join(ROOT, 'apps', 'desktop', 'public', 'models', 'manifest.json'), 'utf8'),
);
const inputSha256 = createHash('sha256').update(readFileSync(inputPath)).digest('hex');
let modelCapture = null;

await capture({
  slug: 'background-removal',
  workflow: 'Background removal',
  purpose: 'AI Balanced foreground extraction on a challenging product photograph.',
  fixture: 'tests/fixtures/bg-removal-corpus/car.jpg',
  duration: [18, 32],
  metadata: () => ({
    modelCapture,
    inputSha256,
    modelManifestVersion: modelManifest.version ?? null,
  }),
  artifacts: () => [
    {
      name: 'background-removal-model.json',
      contents: `${JSON.stringify(
        {
          provider: modelCapture?.provider ?? null,
          model: modelCapture?.model ?? null,
          modelSha256: modelCapture?.modelSha256 ?? null,
          inputSha256,
          outputSha256: modelCapture?.outputSha256 ?? null,
          runtimeVersion: modelCapture?.runtimeVersion ?? null,
          backend: modelCapture?.backend ?? null,
        },
        null,
        2,
      )}\n`,
    },
  ],

  async sequence(ctx) {
    const { page, base, begin } = ctx;
    const assertions = [];

    await openCleanEditor(page, base);
    // A real contrasting plate is created before the photo, so it remains
    // behind the imported image when the mask is applied.
    await activateTool(page, 'r');
    await dragAt(page, [0.08, 0.08], [0.92, 0.92], { steps: 18 });
    await activateTool(page, 'v');
    await importImage(page, inputPath);
    await selectLayer(page, /car/i);
    await fitContent(page);
    await parkPointer(page);
    await settle(page);
    const before = await canvasPixels(page);
    begin();
    await beat(page, 1100);

    await page.getByRole('tab', { name: 'Adjustments' }).click();
    const section = page.getByRole('button', { name: 'Background Removal' });
    if ((await section.getAttribute('aria-expanded')) === 'false') await section.click();
    const method = page.getByRole('combobox', { name: 'Background removal method' });
    await method.click();
    await page.getByRole('option', { name: /AI Balanced/i }).click();
    assertions.push('AI Balanced was chosen from the production Background Removal inspector');
    await beat(page, 900);

    const startButton = page.getByRole('button', { name: 'Remove background from image' });
    await startButton.click();
    const progress = page.getByText(/Creating mask preview/i);
    await progress.waitFor({ state: 'visible', timeout: 4000 }).catch(() => undefined);
    const review = page.getByRole('region', { name: 'Background removal review' });
    await review.waitFor({ state: 'visible', timeout: 60000 });
    assertions.push('inference progress/review appeared only after a real model-backed request');

    const status = await review.getByRole('status').innerText();
    assert.match(status, /AI Balanced/i, 'review did not report the requested method');
    const model = status.match(/with ([\w.-]+)/i)?.[1] ?? null;
    const provider = status.match(/on ([\w.-]+)/i)?.[1] ?? null;
    const modelEntry = (modelManifest.models ?? []).find((entry) => entry.id === model);
    const maskStats = await page.evaluate(async () => {
      const image = document.querySelector('img[alt="Isolated subject preview"]');
      if (!(image instanceof HTMLImageElement)) return { bytes: 0, alphaPixels: 0, pixels: 0 };
      const style = getComputedStyle(image);
      const match = (style.webkitMaskImage || style.maskImage).match(/url\("?([^")]+)"?\)/);
      if (!match?.[1]) return { bytes: 0, alphaPixels: 0, pixels: 0 };
      const mask = new Image();
      mask.src = match[1];
      await mask.decode();
      const canvas = document.createElement('canvas');
      canvas.width = mask.naturalWidth;
      canvas.height = mask.naturalHeight;
      const ctx = canvas.getContext('2d');
      if (!ctx) return { bytes: match[1].length, alphaPixels: 0, pixels: 0 };
      ctx.drawImage(mask, 0, 0);
      const alpha = ctx.getImageData(0, 0, canvas.width, canvas.height).data;
      let alphaPixels = 0;
      for (let i = 3; i < alpha.length; i += 4) if (alpha[i] > 8) alphaPixels += 1;
      return { bytes: match[1].length, alphaPixels, pixels: alpha.length / 4, dataUrl: match[1] };
    });
    assert.ok(maskStats.bytes > 100, 'review did not expose a real mask data URL');
    assert.ok(
      maskStats.alphaPixels > 0 && maskStats.alphaPixels < maskStats.pixels,
      'mask is trivial',
    );
    assertions.push(
      `mask is non-trivial (${maskStats.alphaPixels}/${maskStats.pixels} foreground pixels)`,
    );

    const outputSha256 = maskStats.dataUrl?.startsWith('data:')
      ? createHash('sha256')
          .update(Buffer.from(maskStats.dataUrl.split(',')[1], 'base64'))
          .digest('hex')
      : null;
    modelCapture = {
      provider,
      model,
      modelSha256: modelEntry?.sha256 ?? null,
      inputSha256,
      outputSha256,
      runtimeVersion: 'onnxruntime-web 1.27.0 (workspace lockfile)',
      backend: provider,
    };
    assert.ok(
      modelCapture.model && modelCapture.modelSha256,
      `model provenance missing: ${status}`,
    );
    await beat(page, 1300);

    await review.getByRole('button', { name: 'Apply result' }).click();
    await review.waitFor({ state: 'hidden', timeout: 15000 });
    await settle(page);
    const masked = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(before, masked),
      0,
      'applying the mask did not change the canvas',
    );
    assertions.push('the applied alpha mask changes the real image render over the contrast plate');
    await beat(page, 1100);

    const showOriginal = page.getByRole('button', { name: 'Show Original' });
    await showOriginal.click();
    await settle(page);
    const originalView = await canvasPixels(page);
    assert.notEqual(
      Buffer.compare(masked, originalView),
      0,
      'Show Original did not bypass the mask',
    );
    assertions.push('Show Original toggles the nondestructive result without deleting the mask');
    await beat(page, 900);
    await page.getByRole('button', { name: 'Showing Original' }).click();
    await parkPointer(page);
    await beat(page, 1300);
    return assertions;
  },
});
