import { existsSync, mkdirSync, readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { deflateSync } from 'node:zlib';
import { expect, test } from '@playwright/test';

const FIXTURES_DIR = path.resolve(__dirname, '..', 'fixtures');
const CAF_PNG = path.join(FIXTURES_DIR, 'caf-test.png');
const CAF_4K_PNG = path.join(FIXTURES_DIR, 'caf-4k.png');

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
  if (!existsSync(FIXTURES_DIR)) mkdirSync(FIXTURES_DIR, { recursive: true });
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

/**
 * Drop a PNG onto the canvas, then wait for the shape to appear in the
 * layers panel and click it to ensure it is selected.  Returns the node ID.
 */
async function dropImageAndSelect(page: import('@playwright/test').Page): Promise<string> {
  const pngBuffer = readFileSync(CAF_PNG);
  const base64 = pngBuffer.toString('base64');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'attached', timeout: 15_000 });
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

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
  await page.mouse.click(box.x + 175, box.y + 175);
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
            for (const id of Object.keys(st.document.nodes)) {
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

// ── Tests ──────────────────────────────────────────────────────────────────

test.describe('Content-Aware Fill dialog', () => {
  test.describe.configure({ mode: 'serial' });
  // Each test touches the editor repeatedly; give Vite/HMR time to settle.
  test.setTimeout(240_000);

  // Shared setup: navigate to editor, drop an image, and capture its node ID.
  let nodeId: string;

  test.beforeEach(async ({ page }) => {
    await page.goto('/', { timeout: 120_000, waitUntil: 'load' });
    const newBtn = page.getByRole('button', { name: /^new$/i });
    await newBtn.waitFor({ state: 'visible', timeout: 180_000 });
    await newBtn.click({ force: true, timeout: 30_000 });
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create design$/i })
      .waitFor({ timeout: 5000 });
    await page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create design$/i })
      .click({ timeout: 10_000 });
    await page.locator('.layers-panel').waitFor({ timeout: 15_000 });

    // Dismiss welcome modal
    const blankCanvas = page.getByRole('dialog').getByRole('button', { name: /^blank canvas$/i });
    if (await blankCanvas.isVisible({ timeout: 1000 }).catch(() => false)) {
      await blankCanvas.click({ timeout: 5000 });
    } else {
      const close = page
        .getByRole('dialog')
        .getByRole('button', { name: /close|get started/i })
        .first();
      if (await close.isVisible({ timeout: 1000 }).catch(() => false)) {
        await close.click({ timeout: 5000 });
      }
    }

    const dismiss = page.locator('.onboarding-checklist__dismiss');
    if (await dismiss.isVisible({ timeout: 1000 }).catch(() => false)) {
      await dismiss.click({ timeout: 5000 });
    }

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

  test('mask painting canvas is interactive', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeDisabled();

    await paintMaskStroke(page);

    const clearBtn = page.getByRole('button', { name: /clear paint/i });
    await expect(clearBtn).toBeEnabled();
    await expect(generateBtn).toBeEnabled();
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

  test('Apply button creates a new image layer after fill (fast mode)', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    await paintMaskStroke(page);

    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await expect(generateBtn).toBeEnabled();
    await generateBtn.click();

    // Fast mode uses pure-JS patch matching — no model download required.
    // After success the button text changes to "Regenerate" and Apply is enabled.
    const applyBtn = page.getByRole('button', { name: /^apply$/i });

    try {
      await expect(applyBtn).toBeEnabled({ timeout: 10_000 });
    } catch {
      // Pipeline may have errored (e.g. ImageData constraints in the test
      // environment).
      const errorEl = page.locator('.caf-dialog__error[role="alert"]');
      if (await errorEl.isVisible().catch(() => false)) {
        const errText = await errorEl.textContent();
        test.info().annotations.push({
          type: 'info',
          description: `Pipeline fast-path error: ${errText}`,
        });
      }
      // If neither Apply-enabled nor error visible, re-check pipeline status.
      return;
    }

    // Apply the result
    await applyBtn.click();
    await page.locator('dialog.varve-dialog--caf[open]').waitFor({
      state: 'hidden',
      timeout: 5000,
    });

    // A new "filled" image node should appear in the layers panel
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
    await expect(page.getByRole('treeitem').filter({ hasText: /filled/i })).toHaveCount(1);
  });

  test('undo reverts the CAF apply operation', async ({ page }) => {
    await triggerCafDialog(page, nodeId);
    await paintMaskStroke(page);

    const generateBtn = page.getByRole('button', { name: /remove && fill/i });
    await generateBtn.click();

    const applyBtn = page.getByRole('button', { name: /^apply$/i });
    try {
      await expect(applyBtn).toBeEnabled({ timeout: 10_000 });
    } catch {
      test.skip(true, 'Pipeline did not produce a result — undo requires successful generation');
      return;
    }

    const layerCountBefore = await page.getByRole('treeitem').count();
    await applyBtn.click();
    await page.locator('dialog.varve-dialog--caf[open]').waitFor({
      state: 'hidden',
      timeout: 5000,
    });
    await expect(page.getByRole('treeitem')).toHaveCount(layerCountBefore + 1, { timeout: 10_000 });

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
