import { readFileSync } from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from './shared';

test.describe('CAF debug', () => {
  test('open dialog directly via evaluate', async ({ page }) => {
    // Collect console errors
    const errors: string[] = [];
    page.on('pageerror', (err) => errors.push(err.message));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });

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

    // Check what nodes exist in the document via evaluate
    const docState = await page.evaluate(() => {
      const root = document.querySelector('#root');
      if (!root) return { error: 'no root' };
      const key = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
      if (!key)
        return {
          error: 'no fiber',
          keys: Object.keys(root).filter((k) => k.startsWith('__react')),
        };

      // Walk fiber tree to find state
      let fiber = (root as any)[key];
      let foundState: any = null;
      let depth = 0;
      while (fiber && depth < 100) {
        if (fiber.memoizedState?.queue) {
          const queue = fiber.memoizedState.queue;
          if (
            queue.lastRenderedState &&
            typeof queue.lastRenderedState === 'object' &&
            queue.lastRenderedState.document
          ) {
            foundState = queue.lastRenderedState;
            break;
          }
        }
        fiber = fiber.child || fiber.sibling || fiber.return;
        depth++;
      }
      if (!foundState) return { error: 'no state found' };

      const nodeIds = Object.keys(foundState.document?.nodes || {});
      const selIds = foundState.selectedNodeIds || [];

      return {
        selectedIds: selIds,
        nodeCount: nodeIds.length,
        nodes: nodeIds.slice(0, 5).map((id) => ({
          id,
          kind: foundState.document.nodes[id]?.kind,
          fills: foundState.document.nodes[id]?.fills,
          shape: foundState.document.nodes[id]?.shape?.kind,
        })),
        cafDialogNodeId: foundState.cafDialogNodeId,
      };
    });

    console.log('Doc state:', JSON.stringify(docState, null, 2));

    // Check if tabs are available
    const tabs = await page.evaluate(() => {
      const tablist = document.querySelector('[role="tablist"][aria-label="Inspector tabs"]');
      if (!tablist) return { error: 'no tablist' };
      const tabs = Array.from(tablist.querySelectorAll('[role="tab"]'));
      return {
        tabCount: tabs.length,
        tabNames: tabs.map((t) => t.textContent?.trim()),
      };
    });
    console.log('Tabs:', JSON.stringify(tabs, null, 2));

    // Check if there's a Properties panel rendered
    const hasProperties = await page.evaluate(() => {
      const section = document.querySelector('.editor-inspector');
      return {
        exists: !!section,
        innerText: section?.querySelector('.insp-panel__tabs')?.textContent?.substring(0, 200),
        panels: Array.from(section?.querySelectorAll('[role="tabpanel"]') || []).map((p) => p.id),
      };
    });
    console.log('Properties panel:', JSON.stringify(hasProperties, null, 2));

    // Try to find and click "Open Content-Aware Fill" button directly
    const cafBtn = page.locator('button').filter({ hasText: /open content-aware fill/i });
    const cafBtnCount = await cafBtn.count();
    console.log('CAF buttons found:', cafBtnCount);

    if (cafBtnCount > 0) {
      await cafBtn.first().click();
      await page
        .locator('dialog.strata-dialog--caf[open]')
        .waitFor({ state: 'visible', timeout: 5000 });
      await expect(page.locator('dialog.strata-dialog--caf[open]')).toBeVisible();
      console.log('CAF dialog opened successfully!');
    } else {
      // Try direct approach: evaluate openCafDialog
      const result = await page.evaluate(() => {
        const root = document.querySelector('#root');
        if (!root) return { error: 'no root' };
        const key = Object.keys(root).find((k) => k.startsWith('__reactFiber$'));
        if (!key) return { error: 'no fiber key' };

        let fiber = (root as any)[key];
        let depth = 0;
        while (fiber && depth < 200) {
          if (fiber.memoizedState?.queue) {
            const queue = fiber.memoizedState.queue;
            if (queue.lastRenderedState && typeof queue.lastRenderedState === 'object') {
              // Check if this fiber has a return that provides openCafDialog
            }
          }
          // Check hooks
          let hook = fiber.memoizedState;
          while (hook) {
            if (hook.queue?.lastRenderedState?.selectedNodeIds) {
              // Found EditorState
              // Look for the openCafDialog function
              const fiberReturn = fiber.return;
              if (fiberReturn) {
                // Check if the parent component can provide it
              }
              break;
            }
            hook = hook.next;
          }
          fiber = fiber.child || fiber.sibling || fiber.return;
          depth++;
        }
        return { error: 'could not find openCafDialog', depth };
      });
      console.log('Direct open result:', JSON.stringify(result));
    }

    if (errors.length > 0) {
      console.log('Page errors:', errors.join('\n'));
    }
  });
});
