import { createHash } from 'node:crypto';
import { readFileSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToCleanEditor } from '../helpers/nav';

type WrittenFile = { name: string; bytes: number[] };
type SavedDocument = {
  formatVersion: string;
  nodes: Record<
    string,
    {
      text?: string;
      transform: number[];
      fills?: { type: string; image?: Record<string, unknown> }[];
    }
  >;
  assets: Record<string, { dataUrl: string }>;
  designCanvases: unknown[];
};
const directory = path.resolve('tests/e2e/fixtures/published-v021');
const fixture = readFileSync(path.join(directory, 'poster-embedded.varve'));
const original = JSON.parse(fixture.toString()) as SavedDocument;
const provenance = JSON.parse(readFileSync(path.join(directory, 'provenance.json'), 'utf8'));

/** Drive the real browser save coordinator with a deterministic OS-picker adapter. */
async function installFileAdapter(page: Page) {
  await page.addInitScript(() => {
    const win = window as unknown as { __publishedReleaseWrites: WrittenFile[] };
    win.__publishedReleaseWrites = [];
    Object.defineProperty(window, 'showOpenFilePicker', {
      configurable: true,
      value: async () => {
        throw new DOMException('Use the document input in this browser test', 'AbortError');
      },
    });
    Object.defineProperty(window, 'showSaveFilePicker', {
      configurable: true,
      value: async ({ suggestedName }: { suggestedName?: string }) => {
        const name = suggestedName ?? 'migration.varve';
        let retained = new Uint8Array();
        return {
          name,
          queryPermission: async () => 'granted',
          requestPermission: async () => 'granted',
          getFile: async () => new File([retained], name, { lastModified: 1 }),
          createWritable: async () => ({
            write: async (data: Blob | string | Uint8Array | ArrayBuffer) => {
              retained =
                typeof data === 'string'
                  ? new TextEncoder().encode(data)
                  : data instanceof Blob
                    ? new Uint8Array(await data.arrayBuffer())
                    : new Uint8Array(data);
              win.__publishedReleaseWrites.push({ name, bytes: Array.from(retained) });
            },
            close: async () => {},
          }),
        };
      },
    });
  });
}

async function latestWrite(page: Page, extension: string): Promise<WrittenFile> {
  const result = await page.evaluate((suffix) => {
    const writes = (window as unknown as { __publishedReleaseWrites: WrittenFile[] })
      .__publishedReleaseWrites;
    return writes.findLast((entry) => entry.name.endsWith(suffix));
  }, extension);
  if (!result) throw new Error(`No ${extension} output from the real save coordinator`);
  return result;
}

async function fileAction(page: Page, name: RegExp) {
  await page
    .getByRole('menubar')
    .getByRole('menuitem', { name: 'File', exact: true })
    .click({ timeout: 10000 });
  await page.getByRole('menu').getByRole('menuitem', { name }).click({ timeout: 10000 });
}

async function historyAction(page: Page, name: 'Undo' | 'Redo') {
  await page.getByRole('menubar').getByRole('menuitem', { name: 'Edit', exact: true }).click();
  await page
    .getByRole('menu')
    .getByRole('menuitem', { name: new RegExp(`^${name}`) })
    .click();
}

async function saveDocument(page: Page): Promise<SavedDocument> {
  const writeCount = await page.evaluate(
    () =>
      (window as unknown as { __publishedReleaseWrites: WrittenFile[] }).__publishedReleaseWrites
        .length,
  );
  await fileAction(page, /^Save\b(?! As| a Copy)/);
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          (window as unknown as { __publishedReleaseWrites: WrittenFile[] })
            .__publishedReleaseWrites.length,
      ),
    )
    .toBeGreaterThan(writeCount);
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  return JSON.parse(Buffer.from((await latestWrite(page, '.varve')).bytes).toString());
}

function assertRetainedArtwork(saved: SavedDocument) {
  const legacyFill = original.nodes['published-embedded-image']!.fills![0]!;
  const { src: _redundantLegacySource, ...canonicalImage } = legacyFill.image!;
  expect(saved.formatVersion).toBe('2.33');
  expect(saved.designCanvases).toHaveLength(1);
  expect(saved.nodes['poster-title']?.text).toBe(original.nodes['poster-title']?.text);
  expect(saved.nodes['poster-curve']).toMatchObject(original.nodes['poster-curve']!);
  expect(saved.nodes['published-embedded-image']).toMatchObject({
    transform: original.nodes['published-embedded-image']!.transform,
    // Current saves deduplicate source bytes into Document.assets. The
    // canonical reference and authored image geometry must remain intact.
    fills: [{ ...legacyFill, image: canonicalImage }],
  });
  expect(saved.assets[provenance.syntheticAsset.assetId]?.dataUrl).toBe(
    original.assets[provenance.syntheticAsset.assetId]!.dataUrl,
  );
}

async function exportArtwork(page: Page, format: 'SVG' | 'PDF') {
  const tab = page.getByRole('tab', { name: 'Export', exact: true });
  if (await tab.isVisible()) await tab.click();
  else {
    await page.getByRole('button', { name: /^More inspector tabs/ }).click();
    await page
      .getByRole('menu', { name: 'More inspector tabs' })
      .getByRole('menuitem', { name: 'Export', exact: true })
      .click();
  }
  await page.getByRole('radio', { name: format, exact: true }).click();
  const download = page.waitForEvent('download');
  await page.getByRole('button', { name: /download/i }).click();
  const output = await download;
  expect(output.suggestedFilename()).toMatch(new RegExp(`\\.${format.toLowerCase()}$`));
  const outputPath = await output.path();
  if (!outputPath) throw new Error('Browser export did not produce a downloaded file');
  const bytes = readFileSync(outputPath);
  expect(bytes.length).toBeGreaterThan(100);
  return { name: output.suggestedFilename(), bytes: Array.from(bytes) };
}

test('published schema 2.21 artwork and embedded assets migrate, undo, export and reopen offline', async ({
  page,
}, testInfo) => {
  test.setTimeout(300000);
  const pageErrors: string[] = [];
  page.on('pageerror', (error) => pageErrors.push(error.message));
  expect(createHash('sha256').update(fixture).digest('hex')).toBe(provenance.fixture.sha256);
  expect(original.formatVersion).toBe('2.21');
  await installFileAdapter(page);
  await navigateToCleanEditor(page);
  await page.setInputFiles('#file-open-input', path.join(directory, 'poster-embedded.varve'));
  await expect(page.locator('.editor-shell h1.sr-only')).toContainText('poster-embedded.varve');
  await page.getByRole('button', { name: 'Fit all to viewport' }).click();
  await fileAction(page, /^Save As/);
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  assertRetainedArtwork(
    JSON.parse(Buffer.from((await latestWrite(page, '.varve')).bytes).toString()),
  );

  const image = page.getByRole('treeitem', { name: /^Published embedded image/ });
  const poster = page.getByRole('treeitem', { name: /^Poster — A3/ });
  if (!(await image.isVisible()))
    await poster.getByRole('button', { name: 'Expand', exact: true }).click();
  await image.click();
  // The Layers tree correctly owns arrow keys for row navigation. Make a
  // genuine document edit through the inspector before exercising history.
  const x = page.getByRole('spinbutton', { name: /^X(?: \(ab\))? \(px\)$/i });
  await x.fill(String(Number(await x.inputValue()) + 1));
  await x.press('Enter');
  await expect(page.locator('.save-status')).toHaveText('Modified');
  const moved = await saveDocument(page);
  expect(moved.nodes['published-embedded-image']!.transform[4]).toBeGreaterThan(
    original.nodes['published-embedded-image']!.transform[4]!,
  );
  await historyAction(page, 'Undo');
  const undone = await saveDocument(page);
  assertRetainedArtwork(undone);
  await historyAction(page, 'Redo');
  const redone = await saveDocument(page);
  expect(redone.nodes['published-embedded-image']!.transform).toEqual(
    moved.nodes['published-embedded-image']!.transform,
  );
  await historyAction(page, 'Undo');
  await page.context().setOffline(true);
  const offlineDocument = await saveDocument(page);
  assertRetainedArtwork(offlineDocument);
  const saved = await latestWrite(page, '.varve');
  writeFileSync(testInfo.outputPath('migrated-offline-save.varve'), Buffer.from(saved.bytes));

  await image.click();
  const svg = await exportArtwork(page, 'SVG');
  const svgText = Buffer.from(svg.bytes).toString();
  expect(svgText).toContain('<svg');
  expect(svgText).toContain('data:image/png;base64,');
  writeFileSync(testInfo.outputPath('migrated-embedded-image.svg'), Buffer.from(svg.bytes));
  const pdf = await exportArtwork(page, 'PDF');
  expect(Buffer.from(pdf.bytes).subarray(0, 5).toString()).toBe('%PDF-');
  writeFileSync(testInfo.outputPath('migrated-embedded-image.pdf'), Buffer.from(pdf.bytes));

  await fileAction(page, /^Close Document\b/);
  if (await page.locator('.editor-shell').isVisible()) await page.keyboard.press('Control+Shift+h');
  await expect(page.locator('.varve-home')).toBeVisible();
  // Reopen the bytes actually written while offline, through the real browser import UI.
  await page.keyboard.press('Control+i');
  const importer = page.locator('dialog.varve-dialog[open]');
  await importer.locator('input[type="file"]').setInputFiles({
    name: 'migrated-offline-save.varve',
    mimeType: 'application/json',
    buffer: Buffer.from(saved.bytes),
  });
  await importer.getByRole('button', { name: /^Add to library \(/i }).click({ timeout: 10000 });
  await expect(importer.locator('.bulk-import__results-success')).toHaveText('1 added');
  await importer.getByRole('button', { name: /close/i }).first().click({ timeout: 10000 });
  await page
    .getByRole('gridcell')
    .filter({ hasText: 'Varve Poster' })
    .first()
    .dblclick({ timeout: 10000 });
  await expect(page.locator('.editor-shell')).toBeVisible({ timeout: 60000 });
  await fileAction(page, /^Save As/);
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  assertRetainedArtwork(
    JSON.parse(Buffer.from((await latestWrite(page, '.varve')).bytes).toString()),
  );
  expect(await page.evaluate(() => navigator.onLine)).toBe(false);
  await page.screenshot({ path: testInfo.outputPath('published-migration-offline-reopened.png') });
  expect(pageErrors).toEqual([]);
});
