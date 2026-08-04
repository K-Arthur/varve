import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from './shared';

test('open CAF dialog via React dispatch', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  await navigateToEditor(page);

  // Drop image
  const pngBuffer = readFileSync(path.resolve(__dirname, 'fixtures', 'caf-test.png'));
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

  await page.waitForTimeout(1500);

  // Open CAF dialog via React dispatch
  const result = await page.evaluate(() => {
    const r = document.querySelector('#root') as any;
    const rootKey = Object.keys(r).find((k) => k.startsWith('__reactContainer$'));
    if (!rootKey) return { error: 'no react container' };

    const seen = new Set<any>();
    function walk(fiber: any): any {
      if (!fiber || seen.has(fiber)) return null;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue?.lastRenderedState) {
          const st = hook.queue.lastRenderedState;
          if (st?.document?.nodes) {
            const nodeIds = Object.keys(st.document.nodes);
            for (const id of nodeIds) {
              const n = st.document.nodes[id];
              if (n?.kind === 'shape' && n.fills?.some((f: any) => f.type === 'image')) {
                hook.queue.dispatch({ cafDialogNodeId: id, selectedNodeIds: [id] });
                return { success: true, nodeId: id, kind: n.kind };
              }
            }
          }
        }
        hook = hook.next;
      }
      const kids = [fiber.child, fiber.sibling, fiber.return];
      for (const k of kids) {
        const r2 = walk(k);
        if (r2) return r2;
      }
      return null;
    }
    return walk(r[rootKey]) || { error: 'walk ended' };
  });

  console.log('Dispatch result:', JSON.stringify(result));
  await page.waitForTimeout(1000);

  const dialog = page.locator('dialog.varve-dialog--caf[open]');
  console.log('Dialog visible:', await dialog.isVisible().catch(() => false));
  if (await dialog.isVisible().catch(() => false)) {
    console.log('Title:', await dialog.locator('#caf-dialog-title').textContent());
  }
});
