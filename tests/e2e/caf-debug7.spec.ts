import { readFileSync } from 'node:fs';
import path from 'node:path';
import { test } from '@playwright/test';
import { navigateToEditor } from './shared';

test('open CAF dialog by rendering it directly', async ({ page }) => {
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

  await page.waitForTimeout(2000);

  // Get root React container key more robustly
  const rootInfo = await page.evaluate(() => {
    const r = document.querySelector('#root') as any;
    const reactKeys = Object.keys(r).filter((k) => k.startsWith('__react'));
    // Also try on document.body or the app container
    const bodyKeys = Object.keys(document.body).filter((k) => k.startsWith('__react'));
    const appRoot = document.querySelector('#root > *') as any;
    const childKeys = appRoot ? Object.keys(appRoot).filter((k) => k.startsWith('__react')) : [];
    return { rootKeys: reactKeys, bodyKeys, childKeys };
  });
  console.log('React keys:', JSON.stringify(rootInfo, null, 2));

  // Try the react container approach with a more robust walk
  const result = await page.evaluate(() => {
    const r = document.querySelector('#root') as any;
    const containerKey = Object.keys(r).find((k) => k.startsWith('__reactContainer$'));
    const fiberKey = Object.keys(r).find((k) => k.startsWith('__reactFiber$'));
    const key: string = containerKey ?? fiberKey ?? '';
    if (!key) return { error: 'no key' };

    const fiber = r[key];
    const seen = new Set<any>();
    let depth = 0;

    // Walk siblings AND children AND return path
    function walk(f: any): any {
      if (!f || seen.has(f) || depth > 5000) return null;
      seen.add(f);
      depth++;

      // Check hooks
      let hook = f.memoizedState;
      while (hook) {
        if (hook.queue) {
          const st = hook.queue.lastRenderedState;
          if (st && typeof st === 'object' && st.document?.nodes) {
            // Found editor state. Try to call patch.
            // The patch function wraps setState. It's passed to sub-contexts.
            const nodeIds = Object.keys(st.document.nodes);
            let imageNodeId = null;
            for (const id of nodeIds) {
              const n = st.document.nodes[id];
              if (n?.kind === 'shape' && n.fills?.some((f: any) => f.type === 'image')) {
                imageNodeId = id;
                break;
              }
            }
            if (imageNodeId) {
              // Direct setState through React's own dispatch
              hook.queue.dispatch((prev: any) => ({ ...prev, cafDialogNodeId: imageNodeId }));
              return { success: true, nodeId: imageNodeId, depth, key: key.substring(0, 25) };
            }
          }
        }
        hook = hook.next;
      }

      // Walk children THEN siblings (DFS, but not return)
      for (const nextFiber of [f.child, f.sibling]) {
        if (nextFiber) {
          const r2 = walk(nextFiber);
          if (r2) return r2;
        }
      }
      return null;
    }

    return walk(fiber) || { error: 'not found', depth };
  });

  console.log('Result:', JSON.stringify(result));
  await page.waitForTimeout(1000);

  // Check for dialog
  const dialogExists = await page.evaluate(() => {
    return !!document.querySelector('dialog.varve-dialog--caf');
  });
  console.log('Dialog element exists in DOM:', dialogExists);

  const dialogOpen = await page.evaluate(() => {
    const d = document.querySelector('dialog.varve-dialog--caf') as HTMLDialogElement | null;
    return d?.open ?? false;
  });
  console.log('Dialog open:', dialogOpen);

  // Also check all dialog elements
  const allDialogs = await page.evaluate(() => {
    return Array.from(document.querySelectorAll('dialog')).map((d) => ({
      className: d.className,
      open: d.open,
      hasChild: d.children.length > 0,
    }));
  });
  console.log('All dialogs:', JSON.stringify(allDialogs));
});
