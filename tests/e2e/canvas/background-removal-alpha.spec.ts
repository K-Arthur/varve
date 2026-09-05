import { readFileSync } from 'node:fs';
import { createRequire } from 'node:module';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const requireFromEngine = createRequire(resolve('packages/engine/package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

async function editorMethod(
  page: import('@playwright/test').Page,
  method: string,
  ...args: unknown[]
) {
  return page.evaluate(
    ({ method, args }) => {
      const root = document.getElementById('root')!;
      const key = Object.keys(root).find(
        (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
      )!;
      function find(fiber: any): any {
        if (!fiber) return null;
        const value = fiber.memoizedProps?.value;
        if (typeof value?.serializeDocument === 'function') return value;
        return find(fiber.child) || find(fiber.sibling);
      }
      const editor = find((root as any)[key]);
      if (!editor || typeof editor[method] !== 'function')
        throw new Error(`Missing editor method: ${method}`);
      return editor[method](...args);
    },
    { method, args },
  );
}

async function assertFullRedrawOracle(page: import('@playwright/test').Page) {
  const samples = await page.evaluate(async () => {
    const canvas = document.querySelector<HTMLCanvasElement>(
      'canvas.editor-canvas__content-layer',
    )!;
    const before = canvas.toDataURL();
    const perf = (window as unknown as { __varvePerf: { forceFullRedraw(): void } }).__varvePerf;
    perf.forceFullRedraw();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
    return { before, after: canvas.toDataURL() };
  });
  expect(samples.after).toBe(samples.before);
}

test('source transparency survives cutout reconstruction, history and PNG export', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  await navigateToEditor(page);
  const source = await page.evaluate(() => {
    const canvas = document.createElement('canvas');
    canvas.width = 2100;
    canvas.height = 300;
    const ctx = canvas.getContext('2d')!;
    ctx.fillStyle = 'white';
    ctx.fillRect(0, 0, 2100, 300);
    ctx.clearRect(600, 60, 900, 180);
    ctx.fillStyle = 'rgba(180, 20, 50, 0.5)';
    ctx.fillRect(600, 60, 900, 180);
    return canvas.toDataURL();
  });
  await page.locator('#file-import-input').setInputFiles({
    name: 'transparent-subject.png',
    mimeType: 'image/png',
    buffer: Buffer.from(source.split(',')[1]!, 'base64'),
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  const canvas = page.getByTestId('editor-canvas');
  await canvas.screenshot({ path: testInfo.outputPath('source.png') });
  await page
    .getByTestId('selection-quick-bar')
    .getByRole('button', { name: 'Remove background' })
    .click();
  const review = page.getByRole('region', { name: 'Background removal review' });
  await expect(review).toBeVisible({ timeout: 30000 });
  await review.screenshot({ path: testInfo.outputPath('preview.png') });
  await review.getByRole('button', { name: 'Apply result' }).click();
  await expect(review).toBeHidden();
  await canvas.screenshot({ path: testInfo.outputPath('applied.png') });
  await page.keyboard.press('Control+z');
  await expect(
    page.getByRole('button', { name: 'Remove background from image', exact: true }),
  ).toBeVisible();
  await canvas.screenshot({ path: testInfo.outputPath('undo.png') });
  await page.keyboard.press('Control+Shift+z');
  await expect(page.getByRole('button', { name: 'Re-apply background removal' })).toBeVisible();
  await canvas.screenshot({ path: testInfo.outputPath('redo.png') });
  await assertFullRedrawOracle(page);
  const saved = (await editorMethod(page, 'serializeDocument')) as string;
  expect(saved).toContain('rasterMaskAssets');
  // A new page load destroys decoded image/mask caches. Reopen through the
  // production document codec/loader, then export from restored assets.
  await navigateToEditor(page);
  await editorMethod(page, 'loadDocument', saved);
  await expect(page.getByRole('treeitem')).toHaveCount(1);
  await page.getByRole('treeitem').first().click();
  await expect(page.getByRole('button', { name: 'Re-apply background removal' })).toBeVisible();
  await canvas.screenshot({ path: testInfo.outputPath('reloaded.png') });
  await assertFullRedrawOracle(page);
  await page.getByRole('tab', { name: 'Export', exact: true }).click();
  await page
    .locator('.spec-export__group')
    .getByRole('button', { name: 'PNG', exact: true })
    .click();
  const pending = page.waitForEvent('download');
  await page.getByRole('button', { name: /download/i }).click();
  const download = await pending;
  const output = testInfo.outputPath('cutout-export.png');
  await download.saveAs(output);
  const exported = PNG.sync.read(readFileSync(output));
  const alphas = new Set<number>();
  for (let i = 3; i < exported.data.length; i += 4) alphas.add(exported.data[i]!);
  expect(alphas.has(0)).toBe(true);
  expect(alphas.has(128)).toBe(true);
  // The source background is opaque; feathering can legitimately leave
  // partial coverage there. Check alpha against the corresponding source,
  // and check the translucent subject interior exactly (128, never 64).
  expect(exported.width).toBe(2100);
  expect(exported.height).toBe(300);
  expect(exported.data[(150 * 2100 + 1050) * 4 + 3]).toBe(128);
  const sourcePixels = PNG.sync.read(Buffer.from(source.split(',')[1]!, 'base64'));
  let excess = 0;
  for (let i = 3; i < exported.data.length; i += 4)
    excess = Math.max(excess, exported.data[i]! - sourcePixels.data[i]!);
  expect(excess).toBeLessThanOrEqual(1);
  await testInfo.attach('cutout-export', { path: output, contentType: 'image/png' });
});
