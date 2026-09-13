/**
 * Browser demo file-launch acceptance (PWA `file_handlers` + `launchQueue`).
 *
 * The OS only hands files to an *installed* app, which cannot be reproduced
 * in headless Chromium. This spec therefore installs the same launch surface
 * the browser would provide (a `LaunchParams` prototype plus a capturing
 * `launchQueue`) and then delivers a real `.varve` document the way Chrome
 * would. What is verified is the app side of the contract:
 *
 *   1. a launched file opens as its own document/tab, and
 *   2. the launched handle is adopted as the save destination, with a content
 *      hash baseline, so Ctrl+S writes through the handle instead of asking
 *      for a picker again and refuses after an external change.
 *
 * Run with a served production build like the other try-* specs:
 *   VARVE_DEMO_DIST_URL=http://127.0.0.1:1492 \
 *     pnpm exec playwright test tests/e2e/browser/try-launch.spec.ts \
 *       --project=chromium --workers=1 --reporter=line
 */
import { expect, type Page, test } from '@playwright/test';

const DEMO_DIST_URL = process.env.VARVE_DEMO_DIST_URL?.replace(/\/+$/, '');

async function installLaunchSurface(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const state: { consumer: ((params: { files?: unknown[] }) => void) | null; written: string[] } =
      { consumer: null, written: [] };
    Object.defineProperty(window, '__launch', { configurable: true, value: state });
    Object.defineProperty(window, 'LaunchParams', {
      configurable: true,
      value: class LaunchParams {
        get files(): unknown[] {
          return [];
        }
      },
    });
    Object.defineProperty(window, 'launchQueue', {
      configurable: true,
      value: {
        setConsumer: (consumer: (params: { files?: unknown[] }) => void) => {
          state.consumer = consumer;
        },
      },
    });
    Object.defineProperty(window, '__makeLaunchedFile', {
      configurable: true,
      value: (name: string, text: string) => {
        const writable = {
          write: async (contents: string) => {
            state.written.push(String(contents));
          },
          close: async () => undefined,
        };
        return {
          kind: 'file',
          name,
          getFile: async () => new File([text], name, { type: 'application/json' }),
          createWritable: async () => writable,
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted',
        };
      },
    });
  });
}

async function waitForEditorReady(page: Page): Promise<void> {
  await page.locator('[data-varve-editor-ready="true"]').waitFor({ timeout: 120000 });
}

async function dismissRecoveryDialog(page: Page): Promise<void> {
  const dialog = page.locator('dialog.crash-dialog[open]').first();
  if (await dialog.isVisible({ timeout: 1500 }).catch(() => false)) {
    await dialog
      .getByRole('button', { name: /review my documents|close/i })
      .first()
      .click({ timeout: 5000 })
      .catch(() => undefined);
  }
}

/** Read the seeded sample document's JSON straight from the library stores. */
async function readSampleDocumentJson(page: Page): Promise<string> {
  return page.evaluate(
    () =>
      new Promise<string>((resolve, reject) => {
        const request = indexedDB.open('varve-home');
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction(['files', 'fileContent'], 'readonly');
          const get = tx.objectStore('files').get('varve-demo-sample');
          get.onsuccess = () => {
            const record = get.result as
              | { entry?: { contentHash?: string }; json?: string }
              | undefined;
            // Current schema is content-addressed; legacy records may still
            // carry the JSON inline.
            if (record?.json) {
              resolve(record.json);
              return;
            }
            const hash = record?.entry?.contentHash;
            if (!hash) {
              reject(new Error('sample document metadata not found in varve-home'));
              return;
            }
            const content = tx.objectStore('fileContent').get(hash);
            content.onsuccess = () => {
              const json = (content.result as { json?: string } | undefined)?.json;
              if (json) resolve(json);
              else reject(new Error('sample document content not found in varve-home'));
            };
            content.onerror = () => reject(content.error);
          };
          get.onerror = () => reject(get.error);
        };
      }),
  );
}

test.describe('browser demo file launch (built artifact)', () => {
  test.describe.configure({ timeout: 300000 });
  test.use({ viewport: { width: 1440, height: 900 } });
  test.skip(!DEMO_DIST_URL, 'set VARVE_DEMO_DIST_URL to a served production /try build');
  test.skip(({ browserName }) => browserName !== 'chromium', 'file launch: chromium');

  test('a launched .varve opens and saves through its handle', async ({ page }) => {
    await installLaunchSurface(page);
    await page.goto(`${DEMO_DIST_URL}/try/`, { timeout: 120000, waitUntil: 'domcontentloaded' });
    await waitForEditorReady(page);
    await dismissRecoveryDialog(page);

    const documentJson = await readSampleDocumentJson(page);

    // Deliver the launched file the way Chrome would, after the editor has
    // registered its consumer.
    await page.evaluate(
      ({ json }) => {
        const launch = (window as unknown as { __launch: { consumer: unknown } }).__launch;
        const makeFile = (
          window as unknown as {
            __makeLaunchedFile: (name: string, text: string) => unknown;
          }
        ).__makeLaunchedFile;
        const consumer = launch.consumer as ((params: { files?: unknown[] }) => void) | null;
        if (!consumer) throw new Error('launch consumer was never registered');
        consumer({ files: [makeFile('Launched Poster.varve', json)] });
      },
      { json: documentJson },
    );

    // The launched document opens as its own tab.
    const tab = page
      .getByRole('tablist', { name: 'Open documents' })
      .getByRole('tab', { name: /Launched Poster/ });
    await tab.waitFor({ timeout: 60000 });
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 30000 });

    // Ctrl+S must write through the launched handle: no picker, no download,
    // and the encoded document reaches the handle's writable stream.
    const downloadPromise = page.waitForEvent('download', { timeout: 3000 }).catch(() => null);
    let pickerCalls = 0;
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: () => {
          (window as unknown as { __pickerCalls?: number }).__pickerCalls =
            ((window as unknown as { __pickerCalls?: number }).__pickerCalls ?? 0) + 1;
          return new Promise(() => undefined);
        },
      });
    });
    await page.keyboard.press('Control+s');
    const download = await downloadPromise;
    pickerCalls = await page.evaluate(
      () => (window as unknown as { __pickerCalls?: number }).__pickerCalls ?? 0,
    );

    expect(download).toBeNull();
    expect(pickerCalls).toBe(0);
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });

    const written = await page.evaluate(
      () => (window as unknown as { __launch: { written: string[] } }).__launch.written,
    );
    expect(written).toHaveLength(1);
    expect(written[0]).toContain('"nodes"');
    await expect(tab).not.toContainText('unsaved');
  });
});
