import { expect, test } from '@playwright/test';
import { navigateToEditor, seedLayers } from '../shared';

async function editorMethod(
  page: import('@playwright/test').Page,
  method: string,
  ...args: unknown[]
) {
  return page.evaluate(
    ({ method, args }) => {
      const root = document.getElementById('root');
      if (!root) throw new Error('React root not found');
      const key = Object.keys(root).find(
        (name) => name.startsWith('__reactContainer$') || name.startsWith('__reactFiber$'),
      );
      if (!key) throw new Error('React fiber not found');
      function find(fiber: any): any {
        if (!fiber) return null;
        const value = fiber.memoizedProps?.value;
        if (typeof value?.serializeDocument === 'function') return value;
        return find(fiber.child) || find(fiber.sibling);
      }
      const editor = find((root as any)[key]);
      if (!editor || typeof editor[method] !== 'function') {
        throw new Error(`Missing editor method: ${method}`);
      }
      return editor[method](...args);
    },
    { method, args },
  );
}

test('a live browser paste event transfers an editable layer and renders it', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  await navigateToEditor(page);
  await seedLayers(page, 1);

  const sourceRow = page.getByRole('treeitem').first();
  await sourceRow.click();
  const sourceId = await sourceRow.getAttribute('data-node-id');
  expect(sourceId).toBeTruthy();
  const sourceNode = await editorMethod(page, 'getNode', sourceId);
  expect(sourceNode).toBeTruthy();

  await page.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'application/vnd.varve+json',
      JSON.stringify({
        format: 'varve-clipboard',
        version: 1,
        rootIds: [(node as { id: string }).id],
        nodes: [node],
      }),
    );
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    window.dispatchEvent(event);
  }, sourceNode);

  await expect(page.getByRole('treeitem')).toHaveCount(2);
  await expect(page.locator('[role="treeitem"].layers-row--selected')).toHaveCount(1);
  await page.getByTestId('editor-canvas').screenshot({
    path: testInfo.outputPath('clipboard-pasted-canvas.png'),
  });
});

test('pasting with a frame selected adopts the layer inside that frame', async ({ page }) => {
  test.setTimeout(300000);
  await navigateToEditor(page);
  await seedLayers(page, 1);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('f');
  await page.mouse.move(box.x + 420, box.y + 120);
  await page.mouse.down();
  await page.mouse.move(box.x + 620, box.y + 320);
  await page.mouse.up();
  await page.waitForTimeout(150);

  const before = JSON.parse((await editorMethod(page, 'serializeDocument')) as string) as {
    nodes: Record<string, { id: string; kind: string; w?: number; h?: number }>;
  };
  const sourceNode = Object.values(before.nodes).find((node) => node.kind === 'shape');
  const frameNode = Object.values(before.nodes).find((node) => node.kind === 'frame');
  expect(sourceNode).toBeTruthy();
  expect(frameNode).toBeTruthy();
  if (!sourceNode || !frameNode) throw new Error('expected source shape and target frame');

  await editorMethod(page, 'setSelection', frameNode.id);
  await page.waitForTimeout(50);
  await page.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'application/vnd.varve+json',
      JSON.stringify({ format: 'varve-clipboard', version: 1, nodes: [node] }),
    );
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    window.dispatchEvent(event);
  }, sourceNode);

  await expect(page.getByRole('treeitem')).toHaveCount(3);
  const after = JSON.parse((await editorMethod(page, 'serializeDocument')) as string) as {
    nodes: Record<string, { id: string; kind: string; children?: string[] }>;
  };
  const pastedId = Object.keys(after.nodes).find((id) => !before.nodes[id]);
  expect(pastedId).toBeTruthy();
  expect(after.nodes[frameNode.id]?.children).toContain(pastedId);
  const pastedNode = await editorMethod(page, 'getNode', pastedId);
  const pastedBounds = await editorMethod(page, 'nodeWorldBounds', pastedNode);
  const frameBounds = await editorMethod(page, 'nodeWorldBounds', frameNode);
  expect(pastedBounds).toBeTruthy();
  expect(frameBounds).toBeTruthy();
  const pastedRect = pastedBounds as { x: number; y: number; w: number; h: number };
  const frameRect = frameBounds as { x: number; y: number; w: number; h: number };
  expect(pastedRect.x + pastedRect.w / 2).toBeCloseTo(frameRect.x + frameRect.w / 2, 3);
  expect(pastedRect.y + pastedRect.h / 2).toBeCloseTo(frameRect.y + frameRect.h / 2, 3);
});

test('legacy paste centers on the visible viewport with a rotated, panned camera', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  await navigateToEditor(page);
  await seedLayers(page, 1);

  const before = JSON.parse((await editorMethod(page, 'serializeDocument')) as string) as {
    nodes: Record<string, { id: string; kind: string }>;
  };
  const sourceNode = Object.values(before.nodes).find((node) => node.kind === 'shape');
  expect(sourceNode).toBeTruthy();
  if (!sourceNode) throw new Error('expected source shape');

  await editorMethod(page, 'setSelection', null);
  await editorMethod(page, 'setCamera', {
    zoom: 0.75,
    pan: { x: 180, y: -120 },
    rotation: Math.PI / 6,
  });
  await page.waitForTimeout(100);
  const viewport = await page.locator('.editor-canvas').evaluate((element) => ({
    width: (element as HTMLElement).clientWidth,
    height: (element as HTMLElement).clientHeight,
  }));
  const expectedCenter = await editorMethod(
    page,
    'canvasToWorld',
    viewport.width / 2,
    viewport.height / 2,
  );

  await page.evaluate((node) => {
    const transfer = new DataTransfer();
    transfer.setData(
      'application/vnd.varve+json',
      JSON.stringify({ format: 'varve-clipboard', version: 1, nodes: [node] }),
    );
    const event = new Event('paste', { bubbles: true, cancelable: true });
    Object.defineProperty(event, 'clipboardData', { value: transfer });
    window.dispatchEvent(event);
  }, sourceNode);

  await expect(page.getByRole('treeitem')).toHaveCount(2);
  const after = JSON.parse((await editorMethod(page, 'serializeDocument')) as string) as {
    nodes: Record<string, { id: string; kind: string }>;
  };
  const pastedId = Object.keys(after.nodes).find((id) => !before.nodes[id]);
  expect(pastedId).toBeTruthy();
  if (!pastedId) throw new Error('expected a pasted node');
  const pastedNode = await editorMethod(page, 'getNode', pastedId);
  const bounds = await editorMethod(page, 'nodeWorldBounds', pastedNode);
  expect(bounds).toBeTruthy();
  const pastedBounds = bounds as { x: number; y: number; w: number; h: number };
  expect(pastedBounds.x + pastedBounds.w / 2).toBeCloseTo(expectedCenter.x, 3);
  expect(pastedBounds.y + pastedBounds.h / 2).toBeCloseTo(expectedCenter.y, 3);
  await page.getByTestId('editor-canvas').screenshot({
    path: testInfo.outputPath('clipboard-viewport-centered.png'),
  });
});
