/**
 * Full-corpus retrieval evaluation. Runs the canonical harness over the
 * Varve corpus with the onnxruntime-node dev runtime and writes:
 *   reports/semantic-similarity/evaluation-<model>.json
 *   reports/semantic-similarity/contact-sheet-<model>-{semantic,duplicates}.html
 *   reports/semantic-similarity/difficult-cases-<model>.html
 *
 * Gated: set VARVE_RUN_SEMANTIC_EVAL=1 to run. Skipped in normal CI.
 * Requires model weights (scripts/semantic-corpus/fetch-models.sh) and
 * the generated corpus (pnpm --filter @varve/engine corpus:generate).
 */

import { join, resolve } from 'node:path';
import { afterAll, describe, expect, it } from 'vitest';
import { writeContactSheets } from './contactSheet';
import { loadCorpusManifest } from './corpus';
import { evaluateModel, summarizeReport, writeEvaluationReport } from './evaluate';
import { makeDinov2Adapter, makeSiglipAdapter } from './models';
import { releaseNodeOrtSessions } from './ortNode';

const RUN = process.env.VARVE_RUN_SEMANTIC_EVAL === '1';
const MODELS_DIR = resolve(
  process.env.VARVE_MODEL_CACHE ?? join(process.env.HOME ?? '/tmp', '.cache/varve/models'),
);

describe.skipIf(!RUN)('semantic similarity evaluation', () => {
  it('evaluates SigLIP and DINOv2-small on the Varve corpus and writes reports', async () => {
    const corpus = loadCorpusManifest();
    expect(corpus.images.length).toBeGreaterThan(100);
    const summaries: string[] = [];
    for (const modelId of ['siglip-base-patch16-224', 'dinov2-small']) {
      const modelPath = join(
        MODELS_DIR,
        modelId === 'siglip-base-patch16-224'
          ? 'siglip-base-patch16-224.onnx'
          : 'dinov2-small.onnx',
      );
      const adapter =
        modelId === 'siglip-base-patch16-224'
          ? makeSiglipAdapter(modelPath)
          : makeDinov2Adapter(modelPath);
      const cacheFile = resolve(
        process.cwd(),
        `reports/semantic-similarity/embeddings-${modelId}.json`,
      );
      const report = await evaluateModel(adapter, corpus, { cacheFile });
      const jsonFile = writeEvaluationReport(report);
      const sheets = writeContactSheets(report, corpus);
      const summary = summarizeReport(report);
      summaries.push(summary);
      console.log(`\n${summary}\nreports: ${jsonFile}\n  ${sheets.join('\n  ')}`);
    }
    expect(summaries.length).toBe(2);
  }, 0);

  afterAll(async () => {
    await releaseNodeOrtSessions();
  });
});
