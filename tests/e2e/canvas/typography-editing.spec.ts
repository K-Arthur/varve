import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function callEditor(
  page: import('@playwright/test').Page,
  method: string,
  ...args: unknown[]
): Promise<unknown> {
  return page.evaluate(
    ({ method, args }) => {
      const container = document.getElementById('root');
      if (!container) return null;
      const fiberKey = Object.keys(container).find(
        (key) => key.startsWith('__reactFiber$') || key.startsWith('__reactContainer$'),
      );
      if (!fiberKey) return null;
      function walk(fiber: Record<string, unknown> | null): Record<string, unknown> | null {
        if (!fiber) return null;
        for (const props of [fiber.memoizedProps, fiber.pendingProps]) {
          const value = props as Record<string, unknown> | undefined;
          if (
            value?.value &&
            typeof value.value === 'object' &&
            'serializeDocument' in (value.value as Record<string, unknown>)
          ) {
            return value.value as Record<string, unknown>;
          }
        }
        return (
          walk(fiber.child as Record<string, unknown> | null) ||
          walk(fiber.sibling as Record<string, unknown> | null)
        );
      }
      const context = walk(
        (container as unknown as Record<string, unknown>)[fiberKey] as Record<string, unknown>,
      );
      const fn = context?.[method] as ((...values: unknown[]) => unknown) | undefined;
      return typeof fn === 'function' ? fn(...args) : null;
    },
    { method, args },
  );
}

async function contentCanvasFingerprint(canvas: import('@playwright/test').Locator) {
  return canvas.evaluate((element) => {
    const context = (element as HTMLCanvasElement).getContext('2d');
    if (!context) return { hash: 0, inkPixels: 0 };
    const { data } = context.getImageData(0, 0, context.canvas.width, context.canvas.height);
    const background = [data[0], data[1], data[2], data[3]];
    let hash = 2166136261;
    let inkPixels = 0;
    for (let index = 0; index < data.length; index += 4) {
      const differsFromBackground =
        data[index] !== background[0] ||
        data[index + 1] !== background[1] ||
        data[index + 2] !== background[2] ||
        data[index + 3] !== background[3];
      if (differsFromBackground) inkPixels += 1;
      for (let channel = 0; channel < 4; channel += 1) {
        hash ^= data[index + channel] ?? 0;
        hash = Math.imul(hash, 16777619);
      }
    }
    return { hash: hash >>> 0, inkPixels };
  });
}

test.describe('Typography editing workflow', () => {
  test('point text shows immediate input and keeps its toolbar alive', async ({
    page,
  }, testInfo) => {
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 180);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('Immediate typography feedback');
    await expect(editor).toHaveValue('Immediate typography feedback');
    await page.screenshot({
      path: testInfo.outputPath('point-text-active-editor.png'),
      animations: 'disabled',
      fullPage: false,
    });

    const toolbar = page.getByRole('toolbar', { name: 'Text formatting' });
    await expect(toolbar).toBeVisible();
    const more = toolbar.getByRole('button', { name: 'More text formatting' });
    await more.click();
    await expect(
      page.getByRole('dialog', { name: 'More text formatting', exact: true }),
    ).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(editor).toBeVisible();
    const toolbarBounds = await toolbar.boundingBox();
    const moreBounds = await more.boundingBox();
    if (!toolbarBounds || !moreBounds) throw new Error('Missing toolbar bounds');
    expect(moreBounds.x + moreBounds.width).toBeLessThanOrEqual(
      toolbarBounds.x + toolbarBounds.width,
    );
    await toolbar.getByRole('button', { name: 'Bold' }).click();
    await expect(editor).toBeVisible();

    const fontInput = toolbar.locator('.font-selector__input');
    await fontInput.click();
    await expect(page.getByRole('listbox', { name: 'Font families' })).toBeVisible();
    await expect(editor).toBeVisible();
    const menu = page.getByRole('listbox', { name: 'Font families' });
    await expect(menu.getByRole('option').first()).toBeVisible();
    const bounds = await menu.boundingBox();
    const viewport = page.viewportSize();
    if (!bounds || !viewport) throw new Error('Missing font picker bounds');
    // The toolbar family field intentionally uses a 180–220px responsive
    // clamp; at the 1280px E2E viewport it is 17vw (217.6px), which keeps the
    // menu readable while leaving the formatting controls usable.
    expect(bounds.width).toBeGreaterThanOrEqual(200);
    expect(bounds.x).toBeGreaterThanOrEqual(0);
    expect(bounds.y).toBeGreaterThanOrEqual(0);
    expect(bounds.x + bounds.width).toBeLessThanOrEqual(viewport.width);
    expect(bounds.y + bounds.height).toBeLessThanOrEqual(viewport.height);
    await page.screenshot({
      path: testInfo.outputPath('text-toolbar-font-menu.png'),
      animations: 'disabled',
      fullPage: false,
    });

    await page.keyboard.press('Escape');
    await expect(page.getByRole('listbox', { name: 'Font families' })).toBeHidden();
    await expect(editor).toBeVisible();

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
  });

  test('an untouched newly created text node is not retained on cancel', async ({ page }) => {
    await navigateToEditor(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 180);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect(page.getByRole('listitem', { name: /text:/i })).toHaveCount(0);
  });

  test('OpenType changes and cluster adjustment redraw the real artwork', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    await navigateToEditor(page, '/?perf=1');
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 15000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('editor canvas has no bounds');

    await page.keyboard.press('t');
    await page.mouse.click(box.x + 220, box.y + 180);
    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeFocused();
    await page.keyboard.insertText('office fi');
    await page.keyboard.press('Escape');
    await page.keyboard.press('v');
    await page.getByRole('treeitem', { name: /text:/i }).first().click();

    const openType = page
      .locator('button.insp-disclosure__trigger')
      .filter({ hasText: 'OpenType features' });
    await expect(openType).toBeVisible({ timeout: 10000 });
    if ((await openType.getAttribute('aria-expanded')) !== 'true') await openType.click();
    const ligature = page.getByRole('combobox', { name: 'Standard ligatures value' });
    await expect(ligature).toBeVisible();

    const fontSize = page.getByRole('spinbutton', { name: 'Font size', exact: true });
    await expect(fontSize).toBeVisible();
    await fontSize.fill('96');
    await fontSize.press('Enter');
    await expect(fontSize).toHaveValue('96');
    await page.mouse.move(box.x + 12, box.y + 12);
    const beforeContent = await contentCanvasFingerprint(canvas);
    await canvas.screenshot({
      path: testInfo.outputPath('advanced-typography-before-canvas.png'),
      animations: 'disabled',
    });
    await page.screenshot({
      path: testInfo.outputPath('advanced-typography-before-ligature-off.png'),
      animations: 'disabled',
      fullPage: false,
    });
    await ligature.click();
    await page.getByRole('option', { name: /^Off/ }).click();
    await expect(ligature).toHaveText(/Off/);
    const serialized = (await callEditor(page, 'serializeDocument')) as string | null;
    const documentNodes = serialized
      ? (JSON.parse(serialized) as { nodes?: Record<string, unknown> }).nodes
      : undefined;
    const textNode = Object.values(documentNodes ?? {}).find(
      (node) => (node as { kind?: string }).kind === 'text',
    ) as { openTypeFeatures?: Record<string, unknown> } | undefined;
    expect(textNode?.openTypeFeatures).toEqual({ liga: false });

    let afterContent: Awaited<ReturnType<typeof contentCanvasFingerprint>> | undefined;
    await page.waitForTimeout(2000);
    await expect
      .poll(
        async () => {
          await canvas.screenshot();
          afterContent = await contentCanvasFingerprint(canvas);
          return afterContent.hash;
        },
        { timeout: 30000, intervals: [100, 250, 500, 1000] },
      )
      .not.toBe(beforeContent.hash);
    if (!afterContent) throw new Error('Missing post-feature canvas fingerprint');
    await testInfo.attach('advanced-typography-content-fingerprints.json', {
      body: JSON.stringify({ before: beforeContent, after: afterContent }, null, 2),
      contentType: 'application/json',
    });
    await page.mouse.move(box.x + 12, box.y + 12);
    await canvas.screenshot({
      path: testInfo.outputPath('advanced-typography-after-canvas.png'),
      animations: 'disabled',
    });
    await page.screenshot({
      path: testInfo.outputPath('advanced-typography-after-ligature-off.png'),
      animations: 'disabled',
      fullPage: false,
    });

    const glyphAdjustments = page
      .locator('button.insp-disclosure__trigger')
      .filter({ hasText: 'Glyph adjustments' });
    await expect(glyphAdjustments).toBeVisible();
    if ((await glyphAdjustments.getAttribute('aria-expanded')) !== 'true')
      await glyphAdjustments.click();
    const x = page.getByRole('spinbutton', { name: 'X (px)', exact: true });
    await expect(x).toBeVisible();
    await x.fill('12');
    await expect(x).toHaveValue('12');
    await page.waitForTimeout(500);
    await page.screenshot({
      path: testInfo.outputPath('advanced-typography-after-cluster-offset.png'),
      animations: 'disabled',
      fullPage: false,
    });
  });
});
