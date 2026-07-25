import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from './shared';

test('check image node state', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  await navigateToEditor(page);

  // Drop an image
  const FIXTURES_DIR = path.resolve(__dirname, 'fixtures');
  const pngBuffer = readFileSync(path.join(FIXTURES_DIR, 'caf-test.png'));
  const base64 = pngBuffer.toString('base64');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');

  await page.evaluate(
    ({ cX, cY, b64 }) => {
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], 'caf-test.png', { type: 'image/png' }));
      const target = document.querySelector('canvas.editor-canvas__content-layer');
      if (!target) throw new Error('content canvas not found');
      target.dispatchEvent(
        new DragEvent('dragover', {
          bubbles: true,
          cancelable: true,
          clientX: cX,
          clientY: cY,
          dataTransfer: transfer,
        }),
      );
      target.dispatchEvent(
        new DragEvent('drop', {
          bubbles: true,
          cancelable: true,
          clientX: cX,
          clientY: cY,
          dataTransfer: transfer,
        }),
      );
    },
    { cX: box.x + 150, cY: box.y + 150, b64: base64 },
  );

  await page.waitForTimeout(1000);

  // Check the React state using __reactContainer$ prefix
  const state = await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (!root) return 'no root';

    const key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) return 'no container';

    let fiber = (root as any)[key];
    let depth = 0;
    while (fiber && depth < 500) {
      if (fiber.memoizedState?.queue) {
        let hook = fiber.memoizedState;
        while (hook) {
          if (hook.queue?.lastRenderedState) {
            const st = hook.queue.lastRenderedState;
            if (st && typeof st === 'object' && st.document?.nodes) {
              const nodeIds = Object.keys(st.document.nodes);
              const selIds = st.selectedNodeIds || [];
              const nodes = nodeIds
                .slice(0, 5)
                .map((id) => {
                  const n = st.document.nodes[id];
                  if (!n) return null;
                  const fills = n.fills
                    ? n.fills.map((f: any) => ({
                        type: f.type,
                        hasSrc: !!(f as any).image?.src,
                        kind: f.kind,
                      }))
                    : [];
                  return {
                    id,
                    kind: n.kind,
                    shapeKind: n.shape?.kind,
                    fills,
                    isImageShape:
                      n.kind === 'shape' &&
                      n.fills?.some((f: any) => f.type === 'image' && !!f.image?.src),
                  };
                })
                .filter(Boolean);
              return {
                selectedIds: selIds,
                nodeCount: nodeIds.length,
                nodes,
                cafNodeId: st.cafDialogNodeId,
              };
            }
          }
          hook = hook.next;
        }
      }
      fiber = fiber.child || fiber.sibling || fiber.return;
      depth++;
    }
    return { error: 'not found', depth };
  });

  console.log('State:', JSON.stringify(state, null, 2));

  // Check tree items in layers panel
  const treeItems = await page.locator('[role="treeitem"]').count();
  console.log('Tree items:', treeItems);
  if (treeItems > 0) {
    const text = await page.locator('[role="treeitem"]').first().textContent();
    console.log('First tree item text:', text);
  }

  // Check for the CanvasArea's visual indicators
  const cropBtn = page.getByRole('button', { name: /crop/i });
  const removeBgBtn = page.getByRole('button', { name: /remove background/i });
  console.log('Crop button exists:', await cropBtn.isVisible().catch(() => false));
  console.log('Remove BG button exists:', await removeBgBtn.isVisible().catch(() => false));
});
