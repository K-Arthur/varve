/**
 * Depth Blur workflow E2E.
 *
 * Inference is stubbed at the Worker boundary (the real depth model is a
 * ~27 MB download that does not belong in CI), and the model store is seeded
 * so the loader resolves the depth model as installed. The stub returns a
 * deterministic left-to-right depth gradient with the real output contract
 * (pixel_values -> predicted_depth, dims [1, 518, 518]) so the editor's
 * dims handling is exercised for real.
 */
import fs from 'node:fs';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const DEPTH_MODEL_ID = 'depth-anything-v2-small';

function installWorkerStub() {
  return `
    (() => {
      const RealWorker = window.Worker;
      class DepthWorkerStub {
        onmessage = null;
        onerror = null;
        postMessage(message) {
          const depthOutput = () => {
            const size = 518;
            const data = new Float32Array(size * size);
            for (let y = 0; y < size; y++) {
              for (let x = 0; x < size; x++) {
                // Near on the left (raw nearIsHigh: high value = near).
                data[y * size + x] = 2.0 + 2.5 * (1 - x / size);
              }
            }
            return { data, dims: [1, size, size] };
          };
          const respond = (outputs) => {
            queueMicrotask(() => {
              this.onmessage?.({ data: { type: 'result', requestId: message.requestId, outputs } });
            });
          };
          if (message.type === 'infer' && message.modelType === 'depth') {
            respond({
              executionProvider: 'e2e-depth-stub',
              predicted_depth: depthOutput(),
            });
          } else if (message.type === 'infer') {
            respond({ executionProvider: 'e2e-depth-stub', output: depthOutput() });
          }
        }
        terminate() {}
      }
      Object.defineProperty(window, 'Worker', {
        configurable: true,
        value: new Proxy(RealWorker, {
          construct(target, args) {
            if (String(args[0]).includes('inferenceWorker')) return new DepthWorkerStub();
            return Reflect.construct(target, args);
          },
        }),
      });
    })();
  `;
}

function seedModelStore() {
  return `
    (() => {
      const put = () => {
        const request = indexedDB.open('varve-model-store', 2);
        request.onupgradeneeded = () => {
          if (!request.result.objectStoreNames.contains('models')) {
            request.result.createObjectStore('models');
          }
          if (!request.result.objectStoreNames.contains('partials')) {
            request.result.createObjectStore('partials');
          }
        };
        request.onsuccess = () => {
          const db = request.result;
          const tx = db.transaction('models', 'readwrite');
          // modelStore stores raw Blobs keyed by model id.
          tx.objectStore('models').put(new Blob([new Uint8Array([1])]), '${DEPTH_MODEL_ID}');
          tx.oncomplete = () => db.close();
        };
      };
      window.__varveSeedDepthModel = put;
      put();
    })();
  `;
}

/**
 * The app checks the model store on mount; a pre-load seed can race it under
 * load. Seed again after load, reload once, and re-enter the editor so the
 * cached-model check deterministically sees the model.
 */
async function navigateWithSeededModel(page: import('@playwright/test').Page) {
  await navigateToEditor(page);
  await page.evaluate(() => {
    (window as unknown as { __varveSeedDepthModel?: () => void }).__varveSeedDepthModel?.();
  });
  await page.reload({ timeout: 120000 });
  await page.getByRole('button', { name: /^new$/i }).waitFor({ state: 'visible', timeout: 60000 });
  await page.getByRole('button', { name: /^new$/i }).click({ force: true });
  await page
    .locator('dialog[open]')
    .getByRole('button', { name: /^create design$/i })
    .click({ timeout: 15000 });
  await page.locator('.layers-panel').waitFor({ timeout: 30000 });
  await page.waitForTimeout(800);
}

/** Click the first visible match of a regex against button labels. */
async function clickButton(page: import('@playwright/test').Page, pattern: RegExp) {
  const clicked = await page.evaluate(
    (sourceAndFlags) => {
      const re = new RegExp(sourceAndFlags.source, sourceAndFlags.flags);
      const btn = [...document.querySelectorAll('button')].find((b) =>
        re.test(b.textContent ?? ''),
      ) as HTMLButtonElement | undefined;
      if (!btn) return false;
      btn.click();
      return true;
    },
    { source: pattern.source, flags: pattern.flags },
  );
  expect(clicked).toBe(true);
}

async function importTestImage(page: import('@playwright/test').Page) {
  const imageDataUrl = await page.evaluate(() => {
    const c = document.createElement('canvas');
    c.width = 200;
    c.height = 160;
    const ctx = c.getContext('2d')!;
    ctx.fillStyle = '#3366cc';
    ctx.fillRect(0, 0, 200, 160);
    ctx.beginPath();
    ctx.ellipse(80, 80, 34, 44, 0, 0, Math.PI * 2);
    ctx.fillStyle = '#cc3344';
    ctx.fill();
    return c.toDataURL('image/png');
  });
  const base64 = imageDataUrl.split(',')[1]!;
  const tmpFile = path.join('/tmp', `depth-e2e-${Date.now()}.png`);
  fs.writeFileSync(tmpFile, Buffer.from(base64, 'base64'));
  await page.locator('#file-import-input').setInputFiles(tmpFile);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10000 });
}

/** Open the Inspector's Adjustments tab and expand the Depth Blur disclosure. */
async function openDepthBlurSection(page: import('@playwright/test').Page) {
  const adjustmentsTab = page.getByRole('tab', { name: 'Adjustments' });
  if (await adjustmentsTab.isVisible({ timeout: 2000 }).catch(() => false)) {
    await adjustmentsTab.click();
  }
  const trigger = page.getByRole('button', { name: 'Depth Blur' });
  await expect(trigger).toBeVisible({ timeout: 10000 });
  if ((await trigger.getAttribute('aria-expanded')) === 'false') {
    await trigger.click();
  }
  return page.getByRole('group', { name: 'Depth Blur' });
}

test.describe('Depth Blur workflow', () => {
  test.beforeEach(async ({ page }) => {
    await page.addInitScript(installWorkerStub);
    await page.addInitScript(seedModelStore);
    await navigateWithSeededModel(page);
  });

  test('generates a depth map, applies Depth Blur, picks focus, and removes it', async ({
    page,
  }) => {
    test.setTimeout(180000);
    await importTestImage(page);
    await page.locator('.layers-panel').getByRole('treeitem').click();
    const section = await openDepthBlurSection(page);

    // The model store is seeded, so the section should be ready at
    // "Generate Depth Map"; handle the download-first path as a fallback.
    await expect(
      section
        .getByRole('button')
        .filter({ hasText: /enable depth blur|generate depth map/i })
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await clickButton(page, /generate depth map/i);
    await expect(section.getByRole('button', { name: /save depth blur/i })).toBeVisible({
      timeout: 30000,
    });

    // Focus picker: click the far (right) side of the depth preview.
    await section.getByRole('button', { name: /pick focus/i }).click();
    const preview = section.locator('.insp-depth-heatmap__canvas');
    await preview.waitFor({ state: 'visible' });
    const box = (await preview.boundingBox())!;
    await page.mouse.click(box.x + box.width * 0.9, box.y + box.height * 0.5);
    const focalOutput = section.locator('output').first();
    // The right side is far in the stub gradient, so focus must shift upward
    // from the default 50%.
    await expect(focalOutput).not.toHaveText(/^50%$/, { timeout: 10000 });

    await section.getByRole('button', { name: /save depth blur/i }).click();
    await expect(section.getByRole('button', { name: /remove depth blur/i })).toBeVisible({
      timeout: 15000,
    });
    await expect(section.getByRole('button', { name: /save depth blur/i })).toBeVisible();

    // The canvas node now carries a Depth Blur effect; removing it cleans up.
    await section.getByRole('button', { name: /remove depth blur/i }).click();
    await expect(section.getByRole('button', { name: /save depth blur/i })).not.toBeVisible();
  });

  test('creates a depth-range mask on the image node', async ({ page }) => {
    test.setTimeout(180000);
    await importTestImage(page);
    await page.locator('.layers-panel').getByRole('treeitem').click();
    const section = await openDepthBlurSection(page);

    await expect(
      section
        .getByRole('button')
        .filter({ hasText: /enable depth blur|generate depth map/i })
        .first(),
    ).toBeVisible({ timeout: 20000 });
    await clickButton(page, /generate depth map/i);
    await expect(section.getByRole('button', { name: /create depth mask/i })).toBeVisible({
      timeout: 30000,
    });

    await section.getByRole('button', { name: /create depth mask/i }).click();
    // The mask becomes a native raster mask on the layer row.
    await expect(page.getByRole('treeitem').getByText(/mask/i).first()).toBeVisible({
      timeout: 15000,
    });
  });
});
