/**
 * Browser save/export picker outcomes.
 *
 * `platform.saveBinaryFile` is the single browser write path for both document
 * saves and exports. The File System Access picker can fail for reasons that
 * are NOT a user cancel — most often a `SecurityError` because the transient
 * activation that was live when the command started expired during the async
 * work that prepared the bytes. Treating that as a cancel silently discarded
 * the export: the file was never written and the status only said "cancelled".
 *
 * These cases drive the real File > Export SVG path with a stubbed picker so
 * each outcome is deterministic. Evidence class: synthetic browser input in
 * headless Chromium.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

type PickerOutcome = 'security-error' | 'abort' | 'not-allowed' | 'ok';

/** Install a save picker that resolves or fails with the given DOMException. */
async function installPicker(page: Page, outcome: PickerOutcome): Promise<void> {
  await page.addInitScript((mode: PickerOutcome) => {
    const win = window as unknown as Record<string, unknown>;
    Object.defineProperty(win, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: async () => {
        if (mode === 'security-error') {
          throw new DOMException('User activation is required', 'SecurityError');
        }
        if (mode === 'abort') {
          throw new DOMException('The user aborted a request.', 'AbortError');
        }
        if (mode === 'not-allowed') {
          throw new DOMException('Permission denied', 'NotAllowedError');
        }
        return {
          name: 'picked.svg',
          createWritable: async () => ({ write: async () => {}, close: async () => {} }),
        };
      },
    });
  }, outcome);
}

async function exportDocumentSvg(page: Page): Promise<void> {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).click();
  await page
    .locator('.editor-menubar__menu-item')
    .filter({ hasText: /^Export SVG/ })
    .click();
}

test.describe('browser save picker outcomes', () => {
  test('a picker refusal that is not a cancel still writes the file', async ({ page }) => {
    await installPicker(page, 'security-error');
    await navigateToEditor(page);

    const downloadPromise = page.waitForEvent('download', { timeout: 60000 });
    await exportDocumentSvg(page);
    const download = await downloadPromise;

    expect(download.suggestedFilename()).toMatch(/\.svg$/);
    const path = await download.path();
    expect(path).toBeTruthy();
    const { readFileSync } = await import('node:fs');
    const svg = readFileSync(path as string, 'utf8');
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(50);
  });

  test('a user cancel writes nothing', async ({ page }) => {
    await installPicker(page, 'abort');
    await navigateToEditor(page);

    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await exportDocumentSvg(page);
    await page.waitForTimeout(4000);
    expect(downloaded).toBe(false);
  });

  test('a blocked picker writes nothing and is not reported as a cancel', async ({ page }) => {
    await installPicker(page, 'not-allowed');
    await navigateToEditor(page);

    let downloaded = false;
    page.on('download', () => {
      downloaded = true;
    });
    await exportDocumentSvg(page);
    await page.waitForTimeout(4000);
    expect(downloaded).toBe(false);
    // NotAllowedError is propagated, so the failure is announced as a failure
    // rather than as an ordinary cancellation.
    await expect(page.locator('#strata-canvas-announcer-polite')).not.toHaveText(
      /SVG export cancelled/,
    );
  });
});
