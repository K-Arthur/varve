import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';
import { navigateToEditor, switchWorkspace } from '../shared';

const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const GENERATED_FIXTURES_DIR = path.join(tmpdir(), `varve-caf-${process.pid}`);
const CAF_PNG = path.join(GENERATED_FIXTURES_DIR, 'caf-test.png');
const CAF_4K_PNG = path.join(GENERATED_FIXTURES_DIR, 'caf-4k.png');
const REAL_LIFE_FIXTURES = [
  { path: path.join(FIXTURES_DIR, 'real-life-landscape.jpg'), slug: 'landscape' },
  { path: path.join(FIXTURES_DIR, 'real-life-portrait.jpg'), slug: 'portrait' },
  { path: path.join(FIXTURES_DIR, 'real-life-still-life.jpg'), slug: 'still-life' },
] as const;
const ADDITIONAL_REAL_LIFE_FIXTURES = [
  { path: path.join(FIXTURES_DIR, 'real-life-architecture.jpg'), slug: 'architecture' },
  { path: path.join(FIXTURES_DIR, 'real-life-interior-room.jpg'), slug: 'interior-room' },
  { path: path.join(FIXTURES_DIR, 'real-life-glass-reflection.jpg'), slug: 'glass-reflection' },
  { path: path.join(FIXTURES_DIR, 'real-life-glasses-reflection.jpg'), slug: 'glasses-reflection' },
  { path: path.join(FIXTURES_DIR, 'real-life-braided-portrait.jpg'), slug: 'braided-portrait' },
  { path: path.join(FIXTURES_DIR, 'real-life-smithsonian.jpg'), slug: 'smithsonian' },
  {
    path: path.join(FIXTURES_DIR, 'real-life-wainwright-building.jpg'),
    slug: 'wainwright-building',
  },
  { path: path.join(FIXTURES_DIR, 'real-life-brookings-hall.jpg'), slug: 'brookings-hall' },
] as const;

// ── Minimal PNG generator (no pngjs required) ──────────────────────────────

let crcTable: Int32Array | null = null;
function crc32(buf: Buffer, off = 0, len = buf.length - off): number {
  if (!crcTable) {
    crcTable = new Int32Array(256);
    for (let n = 0; n < 256; n++) {
      let c = n;
      for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
      crcTable[n] = c;
    }
  }
  let crc = -1;
  for (let i = off; i < off + len; i++) crc = crcTable![(crc ^ buf[i]!) & 0xff]! ^ (crc >>> 8);
  return (crc ^ -1) >>> 0;
}

function pngChunk(type: string, data: Buffer): Buffer {
  const len = Buffer.alloc(4);
  len.writeUInt32BE(data.length);
  const typeB = Buffer.from(type, 'ascii');
  const crcData = Buffer.concat([typeB, data]);
  const crc = Buffer.alloc(4);
  crc.writeUInt32BE(crc32(crcData));
  return Buffer.concat([len, typeB, data, crc]);
}

function createPngBuffer(
  width: number,
  height: number,
  getPixel: (x: number, y: number) => [number, number, number, number],
): Buffer {
  const raw = Buffer.alloc(width * 4);
  const scanlines: Buffer[] = [];
  for (let y = 0; y < height; y++) {
    for (let x = 0; x < width; x++) {
      const [r, g, b, a] = getPixel(x, y);
      raw[x * 4] = r;
      raw[x * 4 + 1] = g;
      raw[x * 4 + 2] = b;
      raw[x * 4 + 3] = a;
    }
    scanlines.push(Buffer.concat([Buffer.from([0]), Buffer.from(raw)]));
  }
  const compressed = deflateSync(Buffer.concat(scanlines), { level: 9 });
  const ihdr = Buffer.alloc(13);
  ihdr.writeUInt32BE(width, 0);
  ihdr.writeUInt32BE(height, 4);
  ihdr[8] = 8;
  ihdr[9] = 6;
  ihdr[10] = 0;
  ihdr[11] = 0;
  ihdr[12] = 0;
  return Buffer.concat([
    Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]),
    pngChunk('IHDR', ihdr),
    pngChunk('IDAT', compressed),
    pngChunk('IEND', Buffer.alloc(0)),
  ]);
}

// ── Fixture setup ──────────────────────────────────────────────────────────

test.beforeAll(() => {
  if (!existsSync(GENERATED_FIXTURES_DIR)) mkdirSync(GENERATED_FIXTURES_DIR, { recursive: true });
  const cx = 32,
    cy = 32,
    r = 21;
  writeFileSync(
    CAF_PNG,
    createPngBuffer(64, 64, (x, y) => {
      const inCircle = Math.sqrt((x - cx) ** 2 + (y - cy) ** 2) < r;
      return inCircle ? [255, 0, 0, 255] : [255, 255, 255, 255];
    }),
  );
  writeFileSync(
    CAF_4K_PNG,
    createPngBuffer(4288, 4288, (x, y) => {
      const isDark = ((x >> 5) + (y >> 5)) % 2 === 0;
      return isDark ? [80, 120, 200, 255] : [200, 180, 100, 255];
    }),
  );
});

test.afterAll(() => {
  rmSync(GENERATED_FIXTURES_DIR, { recursive: true, force: true });
});

// ── Helpers ────────────────────────────────────────────────────────────────

/**
 * Walk the React fiber tree to find the EditorState, then dispatch an
 * update to open (or close) the CAF dialog for the given node.
 */
async function triggerCafDialog(
  page: import('@playwright/test').Page,
  nodeId: string | null,
): Promise<void> {
  await page.evaluate((nid) => {
    const rootEl = document.querySelector('#root > *') as any;
    if (!rootEl) return;
    const fiberKey = Object.keys(rootEl).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) return;
    const seen = new Set<any>();
    (function walk(f: any): void {
      if (!f || seen.has(f)) return;
      seen.add(f);
      let hook = f.memoizedState;
      while (hook) {
        if (hook.queue) {
          const st = hook.queue.lastRenderedState;
          if (st && typeof st === 'object' && st.document?.nodes) {
            hook.queue.dispatch((prev: any) => ({ ...prev, cafDialogNodeId: nid }));
            return;
          }
        }
        hook = hook.next;
      }
      for (const nextFiber of [f.child, f.sibling]) {
        if (nextFiber) walk(nextFiber);
      }
    })(rootEl[fiberKey]);
  }, nodeId);
  await page.waitForTimeout(300);
}

async function readEditorDocument(page: import('@playwright/test').Page): Promise<any> {
  return page.evaluate(() => {
    const rootEl = document.querySelector('#root > *') as any;
    if (!rootEl) throw new Error('editor root not found');
    const fiberKey = Object.keys(rootEl).find((key) => key.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('editor fiber not found');
    const seen = new Set<any>();
    let documentState: any = null;
    (function walk(fiber: any): void {
      if (!fiber || seen.has(fiber) || documentState) return;
      seen.add(fiber);
      let hook = fiber.memoizedState;
      while (hook) {
        if (hook.queue) {
          const state = hook.queue.lastRenderedState;
          if (state?.document?.nodes) {
            documentState = state.document;
            return;
          }
        }
        hook = hook.next;
      }
      for (const nextFiber of [fiber.child, fiber.sibling]) walk(nextFiber);
    })(rootEl[fiberKey]);
    if (!documentState) throw new Error('editor document state not found');
    return documentState;
  });
}

async function openGenerativeEditFromAdjustments(
  page: import('@playwright/test').Page,
): Promise<void> {
  const sectionToggle = page.getByRole('button', { name: 'Generative Edit', exact: true });
  await expect(sectionToggle).toBeVisible({ timeout: 10_000 });
  if ((await sectionToggle.getAttribute('aria-expanded')) !== 'true') {
    await sectionToggle.click();
  }
  await page.getByRole('button', { name: 'Open Generative Edit dialog' }).click();
}

/**
 * Drop a PNG onto the canvas, then wait for the shape to appear in the
 * layers panel and click it to ensure it is selected.  Returns the node ID.
 */
async function dropImageAndSelect(
  page: import('@playwright/test').Page,
  imagePath = CAF_PNG,
  dropPoint: { x: number; y: number } = { x: 150, y: 150 },
): Promise<string> {
  const imageBuffer = readFileSync(imagePath);
  const base64 = imageBuffer.toString('base64');
  const imageType = path.extname(imagePath).toLowerCase() === '.jpg' ? 'image/jpeg' : 'image/png';
  const imageName = path.basename(imagePath);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  const treeItems = page.getByRole('treeitem');
  const countBefore = await treeItems.count();

  await page.evaluate(
    ({ cX, cY, b64, name, type }) => {
      const binaryStr = atob(b64);
      const bytes = new Uint8Array(binaryStr.length);
      for (let i = 0; i < binaryStr.length; i++) bytes[i] = binaryStr.charCodeAt(i);
      const transfer = new DataTransfer();
      transfer.items.add(new File([bytes], name, { type }));
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
    {
      cX: box.x + dropPoint.x,
      cY: box.y + dropPoint.y,
      b64: base64,
      name: imageName,
      type: imageType,
    },
  );

  await expect.poll(() => treeItems.count(), { timeout: 60_000 }).toBeGreaterThan(countBefore);
  await page.mouse.click(box.x + dropPoint.x + 25, box.y + dropPoint.y + 25);
  await page.waitForTimeout(300);

  // Recover the node id from the fiber tree
  const nodeId = await page.evaluate(() => {
    const rootEl = document.querySelector('#root > *') as any;
    const fiberKey = Object.keys(rootEl).find((k) => k.startsWith('__reactFiber$'));
    if (!fiberKey) throw new Error('no fiber');
    const seen = new Set<any>();
    let found: string | null = null;
    (function walk(f: any): void {
      if (!f || seen.has(f) || found) return;
      seen.add(f);
      let hook = f.memoizedState;
      while (hook) {
        if (hook.queue) {
          const st = hook.queue.lastRenderedState;
          if (st && typeof st === 'object' && st.document?.nodes) {
            for (const id of Object.keys(st.document.nodes).reverse()) {
              const n = st.document.nodes[id];
              if (n?.kind === 'shape' && n.fills?.some((fi: any) => fi.type === 'image')) {
                found = id;
                return;
              }
            }
          }
        }
        hook = hook.next;
      }
      for (const nf of [f.child, f.sibling]) if (nf) walk(nf);
    })(rootEl[fiberKey]);
    return found;
  });
  if (!nodeId) throw new Error('could not find image node id');
  return nodeId;
}

/** Paint a stroke on the CAF mask canvas. */
async function paintMaskStroke(page: import('@playwright/test').Page): Promise<void> {
  const maskCanvas = page.locator('canvas.caf-dialog__mask-canvas');
  await maskCanvas.waitFor({ state: 'visible', timeout: 5000 });
  const box = await maskCanvas.boundingBox();
  if (!box) throw new Error('mask canvas not found');
  const sy = box.y + box.height * 0.5;
  await page.mouse.move(box.x + box.width * 0.3, sy);
  await page.mouse.down();
  await page.mouse.move(Math.round((box.x + box.width * 0.3 + box.x + box.width * 0.7) / 2), sy);
  await page.mouse.move(box.x + box.width * 0.7, sy);
  await page.mouse.up();
  await page.waitForTimeout(200);
}

/**
 * Inspect the persisted bounded overlay rather than accepting a screenshot
 * or metadata-only result as evidence of generation. A successful no-op
 * result has no visible overlay pixels; a flat placeholder is also rejected
 * by the colour-bucket check on the real photograph.
 */
async function inspectBoundedOverlay(
  page: import('@playwright/test').Page,
  sourceUrl: string,
  overlayUrl: string,
  frame: { x: number; y: number; width: number; height: number },
  sourceWidth: number,
  sourceHeight: number,
): Promise<{ nonTransparentPixels: number; changedPixels: number; uniqueColorBuckets: number }> {
  return page.evaluate(
    async ({ sourceUrl, overlayUrl, frame, sourceWidth, sourceHeight }) => {
      const decode = (url: string): Promise<ImageData> =>
        new Promise((resolve, reject) => {
          const image = new Image();
          image.onload = () => {
            const canvas = document.createElement('canvas');
            canvas.width = image.naturalWidth;
            canvas.height = image.naturalHeight;
            const context = canvas.getContext('2d');
            if (!context) {
              reject(new Error('overlay-check canvas is unavailable'));
              return;
            }
            context.drawImage(image, 0, 0);
            resolve(context.getImageData(0, 0, canvas.width, canvas.height));
          };
          image.onerror = () => reject(new Error('overlay-check image decode failed'));
          image.src = url;
        });
      const source = await decode(sourceUrl);
      const overlay = await decode(overlayUrl);
      if (overlay.width !== frame.width || overlay.height !== frame.height) {
        throw new Error(
          `Overlay dimensions ${overlay.width}x${overlay.height} do not match its ${frame.width}x${frame.height} frame`,
        );
      }
      let nonTransparentPixels = 0;
      let changedPixels = 0;
      const colors = new Set<number>();
      for (let y = 0; y < overlay.height; y += 1) {
        for (let x = 0; x < overlay.width; x += 1) {
          const overlayOffset = (y * overlay.width + x) * 4;
          if (overlay.data[overlayOffset + 3]! <= 8) continue;
          nonTransparentPixels += 1;
          colors.add(
            (overlay.data[overlayOffset]! >> 4) * 256 +
              (overlay.data[overlayOffset + 1]! >> 4) * 16 +
              (overlay.data[overlayOffset + 2]! >> 4),
          );
          const sourceX = frame.x + x;
          const sourceY = frame.y + y;
          if (
            sourceX < 0 ||
            sourceY < 0 ||
            sourceX >= sourceWidth ||
            sourceY >= sourceHeight ||
            sourceX >= source.width ||
            sourceY >= source.height
          ) {
            continue;
          }
          const sourceOffset = (sourceY * source.width + sourceX) * 4;
          const delta =
            Math.abs(overlay.data[overlayOffset]! - source.data[sourceOffset]!) +
            Math.abs(overlay.data[overlayOffset + 1]! - source.data[sourceOffset + 1]!) +
            Math.abs(overlay.data[overlayOffset + 2]! - source.data[sourceOffset + 2]!);
          if (delta >= 12) changedPixels += 1;
        }
      }
      return { nonTransparentPixels, changedPixels, uniqueColorBuckets: colors.size };
    },
    { sourceUrl, overlayUrl, frame, sourceWidth, sourceHeight },
  );
}

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Content-Aware Fill dialog', () => {
  test.describe.configure({ mode: 'serial' });
  // Each test touches the editor repeatedly; give Vite/HMR time to settle.
  test.setTimeout(240_000);

  // Shared setup: navigate to editor, drop an image, and capture its node ID.
  let nodeId: string;

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    nodeId = await dropImageAndSelect(page);
  });

  test('opens the CAF dialog from editor state', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();
  });

  test('dialog renders with correct title and controls', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();

    await expect(dialog.locator('#caf-dialog-title')).toContainText('Content-Aware Fill');
    // Radio inputs are visually hidden (opacity:0); check their visible label wrappers
    await expect(dialog.locator('.caf-dialog__quality-btn').first()).toBeVisible();
    await expect(dialog.locator('.caf-dialog__quality-label')).toHaveCount(2);
    await expect(dialog.locator('#caf-dialog-brush')).toBeVisible();
    await expect(dialog.locator('.caf-dialog__checkbox')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /clear paint/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /remove && fill/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^cancel$/i })).toBeVisible();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeVisible();
    await expect(dialog.locator('.varve-dialog__close')).toBeVisible();
    await expect(dialog.locator('canvas.caf-dialog__preview-canvas')).toBeVisible();
  });

  test('generative mode surface holds up on real photographic sources', async ({ page }) => {
    for (const fixture of REAL_LIFE_FIXTURES) {
      const photographicNodeId = await dropImageAndSelect(page, fixture.path);
      await triggerCafDialog(page, photographicNodeId);
      const dialog = page.locator('dialog.varve-dialog--caf[open]');
      await expect(dialog.getByRole('tab')).toHaveCount(4);
      const previewBacking = await dialog
        .locator('canvas.caf-dialog__preview-canvas')
        .first()
        .evaluate((element) => {
          const canvas = element as HTMLCanvasElement;
          return { width: canvas.width, height: canvas.height };
        });
      expect(previewBacking.width * previewBacking.height).toBeLessThanOrEqual(4_000_000);
      await expect(dialog.getByRole('tab', { name: 'Remove' })).toHaveAttribute(
        'aria-selected',
        'true',
      );
      for (const name of ['Use Pixel Selection', 'Use Layer Mask', 'Use Image Alpha', 'Invert']) {
        const control = dialog.getByRole('button', { name });
        await control.scrollIntoViewIfNeeded();
        await expect(control).toBeVisible();
      }
      for (const [id, value] of [
        ['#caf-dialog-mask-expansion', '0'],
        ['#caf-dialog-mask-feather', '0'],
        ['#caf-dialog-context-padding', '32'],
      ] as const) {
        const control = dialog.locator(id);
        await control.scrollIntoViewIfNeeded();
        await expect(control).toHaveValue(value);
      }
      await dialog.locator('.caf-dialog__left').evaluate((element) => {
        element.scrollTop = 0;
      });

      await dialog.getByRole('tab', { name: 'Fill' }).click();
      await expect(dialog.locator('#caf-dialog-prompt')).toBeVisible();
      await expect(dialog.locator('#caf-dialog-provider-note')).toContainText('Local processing');

      await dialog.getByRole('tab', { name: 'Replace' }).click();
      await expect(dialog.locator('#caf-dialog-prompt')).toBeVisible();
      await expect(
        dialog.locator('button.varve-btn--secondary').filter({ hasText: /^replace$/i }),
      ).toBeDisabled();
      await dialog.getByRole('tab', { name: 'Expand' }).click();
      await expect(dialog.locator('#caf-dialog-prompt')).toBeVisible();
      await expect(dialog.getByRole('button', { name: /^expand$/i })).toBeDisabled();
      await expect(dialog).toHaveScreenshot(`generative-edit-${fixture.slug}.png`, {
        animations: 'disabled',
        // Chromium can vary the final antialiasing samples at the rounded
        // dialog corners between isolated runs. The real-photo controls and
        // capability assertions above remain exact; keep this tolerance
        // below the threshold at which a UI regression could pass unnoticed.
        maxDiffPixels: 4,
      });

      await dialog.getByRole('button', { name: /^cancel$/i }).click();
      await expect(dialog).not.toBeVisible();
    }
  });

  test('additional real photographic sources remain usable', async ({ page }) => {
    for (const fixture of ADDITIONAL_REAL_LIFE_FIXTURES) {
      const photographicNodeId = await dropImageAndSelect(page, fixture.path);
      await triggerCafDialog(page, photographicNodeId);
      const dialog = page.locator('dialog.varve-dialog--caf[open]');
      await expect(dialog.getByRole('tab')).toHaveCount(4);
      await expect(dialog.getByRole('button', { name: 'Use Pixel Selection' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Use Layer Mask' })).toBeVisible();
      await expect(dialog.getByRole('button', { name: 'Use Image Alpha' })).toBeVisible();
      await expect(dialog.locator('canvas.caf-dialog__mask-canvas')).toBeVisible();
      await expect(dialog).toHaveScreenshot(`generative-edit-${fixture.slug}.png`, {
        animations: 'disabled',
      });
      await dialog.getByRole('button', { name: /^cancel$/i }).click();
      await expect(dialog).not.toBeVisible();
    }
  });

  test('mask painting canvas is interactive', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeDisabled();

    await paintMaskStroke(page);

    const clearBtn = page.getByRole('button', { name: /clear paint/i });
    await expect(clearBtn).toBeEnabled();
    await expect(generateBtn).toBeEnabled();
  });

  test('uses source image alpha as an editable mask source', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await dialog.getByRole('button', { name: 'Use Image Alpha' }).click();
    await expect(dialog).toContainText('Using the source image alpha channel.');
    await expect(page.getByRole('button', { name: /remove && fill/i })).toBeEnabled();
  });

  test('quality mode selection works', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');

    // Fast is default (its wrapper label gets the --active class)
    await expect(dialog.locator('.caf-dialog__quality-btn--active')).toHaveCount(1);

    // Click the AI label to switch
    const aiLabel = dialog.locator('.caf-dialog__quality-btn').nth(1);
    await aiLabel.click();
    await expect(dialog.locator('.caf-dialog__quality-btn--active')).toHaveCount(1);
    // The radio inputs are visually hidden but their checked state follows
    const aiRadio = dialog.locator('input[name="caf-quality"][value="ai"]');
    const fastRadio = dialog.locator('input[name="caf-quality"][value="fast"]');
    await expect(aiRadio).toBeChecked();
    await expect(fastRadio).not.toBeChecked();

    // Click the Fast label to switch back
    const fastLabel = dialog.locator('.caf-dialog__quality-btn').first();
    await fastLabel.click();
    await expect(fastRadio).toBeChecked();
    await expect(aiRadio).not.toBeChecked();
  });

  test('Cancel button closes the dialog without changes', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();
    await paintMaskStroke(page);

    await page.getByRole('button', { name: /^cancel$/i }).click();
    await page.waitForTimeout(200);
    await expect(dialog).not.toBeVisible();
  });

  test('Close button (X) closes the dialog', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();

    await dialog.locator('.varve-dialog__close').click();
    await page.waitForTimeout(200);
    await expect(dialog).not.toBeVisible();
  });

  test('Brush size slider adjusts brush value', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');

    const brushLabel = dialog.locator('label[for="caf-dialog-brush"]');
    await expect(brushLabel).toContainText('28');

    const slider = dialog.locator('#caf-dialog-brush');
    await expect(slider).toHaveValue('28');

    // Dispatch a synthetic React input event to set the slider to 50
    await slider.evaluate((el) => {
      const nativeSetter = Object.getOwnPropertyDescriptor(
        window.HTMLInputElement.prototype,
        'value',
      )!.set!;
      nativeSetter.call(el, '50');
      el.dispatchEvent(new Event('input', { bubbles: true }));
    });
    await page.waitForTimeout(100);

    await expect(slider).toHaveValue('50');
    await expect(brushLabel).toContainText('50');
  });

  test('preview zoom controls support precise editing at multiple scales', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');

    await expect(dialog.locator('.caf-dialog__zoom-value')).toHaveText('Fit');
    const fitStage = dialog.locator('.caf-dialog__preview-stage');
    const fitSize = await fitStage.boundingBox();
    expect(fitSize?.width).toBeGreaterThan(0);
    expect(fitSize?.height).toBeGreaterThan(0);
    await dialog.getByRole('button', { name: 'Zoom in' }).click();
    await expect(dialog.locator('.caf-dialog__zoom-value')).toHaveText('125%');
    await expect(dialog.locator('.caf-dialog__preview-area')).toHaveClass(/--zoom/);
    const zoomedSize = await fitStage.boundingBox();
    expect(zoomedSize?.width).toBeGreaterThan(fitSize?.width ?? 0);
    expect(zoomedSize?.height).toBeGreaterThan(fitSize?.height ?? 0);

    await dialog.getByRole('button', { name: 'Zoom out' }).click();
    await expect(dialog.locator('.caf-dialog__zoom-value')).toHaveText('100%');
    await expect(dialog.getByRole('button', { name: 'Center preview' })).toBeVisible();

    await dialog.getByRole('button', { name: 'Fit', exact: true }).click();
    await expect(dialog.locator('.caf-dialog__zoom-value')).toHaveText('Fit');

    await dialog.getByRole('button', { name: '1:1', exact: true }).click();
    await expect(dialog.locator('.caf-dialog__zoom-value')).toHaveText('100%');
  });

  test('Clear Paint button clears the mask', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const clearBtn = page.getByRole('button', { name: /clear paint/i });
    await expect(clearBtn).toBeDisabled();

    await paintMaskStroke(page);
    await expect(clearBtn).toBeEnabled();

    await clearBtn.click();
    await expect(clearBtn).toBeDisabled();

    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeDisabled();
  });

  test('Generate button is disabled when no mask is painted', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeDisabled();
  });

  test('Apply button replaces the image in place after fill (fast mode)', async ({ page }) => {
    const historyWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('updateDoc called outside transaction')) {
        historyWarnings.push(message.text());
      }
    });
    await triggerCafDialog(page, nodeId);
    await paintMaskStroke(page);

    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Fast mode uses pure-JS patch matching — no model download required.
    // After success the button text changes to "Regenerate" and Apply is enabled.
    const applyBtn = page.getByRole('button', { name: /^apply$/i });

    await expect(applyBtn).toBeEnabled({ timeout: 10_000 });

    // Apply the result
    await applyBtn.click();
    await page.locator('dialog.varve-dialog--caf[open]').waitFor({
      state: 'hidden',
      timeout: 5000,
    });

    // Generative acceptance preserves the existing layer identity and layout.
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
    await expect(page.locator('[role="treeitem"][aria-selected="true"]')).toHaveCount(1);
    expect(historyWarnings).toEqual([]);
  });

  test('duplicates an accepted generative result as a separate layer', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    await paintMaskStroke(page);
    await page.getByRole('button', { name: /remove && fill/i }).click();
    await page
      .getByRole('button', { name: /^apply$/i })
      .waitFor({ state: 'visible', timeout: 10_000 });
    await page.getByRole('button', { name: /^apply$/i }).click();
    await page
      .locator('dialog.varve-dialog--caf[open]')
      .waitFor({ state: 'hidden', timeout: 5000 });

    // The image-processing sections are owned by Photo mode.  Keep this
    // assertion on the same user-visible route as the AI Tools handoff shown
    // outside that workspace instead of relying on an internal dialog state.
    await switchWorkspace(page, 'Photo');
    await page.getByRole('tab', { name: 'Adjustments' }).click();
    const sectionToggle = page.getByRole('button', { name: 'Generative Edit', exact: true });
    await expect(sectionToggle).toBeVisible({ timeout: 10_000 });
    if ((await sectionToggle.getAttribute('aria-expanded')) !== 'true') {
      await sectionToggle.click();
    }
    const duplicateButton = page.getByRole('button', {
      name: 'Duplicate generative result as layer',
    });
    await expect(duplicateButton).toBeVisible();
    await duplicateButton.click();

    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 5000 });
    await expect(page.getByRole('treeitem', { name: /Generative Edit Copy/i })).toBeVisible();

    const duplicatedDocument = await readEditorDocument(page);
    const generativeNodes = Object.values(duplicatedDocument.nodes).filter(
      (candidate: any) => candidate?.generativeEditId,
    ) as Array<{ id: string; generativeEditId: string }>;
    expect(generativeNodes).toHaveLength(2);
    expect(generativeNodes[0]?.generativeEditId).not.toBe(generativeNodes[1]?.generativeEditId);
    const duplicateNode = generativeNodes.find((candidate) => candidate.id !== nodeId);
    expect(duplicateNode).toBeTruthy();
    expect(
      duplicatedDocument.generativeEdits?.[duplicateNode!.generativeEditId]?.sourceNodeId,
    ).toBe(duplicateNode!.id);
  });

  test('reopens an accepted edit with its saved recipe and mask', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await paintMaskStroke(page);

    const expansion = dialog.locator('#caf-dialog-mask-expansion');
    await expansion.evaluate((element) => {
      const input = element as HTMLInputElement;
      const setter = Object.getOwnPropertyDescriptor(window.HTMLInputElement.prototype, 'value')!
        .set!;
      setter.call(input, '8');
      input.dispatchEvent(new Event('input', { bubbles: true }));
      input.dispatchEvent(new Event('change', { bubbles: true }));
    });
    await expect(expansion).toHaveValue('8');
    await dialog.getByRole('button', { name: /remove && fill/i }).click();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeEnabled({
      timeout: 30_000,
    });
    await dialog.getByRole('button', { name: /^apply$/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 5000 });

    await switchWorkspace(page, 'Photo');
    await page.getByRole('tab', { name: 'Adjustments' }).click();
    await openGenerativeEditFromAdjustments(page);
    const reopened = page.locator('dialog.varve-dialog--caf[open]');
    await expect(reopened).toBeVisible();
    await expect(reopened.getByRole('tab', { name: 'Remove' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await expect(reopened.locator('#caf-dialog-mask-expansion')).toHaveValue('8');
    await expect(reopened).toContainText('Using the accepted edit mask.');
    await expect(reopened.getByRole('button', { name: 'Delete variation 1' })).toBeDisabled();
    await expect(reopened.getByRole('button', { name: /^apply$/i })).toBeEnabled({
      timeout: 10_000,
    });
    await reopened.getByRole('button', { name: /^cancel$/i }).click();
  });

  test('applies a real photographic edit in place and retains its source recipe', async ({
    page,
  }, testInfo) => {
    const photographicNodeId = await dropImageAndSelect(
      page,
      path.join(FIXTURES_DIR, 'real-life-landscape.jpg'),
      { x: 400, y: 300 },
    );
    const before = await readEditorDocument(page);
    const beforeNode = before.nodes[photographicNodeId];
    const sourceAssetId = beforeNode?.fills?.find((fill: any) => fill.type === 'image')?.image
      ?.assetId;
    expect(sourceAssetId).toBeTruthy();

    await triggerCafDialog(page, photographicNodeId);
    await paintMaskStroke(page);
    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    const applyBtn = page.getByRole('button', { name: /^apply$/i });
    await expect(applyBtn).toBeEnabled({ timeout: 30_000 });
    await page.locator('dialog.varve-dialog--caf[open]').screenshot({
      path: testInfo.outputPath('real-landscape-remove-result.png'),
      animations: 'disabled',
    });
    await applyBtn.click();
    await page.locator('dialog.varve-dialog--caf[open]').waitFor({
      state: 'hidden',
      timeout: 5000,
    });

    const after = await readEditorDocument(page);
    const afterNode = after.nodes[photographicNodeId];
    expect(afterNode).toBeTruthy();
    expect(afterNode.generativeEditId).toBeTruthy();
    const edit = after.generativeEdits?.[afterNode.generativeEditId];
    expect(edit?.mode).toBe('remove');
    expect(edit?.provider.id).toBe('varve-quick-cleanup');
    expect(edit?.sourceSnapshotAssetId).toBe(sourceAssetId);
    expect(after.assets?.[sourceAssetId]).toBeTruthy();
    expect(after.assets?.[sourceAssetId]?.dataUrl).toBe(before.assets?.[sourceAssetId]?.dataUrl);
    expect(afterNode.fills?.find((fill: any) => fill.type === 'image')?.image?.assetId).toBe(
      sourceAssetId,
    );
    expect(edit?.variations).toHaveLength(1);
    expect(after.assets?.[edit.variations[0].assetId]).toBeTruthy();

    const variation = edit.variations[0];
    const overlayAsset = after.assets?.[variation.assetId];
    const overlayStats = await inspectBoundedOverlay(
      page,
      after.assets?.[sourceAssetId].dataUrl,
      overlayAsset.dataUrl,
      variation.outputFrame,
      after.assets?.[sourceAssetId].naturalWidth,
      after.assets?.[sourceAssetId].naturalHeight,
    );
    expect(variation.assetKind).toBe('region-overlay');
    expect(overlayStats.nonTransparentPixels).toBeGreaterThan(100);
    expect(overlayStats.changedPixels).toBeGreaterThan(100);
    expect(overlayStats.uniqueColorBuckets).toBeGreaterThan(8);

    const fitAllButton = page.getByRole('button', { name: 'Fit all to viewport' });
    await expect(fitAllButton).toBeVisible({ timeout: 10_000 });
    await fitAllButton.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: testInfo.outputPath('real-landscape-applied.png') });
  });

  test('applies promptless Fill to a real photograph with substantive output', async ({
    page,
  }, testInfo) => {
    const photographicNodeId = await dropImageAndSelect(
      page,
      path.join(FIXTURES_DIR, 'real-life-still-life.jpg'),
      { x: 400, y: 300 },
    );
    await triggerCafDialog(page, photographicNodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await dialog.getByRole('tab', { name: 'Fill', exact: true }).click();
    await paintMaskStroke(page);

    const generateBtn = dialog
      .locator('button.varve-btn--secondary')
      .filter({ hasText: /^fill$/i });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeEnabled({
      timeout: 30_000,
    });
    await dialog.screenshot({ path: testInfo.outputPath('real-still-life-fill-result.png') });
    await dialog.getByRole('button', { name: /^apply$/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });

    const after = await readEditorDocument(page);
    const node = after.nodes[photographicNodeId];
    const edit = after.generativeEdits?.[node.generativeEditId];
    expect(edit?.mode).toBe('fill');
    expect(edit?.provider.id).toBe('varve-quick-cleanup');
    const variation = edit.variations[0];
    const sourceAsset = after.assets?.[edit.sourceSnapshotAssetId];
    const overlayAsset = after.assets?.[variation.assetId];
    expect(sourceAsset?.dataUrl).toBeTruthy();
    expect(overlayAsset?.dataUrl).toBeTruthy();
    const overlayStats = await inspectBoundedOverlay(
      page,
      sourceAsset.dataUrl,
      overlayAsset.dataUrl,
      variation.outputFrame,
      sourceAsset.naturalWidth,
      sourceAsset.naturalHeight,
    );
    expect(variation.assetKind).toBe('region-overlay');
    expect(overlayStats.nonTransparentPixels).toBeGreaterThan(100);
    expect(overlayStats.changedPixels).toBeGreaterThan(100);
    expect(overlayStats.uniqueColorBuckets).toBeGreaterThan(8);
  });

  test('bounds a small edit on the 33 MP real portrait fixture', async ({ page }, testInfo) => {
    const photographicNodeId = await dropImageAndSelect(
      page,
      path.join(FIXTURES_DIR, 'real-life-portrait.jpg'),
      { x: 400, y: 300 },
    );
    const before = await readEditorDocument(page);
    const beforeNode = before.nodes[photographicNodeId];
    const sourceAssetId = beforeNode?.fills?.find((fill: any) => fill.type === 'image')?.image
      ?.assetId;
    expect(sourceAssetId).toBeTruthy();
    const sourceAsset = before.assets?.[sourceAssetId];
    expect(sourceAsset.naturalWidth * sourceAsset.naturalHeight).toBeGreaterThan(16_777_216);

    await triggerCafDialog(page, photographicNodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await paintMaskStroke(page);
    await dialog.getByRole('button', { name: /remove && fill/i }).click();
    await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeEnabled({ timeout: 30_000 });
    await dialog.screenshot({ path: testInfo.outputPath('real-portrait-bounded-result.png') });
    await dialog.getByRole('button', { name: /^apply$/i }).click();
    await dialog.waitFor({ state: 'hidden', timeout: 10_000 });

    const after = await readEditorDocument(page);
    const afterNode = after.nodes[photographicNodeId];
    const edit = after.generativeEdits?.[afterNode.generativeEditId];
    const contextAsset = after.assets?.[edit.variations[0].contextAssetId];
    expect(edit.provider.id).toBe('varve-quick-cleanup');
    expect(contextAsset.naturalWidth * contextAsset.naturalHeight).toBeLessThan(
      sourceAsset.naturalWidth * sourceAsset.naturalHeight,
    );
    expect(edit.masks.width * edit.masks.height).toBeLessThanOrEqual(4_000_000);
    expect(edit.masks.offsetX).toBeGreaterThanOrEqual(0);
    expect(edit.masks.offsetY).toBeGreaterThanOrEqual(0);
    expect(edit.outputFrame.sourceWidth).toBe(sourceAsset.naturalWidth);
    expect(edit.outputFrame.sourceHeight).toBe(sourceAsset.naturalHeight);
    const userMaskAsset = after.rasterMaskAssets?.[edit.maskAssetId];
    expect(userMaskAsset?.width).toBe(sourceAsset.naturalWidth);
    expect(userMaskAsset?.height).toBe(sourceAsset.naturalHeight);
    expect(edit.maskWidth).toBe(sourceAsset.naturalWidth);
    expect(edit.maskHeight).toBe(sourceAsset.naturalHeight);
    expect(edit.masks.userWidth).toBe(sourceAsset.naturalWidth);
    expect(edit.masks.userHeight).toBe(sourceAsset.naturalHeight);
    const fills = afterNode?.fills?.filter((fill: any) => fill.type === 'image') ?? [];
    expect(fills).toHaveLength(2);
    expect(fills[0]?.image?.assetId).toBe(sourceAssetId);
    expect(fills[1]?.image?.generativeEditOverlay).toMatchObject({
      editId: afterNode.generativeEditId,
      variationId: edit.acceptedVariationId,
    });
    expect(fills[1]?.image?.fit).toBe('crop');
    expect(fills[1]?.image?.imageWidth).toBeGreaterThan(0);
    expect(fills[1]?.image?.imageHeight).toBeGreaterThan(0);
    await page.screenshot({ path: testInfo.outputPath('real-portrait-bounded-applied.png') });
  });

  test('retains earlier bounded edits when a real photograph is edited twice', async ({
    page,
  }, testInfo) => {
    const photographicNodeId = await dropImageAndSelect(
      page,
      path.join(FIXTURES_DIR, 'real-life-landscape.jpg'),
      { x: 400, y: 300 },
    );

    let editNumber = 0;
    const applyBoundedEdit = async () => {
      await triggerCafDialog(page, photographicNodeId);
      const dialog = page.locator('dialog.varve-dialog--caf[open]');
      const editMaskButton = dialog.getByRole('button', { name: 'Edit mask', exact: true });
      const maskCanvas = dialog.locator('canvas.caf-dialog__mask-canvas');
      await expect
        .poll(
          async () => {
            if (await editMaskButton.isVisible().catch(() => false)) return 'result';
            if (await maskCanvas.isVisible().catch(() => false)) return 'mask';
            return 'loading';
          },
          { timeout: 15_000 },
        )
        .toMatch(/^(result|mask)$/);
      if (await editMaskButton.isVisible().catch(() => false)) await editMaskButton.click();
      await paintMaskStroke(page);
      await dialog.getByRole('button', { name: /remove && fill/i }).click();
      await expect(dialog.getByRole('button', { name: /^apply$/i })).toBeEnabled({
        timeout: 30_000,
      });
      editNumber += 1;
      if (editNumber === 2) {
        await dialog.screenshot({
          path: testInfo.outputPath('real-landscape-repeated-result.png'),
        });
      }
      await dialog.getByRole('button', { name: /^apply$/i }).click();
      await dialog.waitFor({ state: 'hidden', timeout: 10_000 });
    };

    await applyBoundedEdit();
    const firstDocument = await readEditorDocument(page);
    const firstNode = firstDocument.nodes[photographicNodeId];
    const firstEditId = firstNode.generativeEditId;
    const firstEdit = firstDocument.generativeEdits?.[firstEditId];
    expect(firstEditId).toBeTruthy();
    expect(firstEdit?.parentEditId).toBeUndefined();
    expect(firstNode.fills.filter((fill: any) => fill.type === 'image')).toHaveLength(2);

    await applyBoundedEdit();
    const secondDocument = await readEditorDocument(page);
    const secondNode = secondDocument.nodes[photographicNodeId];
    const secondEditId = secondNode.generativeEditId;
    const secondEdit = secondDocument.generativeEdits?.[secondEditId];
    const imageFills = secondNode.fills.filter((fill: any) => fill.type === 'image');
    expect(secondEditId).toBeTruthy();
    expect(secondEditId).not.toBe(firstEditId);
    expect(secondEdit?.parentEditId).toBe(firstEditId);
    expect(imageFills).toHaveLength(3);
    expect(imageFills[1]?.image?.generativeEditOverlay?.editId).toBe(firstEditId);
    expect(imageFills[2]?.image?.generativeEditOverlay?.editId).toBe(secondEditId);
    expect(imageFills[1]?.image?.assetId).toBeTruthy();
    expect(imageFills[2]?.image?.assetId).toBeTruthy();
    await page.screenshot({ path: testInfo.outputPath('real-landscape-repeated-applied.png') });
  });

  test('undo reverts the CAF apply operation', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    await paintMaskStroke(page);

    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await generateBtn.click();

    const applyBtn = page.getByRole('button', { name: /^apply$/i });
    await expect(applyBtn).toBeEnabled({ timeout: 10_000 });

    const layerCountBefore = await page.getByRole('treeitem').count();
    await applyBtn.click();
    await page.locator('dialog.varve-dialog--caf[open]').waitFor({
      state: 'hidden',
      timeout: 5000,
    });
    await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore, { timeout: 10_000 });

    // Undo (Ctrl+Z)
    await page.keyboard.press('Control+z');
    await page.waitForTimeout(300);
    await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore, { timeout: 10_000 });
  });

  test('reopens the CAF dialog after closing', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const dialog = page.locator('dialog.varve-dialog--caf[open]');
    await expect(dialog).toBeVisible();

    // Close via Cancel
    await page.getByRole('button', { name: /^cancel$/i }).click();
    await expect(dialog).not.toBeVisible();

    // Reopen using the same nodeId
    await triggerCafDialog(page, nodeId);
    await expect(dialog).toBeVisible();

    // Verify controls are in initial state (brush reset to 28)
    const brushLabel = dialog.locator('label[for="caf-dialog-brush"]');
    await expect(brushLabel).toContainText('28');
  });
});
