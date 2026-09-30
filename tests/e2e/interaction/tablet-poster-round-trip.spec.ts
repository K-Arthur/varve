/**
 * Keyboardless poster round trip — file and fidelity acceptance.
 *
 * This closes the gap the tablet audit left open: one document that is
 * imported, edited, saved, reopened, and exported, with the editing actions
 * driven by touch and the document compared on both sides of the save.
 *
 * Fidelity is asserted on the serialized document (per-node kind, geometry,
 * fill, and transform) and on the exported SVG bytes — not on a passing
 * screenshot or a successful download event.
 *
 * Evidence class: synthetic touch in headless Chromium. The browser's File
 * System Access picker is stubbed deterministically, exactly as
 * `tests/e2e/save/save-flow.spec.ts` does; that exercises the save/export
 * pipeline but not the real picker or its transient-activation behaviour.
 *
 *   pnpm exec playwright test tests/e2e/interaction/tablet-poster-round-trip.spec.ts \
 *     --project=chromium --workers=1 --reporter=list
 */
import { mkdtempSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { dismissTabletPanel, readEditorState } from '../helpers/tabletControls';
import { navigateToEditor } from '../shared';

interface SerializedNode {
  id?: string;
  kind?: string;
  transform?: number[];
  shape?: Record<string, unknown>;
  fill?: Record<string, unknown>;
}

interface SerializedDocument {
  nodes?: Record<string, SerializedNode>;
  assets?: Record<string, unknown>;
}

interface CapturedWrite {
  name: string;
  text: string;
}

/**
 * Stub the File System Access picker so saves and exports are deterministic,
 * and record every write so the test can inspect the actual bytes.
 */
async function installFilePickerStub(page: Page): Promise<void> {
  await page.addInitScript(() => {
    const win = window as unknown as Record<string, unknown>;
    const writes: Array<{ name: string; text: string }> = [];
    win.__varveWrites = () => writes;
    const decode = (data: unknown): string => {
      if (typeof data === 'string') return data;
      if (data instanceof Uint8Array) return new TextDecoder().decode(data);
      if (typeof ArrayBuffer !== 'undefined' && data instanceof ArrayBuffer) {
        return new TextDecoder().decode(new Uint8Array(data));
      }
      return '';
    };
    Object.defineProperty(win, 'showSaveFilePicker', {
      configurable: true,
      writable: true,
      value: async (opts: { suggestedName?: string }) => ({
        name: opts.suggestedName ?? 'document.varve',
        queryPermission: async () => 'granted',
        createWritable: async () => ({
          write: async (data: unknown) => {
            writes.push({ name: opts.suggestedName ?? 'document.varve', text: decode(data) });
          },
          close: async () => undefined,
        }),
      }),
    });
  });
}

async function capturedWrites(page: Page): Promise<CapturedWrite[]> {
  return page.evaluate(
    () => (window as unknown as { __varveWrites?: () => CapturedWrite[] }).__varveWrites?.() ?? [],
  );
}

const serializeEditorDocument = async (page: Page): Promise<string> =>
  (await readEditorState(page)).serialized;

const selectionCount = async (page: Page): Promise<number> =>
  (await readEditorState(page)).selectionCount;

async function readDocument(page: Page): Promise<SerializedDocument> {
  return JSON.parse(await serializeEditorDocument(page)) as SerializedDocument;
}

/**
 * A stable projection of document content: node kind, geometry, fill, and
 * transform keyed by id. Volatile metadata (file name, thumbnail, timestamps)
 * is deliberately excluded; content fidelity is what the round trip must keep.
 */
function contentSignature(doc: SerializedDocument): string {
  const nodes = doc.nodes ?? {};
  return Object.keys(nodes)
    .sort()
    .map((id) => {
      const node = nodes[id] ?? {};
      return [
        id,
        node.kind ?? '',
        JSON.stringify(node.transform ?? null),
        JSON.stringify(node.shape ?? null),
        JSON.stringify(node.fill ?? null),
      ].join('|');
    })
    .join('\n');
}

async function settle(page: Page): Promise<void> {
  await page.evaluate(
    () =>
      new Promise<void>((resolve) => {
        requestAnimationFrame(() => requestAnimationFrame(() => resolve()));
      }),
  );
}

test.describe('keyboardless poster round trip', () => {
  test.use({ hasTouch: true, viewport: { width: 1200, height: 750 } });

  test.beforeEach(async ({ page }) => {
    await page.addInitScript(() => {
      try {
        localStorage.setItem('strata-clean-shutdown', 'true');
        localStorage.removeItem('varve:crash-loop');
      } catch {
        // Storage unavailable: the app's in-memory fallback already applies.
      }
    });
  });

  test('imports a real image, edits, saves, reopens, and exports it', async ({
    page,
  }, testInfo) => {
    const pageErrors: string[] = [];
    page.on('pageerror', (error) => pageErrors.push(String(error)));

    await installFilePickerStub(page);
    await navigateToEditor(page);
    await expect(page.locator('html')).toHaveAttribute('data-layout-mode', 'tablet');
    // Assert the tablet palette is actually interactive before the workflow
    // depends on it, so a cold first paint under shared load fails here with a
    // clear message instead of consuming the whole test budget later.
    const trigger = page.getByRole('button', { name: 'Tablet editing controls' });
    await expect(trigger).toBeVisible({ timeout: 60000 });

    // Home-created documents are backed by Varve Library storage, so their
    // Save never reaches the file picker. Start an unbound document first —
    // the same contract `tests/e2e/save/save-flow.spec.ts` relies on.
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).tap();
    await page.locator('.editor-menubar__menu-item').filter({ hasText: /^New/ }).first().tap();
    await expect(page.locator('.save-status')).toHaveText('Not saved', { timeout: 15000 });

    // ── Import a real raster through the browser's file input ──────────────
    await page.locator('#file-import-input').setInputFiles('tests/e2e/fixtures/photo-fixture.jpg');

    await expect
      .poll(async () => Object.keys((await readDocument(page)).nodes ?? {}).length, {
        timeout: 30000,
      })
      .toBeGreaterThanOrEqual(2);

    const imported = await readDocument(page);
    const importedAssets = Object.keys(imported.assets ?? {});
    expect(importedAssets.length).toBeGreaterThan(0);
    const imageNodes = Object.entries(imported.nodes ?? {}).filter(
      ([, node]) => node.kind === 'shape',
    );
    expect(imageNodes.length).toBeGreaterThan(0);

    // ── Edit without a keyboard: duplicate through the tablet controls ─────
    // Imported content is placed and selected; a canvas tap is the touch path
    // to a selection if it is not.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas not laid out');
    // Used only as the popover's fallback dismissal path. Non-click-through is
    // proven in `tablet-keyboardless-workflow.spec.ts`, which has empty canvas
    // to tap; here the imported image fills the viewport.
    const emptyPoint = { x: box.x + box.width - 80, y: box.y + 80 };
    if ((await selectionCount(page)) === 0) {
      await page.touchscreen.tap(box.x + box.width / 2, box.y + box.height / 2);
      await settle(page);
    }
    await expect
      .poll(async () => await selectionCount(page), { timeout: 10000 })
      .toBeGreaterThan(0);

    const triggerPanel = page.getByRole('dialog', { name: 'Tablet editing controls' });
    await expect(trigger).toBeVisible({ timeout: 30000 });
    await trigger.tap();
    await expect(triggerPanel).toBeVisible();
    const duplicate = triggerPanel.getByRole('button', { name: 'Duplicate' });
    await expect(duplicate).toBeEnabled();
    const beforeDuplicate = Object.keys((await readDocument(page)).nodes ?? {}).length;
    await duplicate.tap();
    await expect
      .poll(async () => Object.keys((await readDocument(page)).nodes ?? {}).length, {
        timeout: 10000,
      })
      .toBeGreaterThan(beforeDuplicate);
    await dismissTabletPanel(page, trigger, triggerPanel, emptyPoint);

    await settle(page);
    const beforeSave = await serializeEditorDocument(page);
    const beforeDoc = JSON.parse(beforeSave) as SerializedDocument;
    const beforeSignature = contentSignature(beforeDoc);

    // ── Save through the File menu (touch), capturing the written bytes ────
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).tap();
    await page.locator('.editor-menubar__menu-item').filter({ hasText: /^Save/ }).first().tap();
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });

    const writes = await capturedWrites(page);
    const documentWrite = writes.find((entry) => entry.name.endsWith('.varve'));
    expect(documentWrite, 'a .varve document was written').toBeTruthy();
    const savedDoc = JSON.parse(documentWrite?.text ?? '{}') as SerializedDocument;
    expect(contentSignature(savedDoc)).toBe(beforeSignature);
    expect(Object.keys(savedDoc.assets ?? {}).length).toBe(importedAssets.length);

    const roundTripDir = mkdtempSync(join(tmpdir(), 'varve-roundtrip-'));
    const documentPath = join(roundTripDir, 'tablet-poster.varve');
    writeFileSync(documentPath, documentWrite?.text ?? '');

    // ── Reopen the saved file in a fresh editor session ────────────────────
    await navigateToEditor(page);
    await page.locator('#file-open-input').setInputFiles(documentPath);
    await expect
      .poll(
        async () => {
          const doc = await readDocument(page);
          return contentSignature(doc) === beforeSignature;
        },
        { timeout: 30000 },
      )
      .toBe(true);

    const reopened = await readDocument(page);
    expect(Object.keys(reopened.assets ?? {}).length).toBe(importedAssets.length);
    expect(Object.keys(reopened.nodes ?? {}).length).toBe(
      Object.keys(beforeDoc.nodes ?? {}).length,
    );

    // ── Export the reopened document to SVG and inspect the bytes ──────────
    await page.getByRole('menubar').getByRole('menuitem', { name: 'File', exact: true }).tap();
    await page
      .locator('.editor-menubar__menu-item')
      .filter({ hasText: /^Export SVG/ })
      .tap();
    await expect
      .poll(async () => (await capturedWrites(page)).some((entry) => entry.name.endsWith('.svg')), {
        timeout: 60000,
      })
      .toBe(true);

    const svgWrite = (await capturedWrites(page)).find((entry) => entry.name.endsWith('.svg'));
    const svg = svgWrite?.text ?? '';
    expect(svg).toContain('<svg');
    expect(svg.length).toBeGreaterThan(1000);
    // The imported raster must survive as an embedded image, not be dropped.
    expect(svg).toMatch(/<image\b/);

    await settle(page);
    await page.screenshot({ path: testInfo.outputPath('poster-round-trip.png') });
    await testInfo.attach('poster-round-trip', {
      path: testInfo.outputPath('poster-round-trip.png'),
      contentType: 'image/png',
    });

    expect(pageErrors).toEqual([]);
  });
});
