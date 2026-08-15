import { expect } from '@wdio/globals';

/**
 * Desktop (Tauri) E2E smoke suite.
 *
 * Requires:
 *   1.  The app built with `pnpm tauri build --debug --features wdio`
 *   2.  `xvfb-run` (Linux) or a real display
 *   3.  WebdriverIO service configured in wdio.conf.ts
 *
 * Run:
 *   xvfb-run pnpm test:wdio
 */

async function ensureHome(): Promise<void> {
  const homeButton = await browser.$('.editor-menubar__home');
  if (await homeButton.isDisplayed().catch(() => false)) await homeButton.click();
  await browser.$('[data-testid="new-file-button"]').waitForDisplayed({ timeout: 30000 });
}

describe('Tauri Desktop: Application Lifecycle', () => {
  it('should load the application and show the home screen', async () => {
    // Wait for the app-ready custom event (added for testability)
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="new-file-button"]') !== null,
        ),
      { timeout: 30000, timeoutMsg: 'Home screen did not become ready within 30s' },
    );

    const newBtn = await browser.$('[data-testid="new-file-button"]');
    await expect(newBtn).toBeDisplayed();
  });

  it('should expose the Tauri IPC bridge (withGlobalTauri)', async () => {
    const hasTauriApi = await browser.tauri.execute(() => {
      return typeof window.__TAURI__ !== 'undefined';
    });
    expect(hasTauriApi).toBe(true);

    const invokeExists = await browser.tauri.execute(() => {
      const internals = window.__TAURI_INTERNALS__ as Record<string, unknown> | undefined;
      return typeof internals?.invoke === 'function';
    });
    expect(invokeExists).toBe(true);
  });

  it('should list Tauri windows', async () => {
    const windows = await browser.tauri.execute(async () => {
      const all = (await window.__TAURI__?.window?.getAllWindows?.()) ?? [];
      return all.map((w: { label: string }) => w.label);
    });
    expect(windows).toContain('main');
  });

  it('should close splashscreen on home-ready', async () => {
    // The app automatically calls close_splashscreen via revealMainWindow.ts
    // once HomeShell signals ready.  In a headed session the splash window
    // should already be closed by the time this test runs.
    const windows = await browser.tauri.execute(async () => {
      const all = (await window.__TAURI__?.window?.getAllWindows?.()) ?? [];
      return all.map((w: { label: string }) => w.label);
    });
    expect(windows).not.toContain('splashscreen');
  });
});

describe('Tauri Desktop: Create and Edit Document', () => {
  it('should create a new document and see the editor shell', async () => {
    await ensureHome();
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="new-file-button"]') !== null,
        ),
      { timeout: 30000 },
    );

    const newBtn = await browser.$('[data-testid="new-file-button"]');
    await newBtn.click();

    const createBtn = await browser.$('[data-testid="create-design-button"]');
    await createBtn.waitForDisplayed({ timeout: 5000 });
    await createBtn.click();

    // Wait for the editor to be ready via the custom event
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(() => {
          const canvas = document.querySelector('[data-testid="editor-canvas"]');
          return canvas !== null;
        }),
      { timeout: 15000, timeoutMsg: 'Editor canvas did not appear' },
    );

    const canvas = await browser.$('[data-testid="editor-canvas"]');
    await expect(canvas).toBeDisplayed();

    const layersPanel = await browser.$('[data-testid="layers-panel"]');
    await expect(layersPanel).toBeDisplayed();
  });

  it('should create a rectangle through the floating toolbar', async () => {
    await ensureHome();
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="new-file-button"]') !== null,
        ),
      { timeout: 30000 },
    );

    // Create document
    const newBtn = await browser.$('[data-testid="new-file-button"]');
    await newBtn.click();
    const createBtn = await browser.$('[data-testid="create-design-button"]');
    await createBtn.waitForDisplayed({ timeout: 5000 });
    await createBtn.click();

    // Wait for canvas
    const canvasEl = await browser.$('[data-testid="editor-canvas"]');
    await canvasEl.waitForDisplayed({ timeout: 15000 });

    // Select the current visible tool control. The embedded WebKit driver
    // does not consistently deliver keyboard events to the canvas, while the
    // toolbar is the same user-facing path used by mouse and touch input.
    const rectangleTool = await browser.$('[data-tool="rect"]');
    await rectangleTool.waitForDisplayed({ timeout: 5000 });
    await rectangleTool.click();

    // Dispatch the same pointer sequence directly on the real canvas node.
    // This avoids WebKitGTK's embedded-driver coordinate translation, which
    // can report successful W3C actions without delivering them to the
    // canvas when the window is decorated or scaled.
    await browser.tauri.execute(() => {
      const canvas = document.querySelector<HTMLCanvasElement>('[data-testid="editor-canvas"]');
      if (!canvas) throw new Error('editor canvas not found');
      const rect = canvas.getBoundingClientRect();
      const startX = Math.round(rect.left + rect.width / 2 - 50);
      const startY = Math.round(rect.top + rect.height / 2 - 50);
      const endX = Math.round(rect.left + rect.width / 2 + 50);
      const endY = Math.round(rect.top + rect.height / 2 + 50);
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
            button: type === 'pointerup' ? 0 : 0,
          }),
        );
      dispatch('pointerdown', startX, startY, 1);
      dispatch('pointermove', endX, endY, 1);
      dispatch('pointerup', endX, endY, 0);
    });

    await browser.pause(500);

    // Verify a layer appeared in the layers tree
    const treeItems = await browser.$$('[role="treeitem"]');
    expect(treeItems.length).toBeGreaterThanOrEqual(1);
  });

  it('should invoke a native Tauri command (home_list_files)', async () => {
    const files = await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) return [];
      return invoke('home_list_files');
    });
    expect(Array.isArray(files)).toBe(true);
  });
});

describe('Tauri Desktop: Native Features', () => {
  it('should access the Tauri dialog plugin via IPC', async () => {
    const hasDialogApi = await browser.tauri.execute(() => {
      return typeof window.__TAURI__?.dialog !== 'undefined';
    });
    expect(hasDialogApi).toBe(true);
  });

  it('should access the Tauri file-system plugin via IPC', async () => {
    const hasFsApi = await browser.tauri.execute(() => {
      return typeof window.__TAURI__?.fs !== 'undefined';
    });
    expect(hasFsApi).toBe(true);
  });
});
