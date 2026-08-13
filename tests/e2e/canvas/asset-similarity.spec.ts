import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

/**
 * Find Similar workflow (Intelligence panel -> Similar tab).
 *
 * The populated-results path uses the deterministic test seam
 * (window.__varveSimilarityTest.mockEmbed) so the UI layout is covered
 * without running real inference. Real-model coverage belongs to the
 * release corpus; model-quality specs cover the no-model state.
 */

async function importImages(page: import('@playwright/test').Page, names: string[]) {
  await page.locator('#file-import-input').setInputFiles(
    names.map((name) => path.resolve('tests/e2e/fixtures', name)),
  );
  await expect(page.getByRole('treeitem')).toHaveCount(names.length, { timeout: 15000 });
}

async function openSimilarTab(page: import('@playwright/test').Page) {
  await page.locator('#insp-tab-audit').click();
  await page.getByRole('tab', { name: 'More' }).click();
  await page.getByRole('menuitem', { name: 'similar' }).click();
  await expect(page.getByRole('button', { name: /Find similar/i }).first()).toBeVisible({
    timeout: 10000,
  });
}

function mockEmbedScript(): string {
  return `(() => {
    const dim = 768;
    const vectorFor = (src) => {
      let h = 0;
      for (let i = 0; i < src.length; i++) h = (h * 31 + src.charCodeAt(i)) | 0;
      const values = new Float32Array(dim);
      let seed = h >>> 0;
      let sumSq = 0;
      for (let i = 0; i < dim; i++) {
        seed = (seed + 0x6d2b79f5) | 0;
        let t = Math.imul(seed ^ (seed >>> 15), 1 | seed);
        t = (t + Math.imul(t ^ (t >>> 7), 61 | t)) ^ t;
        const v = ((t ^ (t >>> 14)) >>> 0) / 4294967296 * 2 - 1;
        values[i] = v;
        sumSq += v * v;
      }
      const norm = Math.sqrt(sumSq) || 1;
      for (let i = 0; i < dim; i++) values[i] /= norm;
      return {
        modelId: 'siglip-base-patch16-224',
        modelRevision: 'xenova-onnx-2026-07-21',
        embeddingSpaceVersion: 'siglip-image-pooler-v1',
        preprocessingVersion: 'semantic-rgb-letterbox-neutral-v2',
        dimension: dim,
        dtype: 'fp32',
        normalized: true,
        values,
      };
    };
    window.__varveSimilarityTest = { mockEmbed: (src) => Promise.resolve(vectorFor(src)) };
  })()`;
}

test.describe('Find Similar workflow', () => {
  test('shows a download requirement when no model is installed', async ({ page }) => {
    await navigateToEditor(page);
    await importImages(page, ['test-image.png', 'flower.jpg', 'photo-fixture.jpg']);
    // Select the first image in the layers panel.
    await page.getByRole('treeitem').first().click();
    await openSimilarTab(page);

    await expect(page.getByRole('button', { name: /Download AI Model/i })).toBeVisible({
      timeout: 10000,
    });
    await expect(page.getByRole('button', { name: /Find similar/i }).first()).toBeDisabled();
  });

  test('explains the empty state for a non-image selection', async ({ page }) => {
    await navigateToEditor(page);
    await importImages(page, ['test-image.png']);
    // Open the Similar tab without selecting an image.
    await openSimilarTab(page);
    await expect(page.getByText(/Select an image or enter a description/i)).toBeVisible({
      timeout: 10000,
    });
  });

  test('ranks and renders results with deterministic mocked embeddings', async ({ page }, testInfo) => {
    await navigateToEditor(page);
    await importImages(page, ['test-image.png', 'flower.jpg', 'photo-fixture.jpg', 'subject-photo.png']);
    await page.getByRole('treeitem').first().click();
    await openSimilarTab(page);

    await page.evaluate(mockEmbedScript);

    await page.getByRole('button', { name: /Find similar/i }).first().click();

    await expect(page.getByText(/Found \d+ similar images/i)).toBeVisible({ timeout: 15000 });
    const results = page.locator('.similarity-result');
    await expect(results).toHaveCount(3);
    await expect(results.first().locator('img')).toHaveAttribute('src', /.+/);

    // Selecting a result keeps the document usable.
    await results.first().click();
    await expect(page.getByRole('treeitem')).toHaveCount(4);

    await testInfo.attach('similarity-results', {
      body: await page.locator('.intelligence-tab-content').screenshot(),
      contentType: 'image/png',
    });
  });

  test('mode picker switches between Similar and Near duplicates', async ({ page }) => {
    await navigateToEditor(page);
    await importImages(page, ['test-image.png', 'flower.jpg', 'photo-fixture.jpg']);
    await page.getByRole('treeitem').first().click();
    await openSimilarTab(page);
    await page.evaluate(mockEmbedScript);
    await page.getByRole('button', { name: /Find similar/i }).first().click();
    await expect(page.locator('.similarity-result')).toHaveCount(2, { timeout: 15000 });

    const nearDuplicates = page.getByRole('button', { name: 'Near duplicates' });
    await nearDuplicates.click();
    await expect(nearDuplicates).toHaveAttribute('aria-pressed', 'true');
    await page.getByRole('button', { name: /Find similar/i }).first().click();
    await expect(page.locator('.similarity-result')).toHaveCount(2, { timeout: 15000 });
  });
});
