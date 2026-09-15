/**
 * Real-image validation test for the background removal pipeline.
 *
 * Runs the bundled u2netp model on each image in the validation corpus
 * and checks basic quality properties. This catches regressions in the
 * preprocessing → inference → postprocessing pipeline without requiring
 * ground-truth masks.
 *
 * For IoU/Dice/mask-quality metrics, see background-removal-quality.spec.ts
 * which requires VARVE_BGREMOVAL_BENCH_DIR with ground-truth masks.
 */

import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const CORPUS_DIR = path.resolve(__dirname, '../../fixtures/bg-removal-corpus');
const CORPUS_JSON = JSON.parse(fs.readFileSync(path.join(CORPUS_DIR, 'corpus.json'), 'utf8')) as {
  images: Array<{
    id: string;
    file: string;
    category: string;
    description: string;
    expectedProperties: {
      minForegroundRatio: number;
      maxForegroundRatio: number;
    };
  }>;
};

function fileDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

interface ValidationResult {
  caseId: string;
  category: string;
  ok: boolean;
  processingTimeMs?: number;
  confidence?: number;
  foregroundRatio?: number;
  outputWidth?: number;
  outputHeight?: number;
  error?: string;
}

const results: ValidationResult[] = [];

test.describe('real-image validation corpus', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  for (const fixture of CORPUS_JSON.images) {
    test(`${fixture.id} — ${fixture.category}: ${fixture.description}`, async ({ page }) => {
      test.setTimeout(90_000);
      const imageDataUrl = fileDataUrl(path.join(CORPUS_DIR, fixture.file));
      const engineModuleUrl = `/@fs${path.resolve(
        'packages/engine/src/backgroundRemoval/index.ts',
      )}`;

      const result = await page.evaluate(
        async ({ caseId, category, engineModuleUrl, imageDataUrl, expected }) => {
          const decode = async (url: string): Promise<ImageData> => {
            const image = new Image();
            image.src = url;
            await image.decode();
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d')!;
            context.drawImage(image, 0, 0);
            return context.getImageData(0, 0, canvas.width, canvas.height);
          };

          try {
            const source = await decode(imageDataUrl);
            const engine = await import(engineModuleUrl);
            const output = await engine.removeBackground(source, {
              method: 'ai-balanced',
              previewMaxDimension: 1024,
            });

            const maskData = output.rawMask;
            if (!maskData || maskData.length === 0) {
              return {
                caseId,
                category,
                ok: false,
                error: 'No mask data returned',
              };
            }

            let fgPixels = 0;
            for (let i = 0; i < maskData.length; i++) {
              if (maskData[i]! > 128) fgPixels++;
            }
            const foregroundRatio = fgPixels / maskData.length;

            const withinRange =
              foregroundRatio >= expected.minForegroundRatio &&
              foregroundRatio <= expected.maxForegroundRatio;

            return {
              caseId,
              category,
              ok: withinRange,
              processingTimeMs: output.processingTimeMs,
              confidence: output.confidence,
              foregroundRatio,
              outputWidth: output.width,
              outputHeight: output.height,
              error: withinRange
                ? undefined
                : `Foreground ratio ${(foregroundRatio * 100).toFixed(1)}% outside expected range [${(expected.minForegroundRatio * 100).toFixed(0)}%, ${(expected.maxForegroundRatio * 100).toFixed(0)}%]`,
            };
          } catch (err) {
            return {
              caseId,
              category,
              ok: false,
              error: err instanceof Error ? err.message : String(err),
            };
          }
        },
        {
          caseId: fixture.id,
          category: fixture.category,
          engineModuleUrl,
          imageDataUrl,
          expected: fixture.expectedProperties,
        },
      );

      results.push(result);

      // Basic quality assertions
      expect(result.ok, result.error).toBe(true);
      expect(result.confidence, 'confidence should be defined').toBeDefined();
      expect(result.confidence!, 'confidence should be > 0').toBeGreaterThan(0);
      expect(result.foregroundRatio!, 'foreground ratio should be > 0').toBeGreaterThan(0);
      expect(result.foregroundRatio!, 'foreground ratio should be < 1').toBeLessThan(1);
    });
  }

  test('all cases passed', () => {
    const failed = results.filter((r) => !r.ok);
    if (failed.length > 0) {
      console.warn('Failed cases:', failed.map((f) => `${f.caseId}: ${f.error}`).join('\n'));
    }
    expect(failed.length, `${failed.length} cases failed`).toBe(0);
  });
});
