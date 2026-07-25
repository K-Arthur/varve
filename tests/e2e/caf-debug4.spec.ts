import { test } from '@playwright/test';
import { readFileSync } from 'fs';
import path from 'path';
import { navigateToEditor } from './shared';

test('direct CAF dialog access via evaluate', async ({ page }) => {
  page.on('pageerror', (err) => console.log('PAGE ERROR:', err.message));

  await navigateToEditor(page);

  // Drop an image
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

  await page.waitForTimeout(2000);

  // First click canvas to try to select the image
  await page.mouse.click(box.x + 170, box.y + 170);
  await page.waitForTimeout(500);

  // Now directly set cafDialogNodeId in the React state
  // We find the state by walking the React container fiber
  const result = await page.evaluate(() => {
    const root = document.querySelector('#root');
    if (!root) return { error: 'no root' };

    // Try __reactContainer$ prefix (React 18+)
    let key = Object.keys(root).find((k) => k.startsWith('__reactContainer$'));
    if (!key) {
      key = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
    }
    if (!key)
      return {
        error: 'no fiber key',
        keys: Object.keys(root)
          .filter((k) => k.startsWith('__react'))
          .slice(0, 5),
      };

    let fiber = (root as any)[key];
    let depth = 0;

    // Helper to walk hooks (linked list)
    function walkHooks(hook: any, cb: (hook: any) => boolean): boolean {
      let h = hook;
      while (h) {
        if (cb(h)) return true;
        h = h.next;
      }
      return false;
    }

    while (fiber && depth < 1000) {
      // Check if this fiber has EditorState
      if (fiber.memoizedState) {
        let foundState: any = null;
        let foundNodeId: string | null = null;

        walkHooks(fiber.memoizedState, (hook) => {
          if (hook.queue && hook.queue.lastRenderedState) {
            const st = hook.queue.lastRenderedState;
            if (st && typeof st === 'object' && st.document && st.document.nodes) {
              // Found the editor state!
              foundState = st;

              // Find an image node
              const nodeIds = Object.keys(st.document.nodes);
              for (const id of nodeIds) {
                const n = st.document.nodes[id];
                if (n && n.kind === 'shape' && n.fills) {
                  const hasImageFill = n.fills.some((f: any) => f.type === 'image' && f.image?.src);
                  if (hasImageFill) {
                    foundNodeId = id;
                    break;
                  }
                }
              }
              return true;
            }
          }
          return false;
        });

        if (foundState && foundNodeId) {
          // Set cafDialogNodeId on the state
          // We need to find the setState function
          // Use React's internal dispatch
          return {
            success: true,
            nodeId: foundNodeId,
            hasDocument: true,
            nodeCount: Object.keys(foundState.document.nodes).length,
          };
        }
      }

      fiber = fiber.child || fiber.sibling || fiber.return;
      depth++;
    }

    return { error: 'not found', depth };
  });

  console.log('State search result:', JSON.stringify(result));

  if (result && result.success) {
    // Try to set cafDialogNodeId via React state
    await page.evaluate((nodeId: string) => {
      const root = document.querySelector('#root');
      if (!root) return;

      // Find the editor state fiber and set cafDialogNodeId
      const key =
        Object.keys(root).find((k) => k.startsWith('__reactContainer$')) ||
        Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
      if (!key) return;

      let fiber = (root as any)[key];
      let depth = 0;

      function walkHooks(hook: any, cb: (hook: any) => boolean): boolean {
        let h = hook;
        while (h) {
          if (cb(h)) return true;
          h = h.next;
        }
        return false;
      }

      while (fiber && depth < 1000) {
        if (fiber.memoizedState) {
          let foundState: any = null;
          let setState: any = null;

          walkHooks(fiber.memoizedState, (hook) => {
            if (hook.queue && hook.queue.lastRenderedState) {
              const st = hook.queue.lastRenderedState;
              if (
                st &&
                typeof st === 'object' &&
                st.document &&
                st.document.nodes &&
                st.document.nodes[nodeId]
              ) {
                foundState = st;
                // Get the dispatch function from the queue
                setState = hook.queue.dispatch;
                return true;
              }
            }
            return false;
          });

          if (foundState && setState) {
            setState({ cafDialogNodeId: nodeId, selectedNodeIds: [nodeId] });
            return;
          }
        }

        fiber = fiber.child || fiber.sibling || fiber.return;
        depth++;
      }
    }, result.nodeId);

    await page.waitForTimeout(500);

    // Check if dialog is open
    const dialog = page.locator('dialog.strata-dialog--caf[open]');
    const isOpen = await dialog.isVisible().catch(() => false);
    console.log('CAF dialog open after dispatch:', isOpen);

    if (isOpen) {
      await dialog.waitFor({ state: 'visible', timeout: 5000 });
      console.log('CAF dialog is now visible!');

      // Check title
      const title = dialog.locator('#caf-dialog-title');
      console.log('Dialog title:', await title.textContent());

      // Check various controls
      const modeFast = dialog.locator('input[name="caf-quality"][value="fast"]');
      console.log('Fast mode radio checked:', await modeFast.isChecked());

      const slider = dialog.locator('#caf-dialog-brush');
      console.log('Brush slider value:', await slider.inputValue());
    }
  }
});
