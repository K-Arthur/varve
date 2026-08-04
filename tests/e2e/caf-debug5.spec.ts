import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from './shared';

test('find state via hook chain', async ({ page }) => {
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

  // Find state using React root
  const state = await page.evaluate(() => {
    const r = document.querySelector('#root') as any;
    if (!r) return 'no root';

    // Try to find the react internal root
    const rootKey = Object.keys(r).find((k) => k.startsWith('__reactContainer$'));
    if (!rootKey)
      return {
        keys: Object.keys(r)
          .filter((k) => k.startsWith('__'))
          .slice(0, 10),
      };

    // Walk the fiber tree to find editor state
    const fiber = r[rootKey];
    let depth = 0;

    function visitFiber(f: any): any {
      if (!f || depth > 2000) return null;
      depth++;

      // Check state hooks
      let hook = f.memoizedState;
      while (hook) {
        if (hook.queue?.lastRenderedState) {
          const st = hook.queue.lastRenderedState;
          if (st?.document?.nodes) {
            // Found editor state!
            const nodeIds = Object.keys(st.document.nodes);
            const selIds = st.selectedNodeIds || [];
            const detailedNodes = nodeIds.slice(0, 3).map((id) => {
              const n = st.document.nodes[id];
              return {
                id,
                kind: n?.kind,
                fills: n?.fills?.map((f: any) => ({
                  type: f.type,
                  hasImageSrc: !!f.image?.src,
                  imageSrcLen: f.image?.src?.length,
                })),
                sel: selIds.includes(id),
              };
            });
            return {
              found: true,
              cafDialogNodeId: st.cafDialogNodeId,
              selNodeIds: selIds,
              nodes: detailedNodes,
              key: rootKey,
            };
          }
        }
        hook = hook.next;
      }

      // Recurse children, then siblings
      if (f.child) {
        const r = visitFiber(f.child);
        if (r) return r;
      }
      if (f.sibling) {
        const r = visitFiber(f.sibling);
        if (r) return r;
      }

      return null;
    }

    const result = visitFiber(fiber);
    return result || { error: 'tree walk ended', depth };
  });

  console.log('State:', JSON.stringify(state, null, 2));

  if (state?.found) {
    // Directly set cafDialogNodeId via React dispatch
    await page.evaluate(() => {
      const rootEl = document.querySelector('#root') as any;
      if (!rootEl) return;

      const rootKey = Object.keys(rootEl).find((k) => k.startsWith('__reactContainer$'));
      if (!rootKey) return;

      const fiber = rootEl[rootKey];
      let depth = 0;

      function visitFiber(f: any): { dispatch: any; nodeId: string } | null {
        if (!f || depth > 2000) return null;
        depth++;

        let hook = f.memoizedState;
        while (hook) {
          if (hook.queue?.lastRenderedState) {
            const st = hook.queue.lastRenderedState;
            if (st?.document?.nodes) {
              // Find an image node
              const nodeIds = Object.keys(st.document.nodes);
              for (const id of nodeIds) {
                const n = st.document.nodes[id];
                if (n?.kind === 'shape' && n.fills?.some((f: any) => f.type === 'image')) {
                  // Set cafDialogNodeId AND selectedNodeIds
                  hook.queue.dispatch({ cafDialogNodeId: id, selectedNodeIds: [id] });
                  return { dispatch: 'ok', nodeId: id };
                }
              }
            }
          }
          hook = hook.next;
        }

        if (f.child) {
          const r = visitFiber(f.child);
          if (r) return r;
        }
        if (f.sibling) {
          const r = visitFiber(f.sibling);
          if (r) return r;
        }

        return null;
      }

      const dispatchResult = visitFiber(fiber);
      console.log('[page] dispatch result:', JSON.stringify(dispatchResult));
    });

    await page.waitForTimeout(1000);

    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    console.log('Dialog visible after dispatch:', await dialog.isVisible().catch(() => false));

    if (await dialog.isVisible().catch(() => false)) {
      console.log('Dialog title:', await dialog.locator('#caf-dialog-title').textContent());
      console.log('CAF dialog opened successfully!');
    }
  }
});
