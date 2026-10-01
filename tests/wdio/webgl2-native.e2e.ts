import { expect } from '@wdio/globals';

describe('WebGL2 compositor — Tauri/WebKitGTK compatibility', () => {
  it('draws a canvas edit through WebGL2 using WebDriver actions (not latency evidence)', async () => {
    await browser.tauri.execute(() => {
      let current: Record<string, unknown> = {};
      try {
        current = JSON.parse(localStorage.getItem('varve-editor-settings') ?? '{}');
      } catch {
        current = {};
      }
      const render = (current.render as Record<string, unknown> | undefined) ?? {};
      localStorage.setItem(
        'varve-editor-settings',
        JSON.stringify({ ...current, render: { ...render, renderer: 'webgl2' } }),
      );
    });

    const newButton = await browser.$('[data-testid="new-file-button"]');
    await newButton.waitForDisplayed({ timeout: 30000 });
    await newButton.click();
    const createButton = await browser.$('[data-testid="create-design-button"]');
    await createButton.waitForDisplayed({ timeout: 10000 });
    await createButton.click();

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    await canvas.waitForDisplayed({ timeout: 30000 });
    const rectangleTool = await browser.$('[data-tool="rect"]');
    await rectangleTool.waitForDisplayed({ timeout: 15000 });
    await rectangleTool.click();
    const bounds = (await browser.tauri.execute(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      if (!canvas) throw new Error('editor canvas not found');
      const bounds = canvas.getBoundingClientRect();
      const inputEvents: Array<{ type: string; trusted: boolean }> = [];
      for (const type of ['pointerdown', 'pointermove', 'pointerup']) {
        addEventListener(
          type,
          (event) => inputEvents.push({ type, trusted: event.isTrusted }),
          true,
        );
      }
      (window as unknown as { __webgl2WdioInput?: typeof inputEvents }).__webgl2WdioInput =
        inputEvents;
      return { left: bounds.left, top: bounds.top, width: bounds.width, height: bounds.height };
    })) as { left: number; top: number; width: number; height: number };
    const startX = Math.round(bounds.left + bounds.width * 0.25);
    const startY = Math.round(bounds.top + bounds.height * 0.25);
    const endX = Math.round(bounds.left + bounds.width * 0.58);
    const endY = Math.round(bounds.top + bounds.height * 0.58);
    await browser.performActions([
      {
        type: 'pointer',
        id: 'mouse',
        parameters: { pointerType: 'mouse' },
        actions: [
          { type: 'pointerMove', x: startX, y: startY, duration: 0 },
          { type: 'pointerDown', button: 0 },
          { type: 'pointerMove', x: endX, y: endY, duration: 100 },
          { type: 'pointerUp', button: 0 },
        ],
      },
    ]);
    await browser.releaseActions();

    const status = await browser.$('.editor-status__diagnostic');
    await browser.waitUntil(
      async () => (await status.getText().catch(() => '')) === 'WebGL2 · experimental',
      { timeout: 30000, timeoutMsg: 'WebKitGTK did not activate the WebGL2 compositor' },
    );
    await browser.waitUntil(
      async () =>
        (await status.getAttribute('title'))?.includes('eligible item(s) were submitted') ?? false,
      { timeout: 15000, timeoutMsg: 'No eligible shapes were submitted to WebGL2' },
    );
    expect(await browser.$$('[role="treeitem"]').length).toBeGreaterThanOrEqual(1);
    expect(await status.getAttribute('title')).toContain('Hardware execution is not inferred');
    const input = (await browser.tauri.execute(
      () =>
        (window as unknown as { __webgl2WdioInput?: Array<{ type: string; trusted: boolean }> })
          .__webgl2WdioInput ?? [],
    )) as Array<{ type: string; trusted: boolean }>;
    expect(input.filter((event) => event.type === 'pointerdown' && event.trusted).length).toBe(1);
    expect(input.filter((event) => event.type === 'pointerup' && event.trusted).length).toBe(1);
  });
});
