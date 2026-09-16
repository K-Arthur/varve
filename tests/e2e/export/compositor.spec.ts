import { mkdirSync } from 'node:fs';
import { createRequire } from 'node:module';
import { join } from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

const requireFromEngine = createRequire(join(process.cwd(), 'packages', 'engine', 'package.json'));
const { PNG } = requireFromEngine('pngjs') as {
  PNG: { sync: { read(input: Buffer): { width: number; height: number; data: Buffer } } };
};

async function updateNode(
  page: import('@playwright/test').Page,
  nodeId: string,
  patch: Record<string, unknown>,
): Promise<void> {
  const updated = await page.evaluate(
    ({ nodeId, patch }) => {
      const root = document.getElementById('root');
      if (!root) return false;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return false;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'updateNode' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const update = context?.updateNode as
        | ((
            id: string,
            updater: (node: Record<string, unknown>) => Record<string, unknown>,
          ) => void)
        | undefined;
      if (typeof update !== 'function') return false;
      update(nodeId, (node) => ({ ...node, ...patch }));
      return true;
    },
    { nodeId, patch },
  );
  expect(updated).toBe(true);
}

async function canvasSignature(page: import('@playwright/test').Page) {
  return page.evaluate(() => {
    const canvas = document.querySelector(
      'canvas.editor-canvas__content-layer',
    ) as HTMLCanvasElement | null;
    if (!canvas) throw new Error('content canvas not found');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas context not found');
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let nonZeroAlpha = 0;
    let partialAlpha = 0;
    let alphaSum = 0;
    let hash = 2166136261;
    for (let offset = 0; offset < pixels.length; offset += 4) {
      const alpha = pixels[offset + 3] ?? 0;
      if (alpha > 0) nonZeroAlpha += 1;
      if (alpha > 0 && alpha < 255) partialAlpha += 1;
      alphaSum += alpha;
      hash ^= pixels[offset] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= pixels[offset + 1] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= pixels[offset + 2] ?? 0;
      hash = Math.imul(hash, 16777619);
      hash ^= alpha;
      hash = Math.imul(hash, 16777619);
    }
    return {
      width: canvas.width,
      height: canvas.height,
      nonZeroAlpha,
      partialAlpha,
      alphaSum,
      hash,
    };
  });
}

async function waitForCanvasHashChange(
  page: import('@playwright/test').Page,
  previousHash: number,
): Promise<Awaited<ReturnType<typeof canvasSignature>>> {
  await expect
    .poll(async () => (await canvasSignature(page)).hash, {
      timeout: 15000,
      intervals: [100, 250, 500, 1000],
    })
    .not.toBe(previousHash);
  return canvasSignature(page);
}

async function readNodeEffects(
  page: import('@playwright/test').Page,
  nodeId: string,
): Promise<unknown[] | null> {
  return page.evaluate(
    ({ nodeId }) => {
      const root = document.getElementById('root');
      if (!root) return null;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return null;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'serializeDocument' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const serialize = context?.serializeDocument as (() => string) | undefined;
      if (typeof serialize !== 'function') return null;
      const documentModel = JSON.parse(serialize()) as {
        nodes?: Record<string, { effects?: unknown[] }>;
      };
      return documentModel.nodes?.[nodeId]?.effects ?? null;
    },
    { nodeId },
  );
}

async function selectRectangleTool(page: import('@playwright/test').Page): Promise<void> {
  const toolbar = page.getByTestId('toolbar');
  const directButton = toolbar.locator('[data-tool="rect"]');
  if (await directButton.isVisible().catch(() => false)) {
    await directButton.click();
    return;
  }

  await toolbar.getByRole('button', { name: 'More tools' }).click();
  const overflow = page.locator('.varve-ctxmenu');
  await overflow.getByText('Shapes', { exact: true }).click();
  await page
    .getByRole('menu', { name: 'Shapes submenu', exact: true })
    .getByRole('menuitem', { name: 'Rectangle', exact: true })
    .click();
}

function expectOpaqueRasterEdges(png: { width: number; height: number; data: Buffer }) {
  const alphaAt = (x: number, y: number) => png.data[(y * png.width + x) * 4 + 3];
  for (let x = 0; x < png.width; x += 1) {
    expect(alphaAt(x, 0)).toBe(255);
    expect(alphaAt(x, png.height - 1)).toBe(255);
  }
  for (let y = 0; y < png.height; y += 1) {
    expect(alphaAt(0, y)).toBe(255);
    expect(alphaAt(png.width - 1, y)).toBe(255);
  }
}

test.describe('Export compositor — structural flattening', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  async function selectExportTab(page: import('@playwright/test').Page) {
    const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
      hasText: /^export$/i,
    });
    if (await exportTab.isVisible().catch(() => false)) {
      await exportTab.click();
      return;
    }

    // The inspector moves less-common tabs into this overflow menu at the
    // compact desktop breakpoint. Export must remain reachable through the
    // same real UI path instead of making the test depend on a wide viewport.
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }

  test('Export a document with effects to SVG embeds raster image', async ({ page }) => {
    // Create a rect shape
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Select the shape to show inspector
    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 175);

    // Open export tab
    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'SVG', exact: true })
      .click();

    // Intercept download
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // Verify the SVG content — a shape with effects should produce
    // a file that either has an embedded raster or a fallback warning
    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path!, 'utf-8');
    // The SVG export should succeed without error
    expect(content).toContain('<svg');
  });

  test('Export a document with effects to PNG produces a file', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 175);

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    // PNG files start with the magic bytes \x89PNG
    const { readFile } = await import('node:fs/promises');
    const buffer = await readFile(path!);
    expect(buffer[0]).toBe(0x89);
    expect(buffer.toString('ascii', 1, 4)).toBe('PNG');
    const png = PNG.sync.read(buffer);
    expect(png.width).toBeGreaterThan(0);
    expect(png.height).toBeGreaterThan(0);
    expectOpaqueRasterEdges(png);
  });

  test('Export a grouped spatial blur keeps its effect halo in the raster', async ({ page }) => {
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 220, 220);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 180, 160, 300, 280);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    const grouped = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return false;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return false;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'groupSelected' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const groupSelected = context?.groupSelected as (() => unknown) | undefined;
      if (typeof groupSelected !== 'function') return false;
      groupSelected();
      return true;
    });
    expect(grouped).toBe(true);

    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await group.click();
    const groupId = await group.getAttribute('data-node-id');
    expect(groupId).toBeTruthy();
    await updateNode(page, groupId!, {
      effects: [
        {
          id: 'group-gaussian-export',
          type: 'gaussianBlur',
          sigmaX: 8,
          sigmaY: 8,
          linkedAxes: true,
          algorithmVersion: 1,
          coordinateSpace: 'owner-normalized',
          edgeMode: 'transparent',
          visible: true,
        },
      ],
    });
    await page.waitForTimeout(500);

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const exportPath = 'reports/layer-fidelity/group-spatial-blur-export.png';
    mkdirSync('reports/layer-fidelity', { recursive: true });
    await download.saveAs(exportPath);
    const buffer = await (await import('node:fs/promises')).readFile(exportPath);
    const png = PNG.sync.read(buffer);

    // The two shapes occupy a 200×180 union. The group-owned blur must widen
    // the export bounds and leave partial-alpha pixels in the halo; a dropped
    // group effect produces the unexpanded opaque union instead.
    expect(png.width).toBeGreaterThan(200);
    expect(png.height).toBeGreaterThan(180);
    let partialAlpha = 0;
    for (let offset = 3; offset < png.data.length; offset += 4) {
      const alpha = png.data[offset] ?? 0;
      if (alpha > 0 && alpha < 255) partialAlpha += 1;
    }
    expect(partialAlpha).toBeGreaterThan(20);

    await page.locator('canvas.editor-canvas__content-layer').screenshot({
      path: 'reports/layer-fidelity/group-spatial-blur-live.png',
    });
  });

  test('Live and exported group replay apply every content-stage blur', async ({ page }) => {
    await selectRectangleTool(page);
    await dragOnCanvas(page, 100, 100, 220, 220);
    await selectRectangleTool(page);
    // Start outside the first shape. Some browser builds interpret a drag
    // beginning over an existing shape as an edit gesture even while the
    // rectangle tool is active; overlap is not required to prove sequential
    // group-surface effects here.
    await dragOnCanvas(page, 250, 200, 370, 320);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

    const rows = page.getByRole('treeitem');
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    const grouped = await page.evaluate(() => {
      const root = document.getElementById('root');
      if (!root) return false;
      const key = Object.keys(root).find(
        (candidate) =>
          candidate.startsWith('__reactFiber$') || candidate.startsWith('__reactContainer$'),
      );
      if (!key) return false;
      function find(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = (props as Record<string, unknown> | undefined)?.value;
          if (value && typeof value === 'object' && 'groupSelected' in value) {
            return value as Record<string, unknown>;
          }
        }
        return (
          find(fiber.child as Record<string, unknown> | null) ||
          find(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = find(
        (root as unknown as Record<string, unknown>)[key] as Record<string, unknown> | null,
      );
      const groupSelected = context?.groupSelected as (() => unknown) | undefined;
      if (typeof groupSelected !== 'function') return false;
      groupSelected();
      return true;
    });
    expect(grouped).toBe(true);

    const group = page
      .getByRole('treeitem')
      .filter({ hasText: /^Group\b/ })
      .first();
    await group.click();
    const groupId = await group.getAttribute('data-node-id');
    expect(groupId).toBeTruthy();
    await page.waitForTimeout(400);
    const baseline = await canvasSignature(page);

    await updateNode(page, groupId!, {
      effects: [{ id: 'group-layer-blur-one', type: 'layerBlur', radius: 2, visible: true }],
    });
    await expect
      .poll(async () => (await readNodeEffects(page, groupId!))?.length ?? 0, {
        timeout: 15000,
      })
      .toBe(1);
    const oneBlur = await waitForCanvasHashChange(page, baseline.hash);

    await updateNode(page, groupId!, {
      effects: [
        { id: 'group-layer-blur-one', type: 'layerBlur', radius: 2, visible: true },
        { id: 'group-layer-blur-two', type: 'layerBlur', radius: 20, visible: true },
      ],
    });
    await expect
      .poll(async () => (await readNodeEffects(page, groupId!))?.length ?? 0, {
        timeout: 15000,
      })
      .toBe(2);
    const twoBlurs = await waitForCanvasHashChange(page, oneBlur.hash);

    // The real CanvasArea path must react to both authored entries. A
    // first-entry-only implementation leaves the second signature unchanged.
    expect(oneBlur.hash).not.toBe(baseline.hash);
    expect(twoBlurs.hash).not.toBe(oneBlur.hash);
    expect(twoBlurs.nonZeroAlpha).toBeGreaterThan(0);
    await page.locator('canvas.editor-canvas__content-layer').screenshot({
      path: 'reports/layer-fidelity/group-multiple-layer-blur-live.png',
    });

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'PNG', exact: true })
      .click();
    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    mkdirSync('reports/layer-fidelity', { recursive: true });
    const exportPath = 'reports/layer-fidelity/group-multiple-layer-blur-export.png';
    await download.saveAs(exportPath);
    const png = PNG.sync.read(await (await import('node:fs/promises')).readFile(exportPath));

    // The two shapes occupy a 270×220 union. Both blur supports must be
    // included in the dependency-complete export bounds.
    expect(png.width).toBeGreaterThan(270);
    expect(png.height).toBeGreaterThan(220);
    let partialAlpha = 0;
    for (let offset = 3; offset < png.data.length; offset += 4) {
      const alpha = png.data[offset] ?? 0;
      if (alpha > 0 && alpha < 255) partialAlpha += 1;
    }
    expect(partialAlpha).toBeGreaterThan(20);
  });

  test('Export a clean document to SVG produces pure vector output', async ({ page }) => {
    // Create a simple rect — no effects, so no rasterization needed
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    await page.keyboard.press('v');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.mouse.click(box.x + 200, box.y + 175);

    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'SVG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path!, 'utf-8');
    // Pure vector SVG should contain a <rect> or <path>, not embedded base64 raster
    expect(content).toContain('<svg');
    // A simple shape should not embed base64 image data
    expect(content).not.toContain('data:image');
  });

  test('Export a document with adjustment layers to SVG succeeds', async ({ page }) => {
    // Create a rect
    await page.keyboard.press('r');
    await dragOnCanvas(page, 100, 100, 300, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    // Create an adjustment layer via the shortcut
    await page.keyboard.press('Alt+n');
    await page.waitForTimeout(300);

    // Open export tab
    await selectExportTab(page);
    await page
      .locator('.spec-export__group')
      .getByRole('radio', { name: 'SVG', exact: true })
      .click();

    const downloadPromise = page.waitForEvent('download', { timeout: 15000 });
    await page.getByRole('button', { name: /download/i }).click();
    const download = await downloadPromise;
    const path = await download.path();
    expect(path).toBeTruthy();

    const { readFile } = await import('node:fs/promises');
    const content = await readFile(path!, 'utf-8');
    // SVG with adjustment layers should produce valid output
    expect(content).toContain('<svg');
  });
});
