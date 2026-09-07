import { expect } from '@wdio/globals';

async function openNewDocument(): Promise<void> {
  const homeButton = await browser.$('.editor-menubar__home');
  if (await homeButton.isDisplayed().catch(() => false)) {
    await homeButton.click();
  }
  const newButton = await browser.$('[data-testid="new-file-button"]');
  await newButton.waitForDisplayed({ timeout: 30000 });
  await newButton.click();
  const createButton = await browser.$('[data-testid="create-design-button"]');
  await createButton.waitForDisplayed({ timeout: 5000 });
  await createButton.click();
  await browser.$('[data-testid="editor-canvas"]').waitForDisplayed({ timeout: 30000 });
}

async function createRectangle(): Promise<void> {
  await openNewDocument();
  const rectTool = await browser.$('[data-tool="rect"]');
  await rectTool.waitForDisplayed({ timeout: 10000 });
  await rectTool.click();
  await browser.pause(100);
  await browser.tauri.execute(() => {
    const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
    if (!canvas) throw new Error('editor canvas not found');
    const box = canvas.getBoundingClientRect();
    const dispatch = (type: string, clientX: number, clientY: number, buttons: number) =>
      canvas.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          cancelable: true,
          clientX,
          clientY,
          pointerId: 1,
          pointerType: 'mouse',
          isPrimary: true,
          buttons,
        }),
      );
    dispatch('pointerdown', box.left + box.width * 0.25, box.top + box.height * 0.25, 1);
    dispatch('pointermove', box.left + box.width * 0.5, box.top + box.height * 0.5, 1);
    dispatch('pointerup', box.left + box.width * 0.5, box.top + box.height * 0.5, 0);
  });
  await browser.waitUntil(async () => (await browser.$$('[role="treeitem"]')).length === 1, {
    timeout: 10000,
  });
}

async function copyAndClearSelection(): Promise<void> {
  await browser.$('[role="treeitem"]').click();
  await browser.tauri.execute(() => {
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
    if (!editor) throw new Error('Editor context not found');
    editor.copySelected();
    editor.setSelection(null);
  });
  await browser.pause(700);
}

describe('Tauri desktop: Wayland clipboard', () => {
  it('writes and reads an editable Varve MIME payload through the native bridge', async () => {
    await createRectangle();
    await copyAndClearSelection();

    const nativePayload = await browser.tauri.execute(async () => {
      const invoke = window.__TAURI__?.core?.invoke;
      if (!invoke) throw new Error('Tauri invoke bridge not available');
      return invoke('read_clipboard_data', {
        mimeTypes: ['application/vnd.varve+json'],
      }) as Promise<{ mimeType: string; data: number[] } | null>;
    });

    expect(nativePayload?.mimeType).toBe('application/vnd.varve+json');
    expect(nativePayload?.data.length).toBeGreaterThan(0);
  });

  it('pastes through the canvas right-click context menu', async () => {
    await createRectangle();
    await copyAndClearSelection();

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    // The embedded WebDriver provider's right-button action does not emit a
    // DOM contextmenu event on WebKitGTK/Wayland. Dispatch the same browser
    // event that the real pointer path delivers; Playwright covers the actual
    // right-click gesture in the browser E2E suite.
    await canvas.click();
    await browser.tauri.execute(() => {
      const target = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      if (!target) throw new Error('editor canvas not found');
      const box = target.getBoundingClientRect();
      target.dispatchEvent(
        new MouseEvent('contextmenu', {
          bubbles: true,
          cancelable: true,
          button: 2,
          clientX: box.left + box.width / 2,
          clientY: box.top + box.height / 2,
        }),
      );
    });
    const menu = await browser.$('[role="menu"][aria-label="Canvas context menu"]');
    await menu.waitForDisplayed({ timeout: 5000 });
    await menu.$('//button[@role="menuitem" and normalize-space()="Paste"]').click();

    await browser.waitUntil(async () => (await browser.$$('[role="treeitem"]')).length === 2, {
      timeout: 15000,
      timeoutMsg: 'Right-click Paste did not insert the copied layer',
    });
  });

  it('pastes through Ctrl+V on the non-editable canvas', async () => {
    await createRectangle();
    await copyAndClearSelection();

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    await canvas.click();
    await browser.keys(['Control', 'v']);

    await browser.waitUntil(async () => (await browser.$$('[role="treeitem"]')).length === 2, {
      timeout: 15000,
      timeoutMsg: 'Ctrl+V did not insert the copied layer',
    });
  });
});
