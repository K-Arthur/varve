import { execSync } from 'node:child_process';
import { expect } from '@wdio/globals';

const ARTIFACT_DIR = 'artifacts/updates';

async function capture(name: string): Promise<void> {
  try {
    await browser.saveScreenshot(`${ARTIFACT_DIR}/${name}.png`);
  } catch (error) {
    console.warn(`screenshot ${name} failed: ${String(error)}`);
  }
}

/**
 * Second half of the packaged AppImage vertical slice: relaunch the REPLACED
 * AppImage (now 0.1.2-test) and confirm:
 *  1. the reported version is the new one (update took effect)
 *  2. preferences survived the upgrade (no re-consent prompt)
 *  3. an invalid feed signature fails closed (error state, no install offer)
 *
 * Runner: scripts/update-test/run-slice.sh (swaps feed.json to a bad
 * signature before this run).
 */

async function nativeContext(): Promise<Record<string, unknown>> {
  return browser.tauri.execute(() =>
    (
      window as unknown as { __TAURI__: { core: { invoke: (c: string) => unknown } } }
    ).__TAURI__.core.invoke('update_packaging_context'),
  );
}

describe('Packaged AppImage updater — post-update verification', () => {
  it('reports the new version after the in-place replacement', async function () {
    this.timeout(180000);
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="new-file-button"]') !== null,
        ),
      { timeout: 120000, timeoutMsg: 'Home screen did not become ready' },
    );
    const context = await nativeContext();
    expect(context.currentVersion).toBe('0.1.2-test');
    expect(context.packageType).toBe('appimage');
    expect(context.updateAuthority).toBe('self-managed');
    expect(context.runtimeSupported).toBe(true);
  });

  it('does not re-prompt for consent after the upgrade', async () => {
    const dialogSeen = await browser.tauri.execute(() =>
      [...document.querySelectorAll('dialog')].some((d) =>
        d.textContent?.includes('Keep Varve up to date?'),
      ),
    );
    expect(dialogSeen).toBe(false);
  });

  it('rejects a feed whose signature does not match the payload', async function () {
    this.timeout(300000);
    // Runner has replaced feed.json with an invalid-signature entry for
    // 0.1.3-test. Check must find it; download must fail closed.
    await browser.tauri.execute(() => {
      const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
        (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
      );
      (el as HTMLElement | undefined)?.click();
    });
    await browser.tauri.execute(() => {
      const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
        (e) =>
          e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
      );
      (el as HTMLElement | undefined)?.click();
    });
    await browser.tauri.execute(() => {
      const el = [...document.querySelectorAll('button, div, span')].find(
        (e) => e.textContent?.trim() === 'Updates' && e.children.length === 0,
      );
      (el as HTMLElement | undefined)?.click();
    });

    await browser.tauri.execute(() => {
      const check = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Check for Updates'),
      );
      (check as HTMLElement | undefined)?.click();
    });
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(() =>
          [...document.querySelectorAll('button')].some((b) =>
            b.textContent?.includes('Download 0.1.3-test'),
          ),
        ),
      { timeout: 30000, timeoutMsg: 'Update 0.1.3-test was not offered' },
    );
    await browser.tauri.execute(() => {
      const download = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Download 0.1.3-test'),
      );
      (download as HTMLElement | undefined)?.click();
    });

    // Fail closed: error state, no ready-to-install, app still running.
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(() =>
          [...document.querySelectorAll('.settings-section')].some((s) =>
            /verification|signature|failed/i.test(s.textContent ?? ''),
          ),
        ),
      { timeout: 60000, timeoutMsg: 'Signature failure was not surfaced' },
    );
    const readyShown = await browser.tauri.execute(() =>
      [...document.querySelectorAll('.settings-section')].some((s) =>
        s.textContent?.includes('Ready to install'),
      ),
    );
    expect(readyShown).toBe(false);
    // The webview answering at all proves the app is still running.
    const title = await browser.tauri.execute(() => document.title);
    expect(typeof title).toBe('string');
    await capture('04-invalid-signature-error');
  });

  it('fails safely when the AppImage directory is not writable', async function () {
    this.timeout(300000);
    // Runner has swapped the feed to a VALID signature for 0.1.3-test (the
    // same new-fixture bytes, so download verifies fine). Make the AppImage
    // parent read-only, then install must fail without harming the running
    // app or the AppImage file.
    const testDir = process.env.UPDATE_TEST_DIR;
    expect(testDir).toBeTruthy();
    execSync(`chmod a-w ${testDir}`);
    try {
      await browser.tauri.execute(() => {
        const check = [...document.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Check for Updates'),
        );
        (check as HTMLElement | undefined)?.click();
      });
      await browser.waitUntil(
        async () =>
          browser.tauri.execute(() =>
            [...document.querySelectorAll('button')].some((b) =>
              b.textContent?.includes('Download 0.1.3-test'),
            ),
          ),
        { timeout: 30000, timeoutMsg: 'Update 0.1.3-test was not offered' },
      );
      await browser.tauri.execute(() => {
        const download = [...document.querySelectorAll('button')].find((b) =>
          b.textContent?.includes('Download 0.1.3-test'),
        );
        (download as HTMLElement | undefined)?.click();
      });

      // Download verifies; install hits the read-only directory. The
      // coordinator must surface an install error, never a ready-to-install
      // state, and the app must keep running.
      await browser.waitUntil(
        async () =>
          browser.tauri.execute(() =>
            [...document.querySelectorAll('.settings-section')].some((s) =>
              /install|could not|failed/i.test(s.textContent ?? ''),
            ),
          ),
        { timeout: 60000, timeoutMsg: 'Install failure was not surfaced' },
      );
      const readyShown = await browser.tauri.execute(() =>
        [...document.querySelectorAll('.settings-section')].some((s) =>
          s.textContent?.includes('Ready to install'),
        ),
      );
      expect(readyShown).toBe(false);
    } finally {
      execSync(`chmod u+w ${testDir}`);
    }
    const title = await browser.tauri.execute(() => document.title);
    expect(typeof title).toBe('string');
  });
});
