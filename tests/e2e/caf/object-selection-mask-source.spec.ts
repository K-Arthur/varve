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
            ) as { id: string } | undefined;
            if (imageNode) {
              hook.queue.dispatch((previous: any) => ({
                ...previous,
                selection: [imageNode.id],
                cafDialogNodeId: imageNode.id,
                objectSelectionSession: {
                  documentId: previous.document.id,
                  nodeId: imageNode.id,
                  width: 1,
                  height: 1,
                  candidates: [{ mask: new Uint8Array([255]), confidence: 0.99 }],
                  selectedCandidate: 0,
                  points: [{ x: 0.5, y: 0.5, label: 1 }],
                  box: null,
                  confidence: 0.99,
                  confidenceSource: 'model-iou',
                  status: 'ready',
                  modelId: 'sam2-hiera-tiny',
                },
              }));
              return;
            }
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
