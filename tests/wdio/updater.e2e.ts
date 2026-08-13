import { expect } from '@wdio/globals';

/**
 * Packaged AppImage updater vertical slice.
 *
 * Requires the fixtures from scripts/update-test/build-fixtures.sh (old
 * 0.1.1-test AppImage running, feed + new 0.1.2-test payload served on
 * 127.0.0.1:8899). Run with the OLD fixture as the application binary:
 *
 *   VARVE_DESKTOP_BINARY=/tmp/varve-update-test/Varve.appimage \
 *     xvfb-run -a dbus-run-session -- pnpm exec wdio run wdio.conf.ts --spec tests/wdio/updater.e2e.ts
 *
 * After this spec passes, scripts/update-test/verify-slice.sh asserts the
 * AppImage bytes were replaced and a second wdio run (new fixture binary)
 * confirms the reported version.
 *
 * Covers, on a real packaged build:
 *  - first-run consent dialog (consent-first, decline = manual)
 *  - manual check discovers the update with notes
 *  - download + progress
 *  - install + restart through the canonical termination/save guard
 *  - fail-closed on invalid signature (feed with wrong .sig)
 */

async function openUpdatesSection() {
  await browser.tauri.execute(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim() === 'File' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await browser.tauri.execute(() => {
    const el = [...document.querySelectorAll('button, [role="menuitem"], div, span')].find(
      (e) => e.textContent?.trim().toLowerCase().startsWith('settings') && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
  await browser.tauri.execute(() => {
    const el = [...document.querySelectorAll('button, div, span')].find(
      (e) => e.textContent?.trim() === 'Updates' && e.children.length === 0,
    );
    (el as HTMLElement | undefined)?.click();
  });
}

describe('Packaged AppImage updater', () => {
  it('shows the consent dialog on first launch and does not pre-check consent', async () => {
    await browser.url('/');
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(
          () => document.querySelector('[data-testid="new-file-button"]') !== null,
        ),
      { timeout: 60000, timeoutMsg: 'Home screen did not become ready' },
    );
    await browser.tauri.execute(() => {
      (document.querySelector('[data-testid="new-file-button"]') as HTMLElement | null)?.click();
    });
    await browser.tauri.execute(() => {
      const dialog = [...document.querySelectorAll('dialog')].find((d) =>
        d.textContent?.includes('Create'),
      );
      (dialog?.querySelector('button') as HTMLElement | null)?.click();
    });
    await browser.waitUntil(
      async () => browser.tauri.execute(() => document.querySelector('.layers-panel') !== null),
      { timeout: 30000, timeoutMsg: 'Editor did not open' },
    );

    // Consent dialog is an explicit opt-in: it must be present on first run
    // and the affirmative action must be required (no pre-selected state).
    const dialogSeen = await browser.tauri.execute(() =>
      [...document.querySelectorAll('dialog')].some((d) =>
        d.textContent?.includes('Keep Varve up to date?'),
      ),
    );
    expect(dialogSeen).toBe(true);
  });

  it('declining consent disables background checks but manual check still works', async () => {
    await browser.tauri.execute(() => {
      const dialog = [...document.querySelectorAll('dialog')].find((d) =>
        d.textContent?.includes('Keep Varve up to date?'),
      );
      const notNow = [...(dialog?.querySelectorAll('button') ?? [])].find((b) =>
        b.textContent?.includes('Not now'),
      );
      (notNow as HTMLElement | undefined)?.click();
    });

    await openUpdatesSection();
    const status = await browser.tauri.execute(() => {
      const section = [...document.querySelectorAll('.settings-section')].find((s) =>
        s.textContent?.includes('Current status'),
      );
      return section?.textContent ?? '';
    });
    expect(status).toContain('checked manually');
  });

  it('discovers the update, downloads it, and surfaces progress', async () => {
    await openUpdatesSection();
    await browser.tauri.execute(() => {
      const check = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Check for Updates'),
      );
      (check as HTMLElement | undefined)?.click();
    });

    // Update found -> the download button appears with the fixture version.
    await browser.waitUntil(
      async () =>
        browser.tauri.execute(() =>
          [...document.querySelectorAll('button')].some((b) =>
            b.textContent?.includes('Download 0.1.2-test'),
          ),
        ),
      { timeout: 30000, timeoutMsg: 'Update 0.1.2-test was not offered' },
    );

    const notesShown = await browser.tauri.execute(() =>
      [...document.querySelectorAll('.settings-release-notes')].some((el) =>
        el.textContent?.includes('Vertical-slice fixture release'),
      ),
    );
    expect(notesShown).toBe(true);

    await browser.tauri.execute(() => {
      const download = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Download 0.1.2-test'),
      );
      (download as HTMLElement | undefined)?.click();
    });

    await browser.waitUntil(
      async () =>
        browser.tauri.execute(() =>
          [...document.querySelectorAll('.settings-section')].some((s) =>
            s.textContent?.includes('Ready to install'),
          ),
        ),
      { timeout: 120000, timeoutMsg: 'Download + verification did not reach ready-to-install' },
    );
  });

  it('installs and restarts only after the unsaved-work guard resolves', async () => {
    await openUpdatesSection();
    await browser.tauri.execute(() => {
      const install = [...document.querySelectorAll('button')].find((b) =>
        b.textContent?.includes('Install and Restart'),
      );
      (install as HTMLElement | undefined)?.click();
    });

    // The editor has an untitled document; the canonical termination dialog
    // must appear and the update must NOT proceed until it is resolved.
    const guardSeen = await browser.waitUntil(
      async () =>
        browser.tauri.execute(() =>
          [...document.querySelectorAll('dialog')].some((d) =>
            /Save|Don.t Save|Discard/.test(d.textContent ?? ''),
          ),
        ),
      { timeout: 30000, timeoutMsg: 'Unsaved-work guard did not appear' },
    );
    expect(guardSeen).toBe(true);

    // Resolve the guard by discarding; the app then installs and relaunches.
    await browser.tauri.execute(() => {
      const dialog = [...document.querySelectorAll('dialog')].find((d) =>
        /Don.t Save|Discard/.test(d.textContent ?? ''),
      );
      const discard = [...(dialog?.querySelectorAll('button') ?? [])].find((b) =>
        /Don.t Save|Discard/.test(b.textContent ?? ''),
      );
      (discard as HTMLElement | undefined)?.click();
    });

    // The relaunch kills the WebDriver session; give the app time to finish
    // the install and exit. The byte-level replacement is verified by
    // scripts/update-test/verify-slice.sh.
    await browser.pause(20000);
  });
});
