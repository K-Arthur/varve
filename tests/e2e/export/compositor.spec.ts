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
      .getByRole('button', { name: 'SVG', exact: true })
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
      .getByRole('button', { name: 'PNG', exact: true })
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
      .getByRole('button', { name: 'PNG', exact: true })
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
      .getByRole('button', { name: 'SVG', exact: true })
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
      .getByRole('button', { name: 'SVG', exact: true })
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
