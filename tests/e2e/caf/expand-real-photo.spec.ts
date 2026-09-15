import { readFileSync } from 'node:fs';
import { mkdir } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_PATH = path.resolve(__dirname, '..', 'fixtures', 'real-life-landscape.jpg');

async function dropPhotoAndSelect(page: import('@playwright/test').Page): Promise<string> {
  const bytes = readFileSync(PHOTO_PATH).toString('base64');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not visible');
  const before = await page.getByRole('treeitem').count();

  await page.evaluate(
    ({ x, y, encoded }) => {
      const binary = atob(encoded);
      const data = new Uint8Array(binary.length);
      for (let index = 0; index < binary.length; index += 1) {
        data[index] = binary.charCodeAt(index);
      }
      const transfer = new DataTransfer();
      transfer.items.add(new File([data], 'real-life-landscape.jpg', { type: 'image/jpeg' }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas is missing');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: transfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: x,
          clientY: y,
          dataTransfer: transfer,
        }),
      );
    },
    { x: box.x + 160, y: box.y + 160, encoded: bytes },
  );

  await expect
    .poll(() => page.getByRole('treeitem').count(), { timeout: 60_000 })
    .toBeGreaterThan(before);
  await page.mouse.click(box.x + 180, box.y + 180);
  await page.waitForTimeout(300);

  const nodeId = await page.evaluate(() => {
    const root = document.querySelector('#root > *') as any;
    const fiberKey = Object.keys(root).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber is missing');
    const seen = new Set<any>();
    let found: string | null = null;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || found) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const state = hook.queue.lastRenderedState;
          if (state?.document?.nodes) {
            for (const id of Object.keys(state.document.nodes).reverse()) {
              const node = state.document.nodes[id];
              if (
                node?.kind === 'shape' &&
                node.fills?.some((fill: any) => fill.type === 'image')
              ) {
                found = id;
                return;
              }
            }
          }
        }
        hook = hook.next;
      }
      for (const child of [fiber.child, fiber.sibling]) walk(child);
    })(root[fiberKey]);
    return found;
  });
  if (!nodeId) throw new Error('image node was not created');
  return nodeId;
}

async function openGenerativeEdit(page: import('@playwright/test').Page): Promise<void> {
  await page.getByRole('tab', { name: 'Adjustments', exact: true }).click();
  await expect(page.getByText('Loading adjustments...', { exact: true })).toHaveCount(0, {
    timeout: 30_000,
  });
  const section = page.getByRole('button', { name: 'Generative Edit', exact: true });
  await expect(section).toBeVisible({ timeout: 10_000 });
  if ((await section.getAttribute('aria-expanded')) !== 'true') await section.click();
  await page.getByRole('button', { name: 'Open Generative Edit dialog' }).click();
}

test.describe('real photographic Expand capability boundary', () => {
  test.setTimeout(60_000);

  test('does not offer browser Expand before a qualified provider exists', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    await dropPhotoAndSelect(page);
    await openGenerativeEdit(page);

    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();
    await dialog.getByRole('tab', { name: 'Expand' }).click();
    await expect(dialog.locator('#caf-dialog-prompt')).toBeDisabled();
    await expect(
      dialog
        .locator('.caf-dialog__hint')
        .filter({ hasText: 'Expand is unavailable in the browser' }),
    ).toBeVisible();
    await expect(
      dialog.locator('button.varve-btn--secondary').filter({ hasText: /^expand$/i }),
    ).toBeDisabled();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeDisabled();

    const evidenceDir = process.env.VARVE_E2E_OUTPUT_DIR
      ? path.resolve(process.env.VARVE_E2E_OUTPUT_DIR)
      : testInfo.outputDir;
    await mkdir(evidenceDir, { recursive: true });
    await dialog.screenshot({
      path: path.join(evidenceDir, 'real-landscape-expand-unavailable.png'),
      animations: 'disabled',
    });
    await dialog.getByRole('button', { name: /^cancel$/i }).click();
    await expect(dialog).not.toBeVisible();
  });
});
