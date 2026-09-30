/**
 * Keyboardless tablet editing workflow — integrated regression.
 *
 * This is the cross-surface companion to the focused layout/gesture checks in
 * `chromeos-device-matrix.spec.ts`. Where those prove individual behaviours,
 * this drives one document through the whole touch-only loop the tablet brief
 * asks for: choose a tool, author geometry, select, multi-select, edit through
 * the tablet control popover (align + layer order), and undo/redo — without
 * dispatching a single keyboard event to the editor.
 *
 * Evidence class: synthetic touch input in headless Chromium. It does NOT
 * certify USI pressure, palm rejection, a real on-screen keyboard, or physical
 * hardware latency. Those remain Duet device checks.
 *
 *   pnpm exec playwright test tests/e2e/interaction/tablet-keyboardless-workflow.spec.ts \
 *     --project=chromium --workers=1 --reporter=list
 */
import { expect, type Page, test } from '@playwright/test';
import { dismissTabletPanel, readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

interface SerializedShape {
  kind?: string;
  shape?: { kind?: string; x?: number; y?: number };
  transform?: number[];
  /** Fractional index key, e.g. "a0"; rewritten when the node is arranged. */
  order?: string;
}

interface SerializedDocument {
  nodes?: Record<string, SerializedShape>;
}

/** The editor context exposes `serializeDocument`; it is authoritative state. */
const serializeEditorDocument = async (page: Page): Promise<string> =>
  (await readEditorState(page)).serialized;

async function readDocument(page: Page): Promise<SerializedDocument> {
  return JSON.parse(await serializeEditorDocument(page)) as SerializedDocument;
}

function rectEntries(doc: SerializedDocument): Array<[string, SerializedShape]> {
  return Object.entries(doc.nodes ?? {}).filter(
    ([, node]) => node.kind === 'shape' && node.shape?.kind === 'rect',
  );
}

function rectNodes(doc: SerializedDocument): SerializedShape[] {
  return rectEntries(doc).map(([, node]) => node);
}

/** World-space left edge of each rectangle, ascending. */
function rectLeftEdges(doc: SerializedDocument): number[] {
  return rectNodes(doc)
    .map((node) => (node.transform?.[4] ?? 0) + (node.shape?.x ?? 0))
    .sort((a, b) => a - b);
}

/**
 * Layer order is stored as a fractional key on each node and rewritten when a
 * node is arranged. Map id -> key so the comparison is independent of object
 * key iteration order.
 */
async function rectOrderKeys(page: Page): Promise<string> {
  const doc = await readDocument(page);
  return rectEntries(doc)
    .map(([id, node]) => `${id}:${node.order ?? ''}`)
    .sort()
    .join('|');
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

async function rectCount(page: Page): Promise<number> {
  return rectNodes(await readDocument(page)).length;
}

/**
 * Author one rectangle by touch. A synthetic CDP drag can be dropped when the
 * shared machine is loaded, so the drag is retried until the document actually
 * counts one more rectangle; the assertion is not weakened, only made
 * independent of a single dropped event.
 */
async function authorRect(
  page: Page,
  palette: import('@playwright/test').Locator,
  from: { x: number; y: number },
  to: { x: number; y: number },
): Promise<void> {
  const rectTool = palette.getByRole('button', { name: 'Rectangle', exact: true }).first();
  const before = await rectCount(page);
  for (let attempt = 0; attempt < 3; attempt += 1) {
    await rectTool.tap();
    await touchDrag(page, from, to);
    try {
      await expect
        .poll(async () => await rectCount(page), { timeout: 6000 })
        .toBeGreaterThan(before);
      return;
    } catch {
      // Retry: the drag did not land.
    }
  }
  throw new Error(`rectangle was not created after retries (count stayed at ${before})`);
}

/**
 * Playwright cannot drag a touch contact, so dispatch the CDP touch stream
 * directly. This is the same synthetic path the device matrix uses.
 */
async function touchDrag(
  page: Page,
  from: { x: number; y: number },
  to: { x: number; y: number },
  steps = 6,
): Promise<void> {
  const session = await page.context().newCDPSession(page);
  try {
    await session.send('Input.dispatchTouchEvent', {
      type: 'touchStart',
      touchPoints: [{ ...from, id: 1 }],
    });
    for (let step = 1; step <= steps; step += 1) {
      await session.send('Input.dispatchTouchEvent', {
        type: 'touchMove',
        touchPoints: [
          {
            x: from.x + ((to.x - from.x) * step) / steps,
            y: from.y + ((to.y - from.y) * step) / steps,
            id: 1,
          },
        ],
      });
    }
    await session.send('Input.dispatchTouchEvent', { type: 'touchEnd', touchPoints: [] });
  } finally {
    await session.detach();
  }
}

test.describe('keyboardless tablet editing workflow', () => {
  test.use({ hasTouch: true, viewport: { width: 1200, height: 750 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('strata-clean-shutdown', 'true');
        localStorage.removeItem('varve:crash-loop');
      } catch {
        // Storage unavailable: the app's in-memory fallback already applies.
      }
    });
  });

  test('authors, aligns, reorders, and undoes a document with touch only', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
    await settle(page);

    const palette = page.getByTestId('toolbar');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not laid out');
    // Empty canvas away from both authored rectangles: used to clear a
    // selection and to light-dismiss the tablet popover.
    const emptyPoint = { x: box.x + box.width - 80, y: box.y + 80 };

    // ── Author two rectangles with touch-only tool selection ────────────────
    await authorRect(
      page,
      palette,
      { x: box.x + 120, y: box.y + 140 },
      { x: box.x + 300, y: box.y + 260 },
    );
    await authorRect(
      page,
      palette,
      { x: box.x + 360, y: box.y + 320 },
      { x: box.x + 520, y: box.y + 430 },
    );

    await expect.poll(async () => await rectCount(page), { timeout: 15000 }).toBe(2);

    const authored = await serializeEditorDocument(page);
    const authoredEdges = rectLeftEdges(JSON.parse(authored));
    expect(authoredEdges).toHaveLength(2);
    expect(authoredEdges[0]).not.toBe(authoredEdges[1]);

    // ── Select with touch. Taps must not mutate or move anything. ───────────
    const selectTool = palette.getByRole('button', { name: 'Select', exact: true }).first();
    await selectTool.tap();
    await expect(selectTool).toHaveAttribute('aria-pressed', 'true');

    await page.touchscreen.tap(box.x + 210, box.y + 200);
    await settle(page);
    expect(await serializeEditorDocument(page)).toBe(authored);

    const trigger = page.getByRole('button', { name: 'Tablet editing controls' });
    const panel = page.getByRole('dialog', { name: 'Tablet editing controls' });
    const alignLeft = panel.getByRole('button', { name: 'Align left' });
    const bringForward = panel.getByRole('button', { name: 'Bring forward' });
    const duplicate = panel.getByRole('button', { name: 'Duplicate' });

    // One selected object: Duplicate is available, alignment is not.
    await expect(trigger).toBeVisible({ timeout: 30000 });
    await trigger.tap();
    await expect(panel).toBeVisible();
    await expect(duplicate).toBeEnabled();
    await expect(alignLeft).toBeDisabled();
    await dismissTabletPanel(page, trigger, panel, emptyPoint);

    // ── Multi-select without a keyboard modifier ────────────────────────────
    await palette.getByTestId('touch-multiselect-toggle').tap();
    await page.touchscreen.tap(box.x + 440, box.y + 375);
    await settle(page);
    // Selection is metadata, not document content.
    expect(await serializeEditorDocument(page)).toBe(authored);

    await trigger.tap();
    await expect(panel).toBeVisible();
    await expect(alignLeft).toBeEnabled();

    // ── Align left through the tablet controls ──────────────────────────────
    await alignLeft.tap();
    await expect
      .poll(
        async () => {
          const edges = rectLeftEdges(await readDocument(page));
          return edges.length === 2 && Math.abs(edges[0]! - edges[1]!) < 0.5;
        },
        { timeout: 10000 },
      )
      .toBe(true);
    await dismissTabletPanel(page, trigger, panel, emptyPoint);

    const afterAlign = await serializeEditorDocument(page);
    expect(afterAlign).not.toBe(authored);

    // ── Layer order through the tablet controls (single selection) ──────────
    const multiToggle = palette.getByTestId('touch-multiselect-toggle');
    await multiToggle.tap();
    // Turning the modifier off is the precondition for a single selection.
    await expect(multiToggle).toHaveAttribute('aria-pressed', 'false');
    // A tap on an already-selected member keeps the multi-selection (so the
    // group can be moved), so clear first, then select the back-most shape.
    await page.touchscreen.tap(emptyPoint.x, emptyPoint.y);
    await settle(page);
    await page.touchscreen.tap(box.x + 210, box.y + 200);
    await settle(page);

    const orderBefore = await rectOrderKeys(page);
    await trigger.tap();
    await expect(panel).toBeVisible();
    // Exactly one object is selected: alignment (which needs two) is
    // unavailable while a reorder is available.
    await expect(alignLeft).toBeDisabled();
    await expect(bringForward).toBeEnabled();
    await bringForward.tap();
    await expect
      .poll(async () => await rectOrderKeys(page), { timeout: 10000 })
      .not.toBe(orderBefore);
    await dismissTabletPanel(page, trigger, panel, emptyPoint);

    // ── Undo both edits, then redo the alignment ────────────────────────────
    const menuAction = async (name: RegExp) => {
      await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).tap();
      await page.getByRole('menuitem', { name }).tap();
    };

    await menuAction(/^undo/i);
    await menuAction(/^undo/i);
    await expect
      .poll(async () => await serializeEditorDocument(page), { timeout: 10000 })
      .toBe(authored);

    await menuAction(/^redo/i);
    await expect
      .poll(
        async () => {
          const edges = rectLeftEdges(await readDocument(page));
          return edges.length === 2 && Math.abs(edges[0]! - edges[1]!) < 0.5;
        },
        { timeout: 10000 },
      )
      .toBe(true);

    await settle(page);
    await page.screenshot({ path: testInfo.outputPath('keyboardless-workflow.png') });
    await testInfo.attach('keyboardless-workflow', {
      path: testInfo.outputPath('keyboardless-workflow.png'),
      contentType: 'image/png',
    });

    expect(pageErrors).toEqual([]);
  });
});
