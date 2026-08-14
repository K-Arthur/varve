import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';

const BENCH_DIR = process.env.VARVE_BGREMOVAL_BENCH_DIR;
const METHODS = ['quick', 'ai-balanced', 'ai-quality'] as const;
const CASES = [
  { id: 'cat', image: 'cat.jpg' },
  { id: 'human', image: 'human.jpg', mask: 'human-mask.png' },
  { id: 'car', image: 'car.jpg', mask: 'car-mask.png' },
  { id: 'object', image: 'object.jpg', mask: 'object-mask.png' },
] as const;

interface BenchmarkResult {
  caseId: string;
  requestedMethod: (typeof METHODS)[number];
  ok: boolean;
  actualMethod?: string;
  executionProvider?: string;
  processingTimeMs?: number;
  coldStartMs?: number;
  warmP50Ms?: number;
  warmP95Ms?: number;
  confidence?: number;
  modelId?: string;
  modelPrecision?: string;
  foregroundRatio?: number;
  softEdgeRatio?: number;
  iou?: number;
  dice?: number;
  precision?: number;
  recall?: number;
  maskMae?: number;
  boundaryFScore?: number;
  boundaryPrecision?: number;
  boundaryRecall?: number;
  trimapBandMae?: number;
  runtime?: string;
  device?: string;
  error?: string;
}

const results: BenchmarkResult[] = [];

function fileDataUrl(filePath: string): string {
  const ext = path.extname(filePath).toLowerCase();
  const mime = ext === '.png' ? 'image/png' : 'image/jpeg';
  return `data:${mime};base64,${fs.readFileSync(filePath).toString('base64')}`;
}

test.describe('real-image background-removal quality benchmark', () => {
  test.skip(!BENCH_DIR, 'Set VARVE_BGREMOVAL_BENCH_DIR to an image/mask fixture directory');
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await page.goto('/');
  });

  for (const fixture of CASES) {
    for (const method of METHODS) {
      test(`${fixture.id} — ${method}`, async ({ page }) => {
        test.setTimeout(method === 'ai-quality' ? 180_000 : 90_000);
        const iterations = Math.max(
          1,
          Number.parseInt(process.env.VARVE_BGREMOVAL_BENCH_ITERATIONS ?? '1', 10) || 1,
        );
        const imageDataUrl = fileDataUrl(path.join(BENCH_DIR!, fixture.image));
        const fixtureMaybeWithMask = fixture as { id: string; image: string; mask?: string };
        const maskDataUrl = fixtureMaybeWithMask.mask
          ? fileDataUrl(path.join(BENCH_DIR!, fixtureMaybeWithMask.mask))
          : undefined;
        const engineModuleUrl = `/@fs${path.resolve(
          'packages/engine/src/backgroundRemoval/index.ts',
        )}`;

        const result = await page.evaluate(
          async ({ caseId, engineModuleUrl, imageDataUrl, maskDataUrl, method, iterations }) => {
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
              const truthImage = maskDataUrl ? await decode(maskDataUrl) : undefined;
              const engine = await import(engineModuleUrl);
              const outputs: Array<{
                output: Awaited<ReturnType<typeof engine.removeBackground>>;
                elapsedMs: number;
              }> = [];
              for (let iteration = 0; iteration < iterations; iteration++) {
                const started = performance.now();
                const output = await engine.removeBackground(source, {
                  method,
                  previewMaxDimension: 1024,
                });
                outputs.push({ output, elapsedMs: performance.now() - started });
              }
              const output = outputs.at(-1)!.output;
              const predicted = output.rawMask;
              if (!predicted) throw new Error('Provider returned no raw mask');

              let foreground = 0;
              let softEdges = 0;
              for (const alpha of predicted) {
                if (alpha >= 128) foreground++;
                if (alpha > 8 && alpha < 247) softEdges++;
              }

              const metrics: Record<string, number> = {
                foregroundRatio: foreground / predicted.length,
                softEdgeRatio: softEdges / predicted.length,
              };
              if (truthImage) {
                const truthCanvas = document.createElement('canvas');
                truthCanvas.width = output.width;
                truthCanvas.height = output.height;
                const truthContext = truthCanvas.getContext('2d')!;
                const sourceCanvas = document.createElement('canvas');
                sourceCanvas.width = truthImage.width;
                sourceCanvas.height = truthImage.height;
                sourceCanvas.getContext('2d')!.putImageData(truthImage, 0, 0);
                truthContext.drawImage(sourceCanvas, 0, 0, output.width, output.height);
                const truth = truthContext.getImageData(0, 0, output.width, output.height).data;
                const expectedMask = new Uint8Array(output.width * output.height);
                for (let index = 0; index < expectedMask.length; index++) {
                  expectedMask[index] = truth[index * 4] ?? 0;
                }
                const quality = engine.computeMaskQualityMetrics(
                  predicted,
                  expectedMask,
                  output.width,
                  output.height,
                );
                Object.assign(metrics, {
                  iou: quality.iou,
                  dice: quality.dice,
                  precision: quality.precision,
                  recall: quality.recall,
                  maskMae: quality.mae,
                  boundaryFScore: quality.boundaryFScore,
                  boundaryPrecision: quality.boundaryPrecision,
                  boundaryRecall: quality.boundaryRecall,
                });
              }

              const timings = outputs.map((entry) => entry.elapsedMs);
              const warm = timings.slice(1).sort((a, b) => a - b);
              const percentile = (values: number[], p: number) =>
                values.length === 0
                  ? undefined
                  : values[Math.min(values.length - 1, Math.floor(values.length * p))];

              return {
                caseId,
                requestedMethod: method,
                ok: true,
                actualMethod: output.method,
                executionProvider: output.executionProvider,
                processingTimeMs: output.processingTimeMs,
                coldStartMs: timings[0],
                warmP50Ms: percentile(warm, 0.5),
                warmP95Ms: percentile(warm, 0.95),
                confidence: output.confidence,
                modelId: output.modelId,
                modelPrecision: output.modelPrecision,
                runtime: 'browser-onnx',
                device: navigator.userAgent,
                ...metrics,
                maskDataUrl: output.maskDataUrl,
              };
            } catch (error) {
              return {
                caseId,
                requestedMethod: method,
                ok: false,
                error: error instanceof Error ? error.message : String(error),
              };
            }
          },
          { caseId: fixture.id, engineModuleUrl, imageDataUrl, maskDataUrl, method, iterations },
        );

        const outputMask = 'maskDataUrl' in result ? result.maskDataUrl : undefined;
        if (outputMask) {
          const encoded = outputMask.slice(outputMask.indexOf(',') + 1);
          fs.writeFileSync(
            path.join(BENCH_DIR!, `${fixture.id}-${method}-mask.png`),
            encoded,
            'base64',
          );
        }
        if (!result.ok || !('actualMethod' in result)) {
          expect(result.ok, 'error' in result ? result.error : 'unknown error').toBe(true);
          return;
        }
        results.push(result);
        expect(result.actualMethod).toBeTruthy();
      });
    }
  }

  test.afterAll(() => {
    if (BENCH_DIR) {
      fs.writeFileSync(
        path.join(BENCH_DIR, 'results.json'),
        `${JSON.stringify(
          {
            schemaVersion: 2,
            generatedAt: new Date().toISOString(),
            gitCommit: process.env.GITHUB_SHA ?? 'working-tree',
            runtime: 'browser-onnx',
            iterations: Math.max(
              1,
              Number.parseInt(process.env.VARVE_BGREMOVAL_BENCH_ITERATIONS ?? '1', 10) || 1,
            ),
            results,
          },
          null,
        )}\n`,
        'utf8',
      );
    }
  });
});
