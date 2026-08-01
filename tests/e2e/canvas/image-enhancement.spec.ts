import path from 'node:path';
import { expect, test } from '@playwright/test';

import { navigateToEditor } from '../shared';

test('imports an image and upscales it through the dialog', async ({ page }) => {
  test.setTimeout(180000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
  await expect(page.getByRole('button', { name: /^Upscale$/ })).toBeVisible();

  // Open the upscale dialog via the canvas selection toolbar.
  await page.getByRole('button', { name: /^Upscale$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Apply the default deterministic CPU upscale. AI behavior is covered by
  // provider tests and should not make this dialog interaction depend on a
  // model download.
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
    timeout: 120000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });

  // Undo.
  await page.keyboard.press('Control+z');
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});

test('denoises with SCUNet before applying a CPU upscale', async ({ page }) => {
  await page.addInitScript(() => {
    const BrowserWorker = window.Worker;
    class ScunetWorkerStub {
      onmessage: ((event: MessageEvent) => void) | null = null;
      onerror: ((event: ErrorEvent) => void) | null = null;

      postMessage(message: {
        requestId: string;
        tensors?: { image?: { data: Float32Array; dims: number[] } };
      }) {
        const input = message.tensors?.image;
        queueMicrotask(() => {
          this.onmessage?.({
            data: {
              type: 'result',
              requestId: message.requestId,
              outputs: {
                output: { data: input?.data ?? new Float32Array(), dims: input?.dims ?? [] },
                executionProvider: 'e2e-scunet-stub',
              },
            },
          } as MessageEvent);
        });
      }

      terminate() {}
    }

    Object.defineProperty(window, 'Worker', {
      configurable: true,
      value: new Proxy(BrowserWorker, {
        construct(target, args) {
          if (String(args[0]).includes('inferenceWorker')) return new ScunetWorkerStub();
          return Reflect.construct(target, args);
        },
      }),
    });
  });

  await navigateToEditor(page);
  await page.evaluate(async () => {
    const db = await new Promise<IDBDatabase>((resolve, reject) => {
      const request = indexedDB.open('strata-model-store', 2);
      request.onupgradeneeded = () => {
        if (!request.result.objectStoreNames.contains('models')) {
          request.result.createObjectStore('models');
        }
        if (!request.result.objectStoreNames.contains('partials')) {
          request.result.createObjectStore('partials');
        }
      };
      request.onsuccess = () => resolve(request.result);
      request.onerror = () => reject(request.error);
    });
    await new Promise<void>((resolve, reject) => {
      const transaction = db.transaction('models', 'readwrite');
      transaction.objectStore('models').put(new Blob([new Uint8Array([1])]), 'scunet');
      transaction
        .objectStore('models')
        .put(new Blob([new Uint8Array([1])]), 'scunet__externaldata');
      transaction.oncomplete = () => resolve();
      transaction.onerror = () => reject(transaction.error);
    });
    db.close();
  });

  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: /^Upscale$/ }).click();
  await page
    .getByRole('radiogroup', { name: 'Denoise strength' })
    .getByText('Light', { exact: true })
    .click();
  await expect(page.getByRole('button', { name: 'Upscale image' })).toBeEnabled();
  await page.getByRole('button', { name: 'Upscale image' }).click();

  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10000 });
});

test('opens the upscale dialog via keyboard shortcut', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  // Use the keyboard shortcut to open the dialog.
  await page.keyboard.press('Control+Shift+U');
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Close via Escape.
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible();
});

test('cancels the upscale dialog without applying', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: /^Upscale$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Cancel.
  await page.getByRole('button', { name: 'Cancel' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});

test('changes scale factor in the upscale dialog', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: /^Upscale$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Balanced mode (bicubic) is the default; change its scale.
  await page
    .getByRole('radiogroup', { name: 'Scale factor' })
    .getByText('3x', { exact: true })
    .click();
  await expect(page.getByText('Output 48by48px', { exact: false })).toBeVisible();

  await page.getByRole('button', { name: 'Cancel' }).click();
});

test('switches output behavior in the upscale dialog', async ({ page }) => {
  test.setTimeout(60000);
  await navigateToEditor(page);
  await page
    .locator('#file-import-input')
    .setInputFiles(path.resolve('apps/desktop/public/icons/favicon-16x16.png'));

  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });

  await page.getByRole('button', { name: /^Upscale$/ }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).toBeVisible();

  // Switch to "Replace source" output.
  await page
    .getByRole('radiogroup', { name: 'Output behavior' })
    .getByText('Replace source', { exact: true })
    .click();

  // Apply — should replace the source, not create a new layer.
  await page.getByRole('button', { name: 'Upscale image' }).click();
  await expect(page.getByRole('dialog', { name: 'Upscale image' })).not.toBeVisible({
    timeout: 30000,
  });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 5000 });
});
