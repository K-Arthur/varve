/** Tablet text authoring and native-edit-surface regression. */
import { expect, test } from '@playwright/test';
import { readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

test.describe('tablet text editing', () => {
  test.use({ hasTouch: true, viewport: { width: 820, height: 1180 } });

  test('touch creates editable text, accepts typing, and commits it to the document', async ({
    page,
  }) => {
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('tablet content canvas has no bounds');

    const toolbar = page.getByTestId('toolbar');
    await toolbar.getByRole('button', { name: 'Text', exact: true }).first().tap();
    await page.touchscreen.tap(canvasBox.x + 180, canvasBox.y + 180);

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeVisible({ timeout: 15_000 });
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute('inputmode', 'text');
    await page.keyboard.insertText('Tablet text entry');
    await expect(editor).toHaveValue('Tablet text entry');

    await page.keyboard.press('Escape');
    await expect(editor).toBeHidden();
    await expect
      .poll(async () => {
        const serialized = (await readEditorState(page)).serialized;
        const document = JSON.parse(serialized) as {
          nodes?: Record<string, { kind?: string; text?: string }>;
        };
        return Object.values(document.nodes ?? {}).some(
          (node) => node.kind === 'text' && node.text === 'Tablet text entry',
        );
      })
      .toBe(true);
  });

  test('short tablet text entry survives keyboard-like reflow and keeps writing controls reachable', async ({
    page,
  }) => {
    // A compact height stands in for the viewport area left after a software
    // keyboard opens. Resizing again while the native edit surface is focused
    // exercises the same resize/visualViewport recovery path without relying
    // on a host OS keyboard in headless Chromium.
    await page.setViewportSize({ width: 820, height: 520 });
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');

    await page
      .getByTestId('toolbar')
      .getByRole('button', { name: 'Text', exact: true })
      .first()
      .tap();
    const options = page.locator('.tool-options__popover');
    await expect(options).toBeVisible();
    const writing = options.getByRole('combobox', { name: 'Writing mode', exact: true });
    const orientation = options.getByRole('combobox', {
      name: 'Character orientation',
      exact: true,
    });
    for (const control of [writing, orientation]) {
      await expect(control).toBeVisible();
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    await writing.selectOption('vertical-rl');
    await orientation.selectOption('mixed');

    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const canvasBox = await canvas.boundingBox();
    if (!canvasBox) throw new Error('short tablet content canvas has no bounds');
    await page.touchscreen.tap(
      canvasBox.x + Math.min(120, canvasBox.width * 0.28),
      canvasBox.y + Math.min(72, canvasBox.height * 0.3),
    );

    const editor = page.getByRole('textbox', { name: /editing text/i });
    await expect(editor).toBeVisible();
    await expect(editor).toBeFocused();
    await expect(editor).toHaveAttribute('data-writing-mode', 'vertical-rl');
    await expect(editor).toHaveAttribute('data-text-orientation', 'mixed');
    await page.keyboard.insertText('Tablet entry ');

    // Freeze the viewport-recovery timer so this covers Escape on both sides
    // of the 250ms handoff without depending on CI scheduler load.
    await page.clock.install();
    await page.clock.pauseAt(new Date(Date.now() + 1000));
    await page.setViewportSize({ width: 820, height: 360 });
    await page.clock.runFor(16);
    await expect(editor).toBeFocused();
    const editorGeometry = await editor.evaluate((element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        top: rect.top,
        right: rect.right,
        bottom: rect.bottom,
        viewportWidth: window.innerWidth,
        viewportHeight: window.innerHeight,
      };
    });
    expect(editorGeometry.left).toBeGreaterThanOrEqual(-1);
    expect(editorGeometry.top).toBeGreaterThanOrEqual(-1);
    expect(editorGeometry.right).toBeLessThanOrEqual(editorGeometry.viewportWidth + 1);
    expect(editorGeometry.bottom).toBeLessThanOrEqual(editorGeometry.viewportHeight + 1);
    await page.keyboard.insertText('after reflow');
    await expect(editor).toHaveValue('Tablet entry after reflow');

    // The viewport change remounts the native edit surface. Assert the reflow
    // settles on exactly one surface before committing: matching by role can
    // resolve to a stale node during the remount, and a surface that never
    // settles is a real leak worth failing on rather than masking.
    const editSurfaces = page.locator('[data-text-edit-surface="true"]');
    await expect(editSurfaces).toHaveCount(1, { timeout: 15_000 });

    // The first Escape during viewport recovery dismisses the software
    // keyboard handoff while keeping the native text editor alive.
    await page.keyboard.press('Escape');
    await expect(editSurfaces).toHaveCount(1);
    await expect(editor).toBeFocused();

    // Once recovery settles, Escape commits the text and closes the editor.
    await page.clock.runFor(250);
    await page.keyboard.press('Escape');
    await expect(editSurfaces).toHaveCount(0, { timeout: 15_000 });
    await expect
      .poll(async () => {
        const serialized = (await readEditorState(page)).serialized;
        const document = JSON.parse(serialized) as {
          nodes?: Record<string, { kind?: string; text?: string; writingMode?: string }>;
        };
        return Object.values(document.nodes ?? {}).some(
          (node) =>
            node.kind === 'text' &&
            node.text === 'Tablet entry after reflow' &&
            node.writingMode === 'vertical-rl',
        );
      })
      .toBe(true);

    // The writing-mode controls must also remain usable in the reduced-height
    // layout after the edit flow returns to the Text tool.
    await page.keyboard.press('t');
    await expect(options).toBeVisible();
    for (const control of [writing, orientation]) {
      await expect(control).toBeVisible();
      await expect(control).toBeInViewport({ ratio: 1 });
    }
    const optionsGeometry = await options.boundingBox();
    expect(optionsGeometry).not.toBeNull();
    expect(optionsGeometry!.x).toBeGreaterThanOrEqual(0);
    expect(optionsGeometry!.y).toBeGreaterThanOrEqual(0);
    expect(optionsGeometry!.x + optionsGeometry!.width).toBeLessThanOrEqual(821);
    expect(optionsGeometry!.y + optionsGeometry!.height).toBeLessThanOrEqual(361);
  });
});
