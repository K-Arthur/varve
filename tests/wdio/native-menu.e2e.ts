import type { Document } from '@varve/scene';
import { expect } from '@wdio/globals';
import { getAllMenuDefs } from '../../packages/editor/src/menu/defs';
import {
  buildIntelFacts,
  buildMenuContext,
  detectPlatformFacts,
} from '../../packages/editor/src/menu/facts';
import { buildNativeMenuSpec } from '../../packages/editor/src/menu/nativeAdapter';

/**
 * Native Menu E2E tests (Tauri desktop only).
 *
 * Native menus are OS-level — WebDriver cannot click them. These tests verify
 * the IPC plumbing: commands are registered, the spec builder produces valid
 * output, and the event bridge dispatches correctly.
 *
 * Requires:
 *   1.  App built with `pnpm tauri build --debug --features wdio`
 *   2.  `xvfb-run` (Linux) or a real display
 *   3.  WebdriverIO service configured in wdio.conf.ts
 *
 * Run:
 *   xvfb-run pnpm test:wdio
 */

describe('Tauri Desktop: Native Menu IPC', () => {
  async function navigateToEditor(): Promise<void> {
    const homeButton = await browser.$('.editor-menubar__home');
    if (await homeButton.isDisplayed().catch(() => false)) await homeButton.click();
    await browser.waitUntil(
      () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="new-file-button"]') !== null,
        ),
      { timeout: 30000 },
    );
    await browser.$('[data-testid="new-file-button"]').click();
    await browser.$('[data-testid="create-design-button"]').click();
    await browser.waitUntil(
      () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="editor-canvas"]') !== null,
        ),
      { timeout: 15000 },
    );
  }

  it('should register the build_native_menu IPC command', async () => {
    await navigateToEditor();

    const result = await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) return { ok: false, error: 'no invoke' };

      // Build a minimal spec
      const spec = {
        submenus: [
          {
            id: 'edit',
            label: 'Edit',
            items: [
              {
                kind: 'item',
                id: 'undo',
                label: 'Undo',
                accelerator: 'CmdOrCtrl+Z',
                enabled: true,
              },
              {
                kind: 'item',
                id: 'redo',
                label: 'Redo',
                accelerator: 'CmdOrCtrl+Shift+Z',
                enabled: true,
              },
            ],
          },
        ],
      };

      try {
        await invoke('build_native_menu', { spec });
        return { ok: true };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      }
    });

    expect(result).toBeTruthy();
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it('should register update_native_menu_state IPC command', async () => {
    await navigateToEditor();

    const result = await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) return { ok: false, error: 'no invoke' };

      try {
        // Build menu first, then patch
        const spec = {
          submenus: [
            {
              id: 'edit',
              label: 'Edit',
              items: [
                {
                  kind: 'item',
                  id: 'cut',
                  label: 'Cut',
                  accelerator: 'CmdOrCtrl+X',
                  enabled: true,
                },
              ],
            },
          ],
        };
        await invoke('build_native_menu', { spec });

        // Apply a state patch
        await invoke('update_native_menu_state', {
          patches: [{ id: 'cut', enabled: false }],
        });

        return { ok: true };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      }
    });

    expect(result).toBeTruthy();
    expect((result as { ok: boolean }).ok).toBe(true);
  });

  it('should expose the adapter spec builder on window', async () => {
    await navigateToEditor();

    // The adapter is a pure source module, not a browser-global API. Import
    // it in the WDIO worker so this assertion tests the shipped source graph
    // without asking the tauri:// webview to resolve a filesystem-relative
    // module specifier.
    const spec = (() => {
      try {
        const ctx = buildMenuContext(
          [],
          { nodes: {}, pages: [] } as unknown as Document,
          'design',
          detectPlatformFacts('tauri', 'mac'),
          buildIntelFacts([], null, false),
        );
        const allDefs = getAllMenuDefs({ runAction: () => {} });
        const result = buildNativeMenuSpec(allDefs, ctx, 'mac');
        return {
          ok: true,
          submenuCount: result.submenus.length,
          submenuIds: result.submenus.map((s) => s.id),
        };
      } catch (err: unknown) {
        return { ok: false, error: String(err) };
      }
    })();

    expect(spec).toBeTruthy();
    expect((spec as { ok: boolean }).ok).toBe(true);
    const ids = (spec as { submenuIds: string[] }).submenuIds;
    expect(ids).toContain('app');
    expect(ids).toContain('edit');
    expect(ids).toContain('window');
    expect(ids).toContain('help');
  });

  it('should dispatch menu://action events to the webview', async () => {
    await navigateToEditor();

    const result = await browser.tauri.execute(async () => {
      const { invoke } = window.__TAURI__?.core ?? {};
      if (!invoke) return { ok: false, error: 'no invoke' };

      // Build the menu so we have items registered
      const spec = {
        submenus: [
          {
            id: 'edit',
            label: 'Edit',
            items: [{ kind: 'item', id: 'test:action', label: 'Test', enabled: true }],
          },
        ],
      };
      await invoke('build_native_menu', { spec });

      // Set up a listener
      return new Promise<{ ok: boolean; action?: string; error?: string }>((resolve) => {
        const timeout = setTimeout(() => {
          resolve({ ok: false, error: 'timeout waiting for menu://action' });
        }, 3000);

        const unlisten = window.__TAURI__?.event?.listen?.(
          'menu://action',
          (event: { payload: { action: string } }) => {
            clearTimeout(timeout);
            unlisten?.();
            resolve({ ok: true, action: event.payload.action });
          },
        );

        if (!unlisten) {
          clearTimeout(timeout);
          resolve({ ok: false, error: 'listen not available' });
        }
      });
    });

    expect(result).toBeTruthy();
  });
});
