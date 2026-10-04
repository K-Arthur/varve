import { expect, type Page, test } from '@playwright/test';
import { readEditorState } from '../helpers/tabletControls';
import { dragOnCanvas, navigateToEditor } from '../shared';

type SerializedNode = Record<string, unknown> & {
  id: string;
  kind: string;
  fill?: Record<string, unknown>;
  fills?: Array<Record<string, unknown>>;
  transform?: [number, number, number, number, number, number];
  shape?: Record<string, unknown>;
  strokes?: Array<Record<string, unknown>>;
};

type SerializedDocument = { nodes: Record<string, SerializedNode> };

async function readDocument(page: Page): Promise<SerializedDocument> {
  return JSON.parse((await readEditorState(page)).serialized) as SerializedDocument;
}

async function contentCanvasHash(page: Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((canvas) => {
    if (!(canvas instanceof HTMLCanvasElement)) throw new Error('Expected canvas element');
    const context = canvas.getContext('2d');
    if (!context) throw new Error('Canvas 2D context is unavailable');
    const { data } = context.getImageData(0, 0, canvas.width, canvas.height);
    let hash = 2166136261;
    for (const value of data) hash = Math.imul(hash ^ value, 16777619);
    return `${data.length}:${hash >>> 0}`;
  });
}

async function fillControlIsEditable(page: Page): Promise<boolean> {
  const fill = page.locator('.context-control-bar').getByRole('button', { name: 'Fill colour' });
  return (await fill.isVisible().catch(() => false)) && (await fill.isEnabled().catch(() => false));
}

function arrowWorldCenter(node: SerializedNode): { x: number; y: number } {
  const shape = node.shape;
  const transform = node.transform;
  if (!shape || shape.kind !== 'arrow' || !transform) {
    throw new Error('Expected a selected arrow with an affine transform');
  }
  const from = shape.from as [number, number];
  const to = shape.to as [number, number];
  const localX = (Math.min(from[0], to[0]) + Math.max(from[0], to[0])) / 2;
  const localY = (Math.min(from[1], to[1]) + Math.max(from[1], to[1])) / 2;
  const [a, b, c, d, e, f] = transform;
  return { x: e + a * localX + c * localY, y: f + b * localX + d * localY };
}

test.describe('vector quick controls', () => {
  test('edits stacked fill and stroke from the contextual toolbar and keeps Inspector values in sync', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 850 });
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 170, 160, 400, 360);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const contextBar = page.locator('.context-control-bar');
    // Add Fill is the disclosure header action (a sibling of the labelled
    // Fill group), while the paint rows themselves live inside that group.
    const fillSection = page.locator('.insp-disclosure[data-section-id="fills"]');
    const addFill = fillSection.getByRole('button', { name: 'Add fill' });
    await addFill.click();
    await page.getByRole('menuitem', { name: 'Solid', exact: true }).click();
    await expect(page.locator('.insp-fill-row')).toHaveCount(2);
    // Keep the stack non-empty while exposing the first row's color on the
    // canvas; otherwise the newly added opaque top fill hides the changed
    // primary fill even when the edit is correctly persisted.
    await page.getByRole('switch', { name: 'Hide Fill 2' }).click();

    // Use a real pointer in the contextual toolbar. Editing fill[0] used to
    // write only node.fill, which is ignored whenever a non-empty fills[] stack
    // exists. The Inspector row is the persisted-value oracle for this path.
    await contextBar.getByRole('button', { name: 'Fill colour' }).click();
    let picker = page.getByRole('dialog', { name: /pick fill colour/i });
    await expect(picker).toBeVisible();
    const fillHex = picker.getByRole('textbox', { name: 'Hex color' });
    await fillHex.fill('#aa22dd');
    await fillHex.press('Enter');
    await page.getByRole('button', { name: /^done$/i }).click();

    const inspectorFill = fillSection.locator('.insp-fill-row').first();
    await expect(inspectorFill.locator('.insp-swatch__value')).toHaveText('#AA22DD');
    await inspectorFill.getByRole('button', { name: 'Fill colour' }).click();
    picker = page.getByRole('dialog', { name: /pick fill colour/i });
    await expect(picker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(/#aa22dd/i);
    await page.keyboard.press('Escape');

    await contextBar.getByRole('button', { name: 'Add stroke' }).click();
    await expect(contextBar.getByRole('button', { name: 'Stroke colour' })).toBeVisible();
    await contextBar.getByRole('button', { name: 'Stroke colour' }).click();
    const strokePicker = page.getByRole('dialog', { name: /pick stroke colour/i });
    await expect(strokePicker).toBeVisible();
    const strokeHex = strokePicker.getByRole('textbox', { name: 'Hex color' });
    await strokeHex.fill('#12ab34');
    await strokeHex.press('Enter');
    await page.getByRole('button', { name: /^done$/i }).click();

    const strokeSection = page.getByRole('group', { name: 'Stroke' });
    const inspectorStroke = strokeSection.locator('.insp-stroke-row').first();
    await inspectorStroke.getByRole('button', { name: 'Stroke colour' }).click();
    const persistedStrokePicker = page.getByRole('dialog', { name: /pick stroke colour/i });
    await expect(persistedStrokePicker.getByRole('textbox', { name: 'Hex color' })).toHaveValue(
      /#12ab34/i,
    );
    await page.keyboard.press('Escape');

    const quickStrokeWidth = contextBar.getByRole('spinbutton', { name: 'Stroke width' });
    await quickStrokeWidth.fill('6.5');
    await quickStrokeWidth.press('Enter');
    await quickStrokeWidth.blur();
    await expect(
      strokeSection.getByRole('spinbutton', { name: /Stroke weight \(px\)/i }),
    ).toHaveValue('6.5');

    const screenshot = test.info().outputPath('vector-quick-controls-persisted.png');
    await page.screenshot({ path: screenshot, animations: 'disabled' });
    await test.info().attach('vector-quick-controls-persisted', {
      path: screenshot,
      contentType: 'image/png',
    });
  });

  test('does not leave no-op fill controls enabled for line and arrow primitives', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 850 });
    await navigateToEditor(page);
    const contextBar = page.locator('.context-control-bar');

    await page.keyboard.press('l');
    await dragOnCanvas(page, 160, 170, 330, 250);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
    expect
      .soft(
        await fillControlIsEditable(page),
        'stroke-only line primitives must not show an enabled Fill colour control',
      )
      .toBe(false);

    await page.keyboard.press('a');
    await dragOnCanvas(page, 390, 180, 560, 270);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
    await page.getByRole('treeitem').last().click();
    await expect(contextBar).toBeVisible();
    expect
      .soft(
        await fillControlIsEditable(page),
        'stroke-only arrow primitives must not show an enabled Fill colour control',
      )
      .toBe(false);
  });

  test('stroke edits render, flips preserve the arrow centre, and undo restores its pixels', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1366, height: 850 });
    await navigateToEditor(page);
    await page.keyboard.press('a');
    await dragOnCanvas(page, 180, 170, 350, 285);
    await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

    const contextBar = page.locator('.context-control-bar');
    const addStroke = contextBar.getByRole('button', { name: 'Add stroke' });
    if (await addStroke.isVisible().catch(() => false)) await addStroke.click();
    await expect(contextBar.getByRole('button', { name: 'Stroke colour' })).toBeVisible();

    const beforeEditHash = await contentCanvasHash(page);
    await contextBar.getByRole('button', { name: 'Stroke colour' }).click();
    const strokePicker = page.getByRole('dialog', { name: /pick stroke colour/i });
    await strokePicker.getByRole('textbox', { name: 'Hex color' }).fill('#df168b');
    await strokePicker.getByRole('textbox', { name: 'Hex color' }).press('Enter');
    await page.getByRole('button', { name: /^done$/i }).click();

    const width = contextBar.getByRole('spinbutton', { name: 'Stroke width' });
    await width.fill('11');
    await width.press('Enter');
    await width.blur();
    await expect
      .poll(async () => {
        const document = await readDocument(page);
        const node = Object.values(document.nodes).find(
          (candidate) => candidate.kind === 'shape' && candidate.shape?.kind === 'arrow',
        );
        const stroke = node?.strokes?.[0];
        const color = stroke?.color as Record<string, unknown> | undefined;
        return stroke?.weight === 11 && color?.r === 223 && color.g === 22 && color.b === 139;
      })
      .toBe(true);
    const editedHash = await contentCanvasHash(page);
    expect(editedHash).not.toBe(beforeEditHash);

    const initialDocument = await readDocument(page);
    const initialNode = Object.values(initialDocument.nodes).find(
      (candidate) => candidate.kind === 'shape' && candidate.shape?.kind === 'arrow',
    );
    if (!initialNode) throw new Error('Arrow document state is unavailable');
    const initialTransform = initialNode.transform;
    const initialCenter = arrowWorldCenter(initialNode);

    await contextBar.getByRole('button', { name: 'Flip horizontal' }).click();
    await expect.poll(async () => contentCanvasHash(page)).not.toBe(editedHash);
    let transformedDocument = await readDocument(page);
    let transformedNode = Object.values(transformedDocument.nodes).find(
      (candidate) => candidate.kind === 'shape' && candidate.shape?.kind === 'arrow',
    );
    if (!transformedNode) throw new Error('Flipped arrow state is unavailable');
    expect(transformedNode.transform).not.toEqual(initialTransform);
    expect(arrowWorldCenter(transformedNode).x).toBeCloseTo(initialCenter.x, 5);
    expect(arrowWorldCenter(transformedNode).y).toBeCloseTo(initialCenter.y, 5);

    await page.keyboard.press('Control+z');
    await expect
      .poll(async () => {
        const document = await readDocument(page);
        const node = Object.values(document.nodes).find(
          (candidate) => candidate.kind === 'shape' && candidate.shape?.kind === 'arrow',
        );
        return JSON.stringify(node?.transform);
      })
      .toBe(JSON.stringify(initialTransform));
    await expect.poll(async () => contentCanvasHash(page)).toBe(editedHash);

    await contextBar.getByRole('button', { name: 'Flip vertical' }).click();
    await expect.poll(async () => contentCanvasHash(page)).not.toBe(editedHash);
    transformedDocument = await readDocument(page);
    transformedNode = Object.values(transformedDocument.nodes).find(
      (candidate) => candidate.kind === 'shape' && candidate.shape?.kind === 'arrow',
    );
    if (!transformedNode) throw new Error('Vertically flipped arrow state is unavailable');
    expect(arrowWorldCenter(transformedNode).x).toBeCloseTo(initialCenter.x, 5);
    expect(arrowWorldCenter(transformedNode).y).toBeCloseTo(initialCenter.y, 5);
  });
});
