import { createHash } from 'node:crypto';
import { existsSync, mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const RAW_FIXTURE = path.resolve(process.env.VARVE_RAW_FIXTURE ?? '/tmp/varve-leica-m8.dng');
const BRACKET_DIR = path.resolve(process.env.VARVE_HDR_FIXTURE_DIR ?? '/tmp/varve-hdr-bracket');
const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');
const REVIEW_DIR = path.resolve('reports/ui-review/photo-raw-hdr');
const BRACKET_FILES = ['memorial03.png', 'memorial05.png', 'memorial07.png'].map((name) =>
  path.join(BRACKET_DIR, name),
);

async function openImageTuning(
  page: import('@playwright/test').Page,
): Promise<import('@playwright/test').Locator> {
  await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  await dismissRecovery(page);
  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
  const trigger = inspector.getByRole('button', { name: 'Image Tuning', exact: true });
  await expect(trigger).toBeVisible();
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  const section = inspector.locator('.image-tuning');
  await expect(section).toBeVisible();
  return section;
}

async function sha256(filePath: string): Promise<string> {
  return createHash('sha256')
    .update(await readFile(filePath))
    .digest('hex');
}

async function renderedColourCount(page: import('@playwright/test').Page): Promise<number> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) return 0;
    const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
    const colours = new Set<string>();
    for (let y = 0; y < canvas.height; y += 16) {
      for (let x = 0; x < canvas.width; x += 16) {
        const index = (y * canvas.width + x) * 4;
        if (pixels[index + 3] === 0) continue;
        colours.add(`${pixels[index]}:${pixels[index + 1]}:${pixels[index + 2]}`);
        if (colours.size >= 512) return colours.size;
      }
    }
    return colours.size;
  });
}

async function serializedDocument(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    interface EditorApi {
      serializeDocument: () => string;
    }

    function findEditor(value: unknown): EditorApi | null {
      if (typeof value !== 'object' || value === null) return null;
      const record = value as Record<string, unknown>;
      const props = record.memoizedProps;
      if (typeof props === 'object' && props !== null) {
        const candidate = (props as Record<string, unknown>).value;
        if (
          typeof candidate === 'object' &&
          candidate !== null &&
          typeof (candidate as Record<string, unknown>).serializeDocument === 'function'
        ) {
          return candidate as unknown as EditorApi;
        }
      }
      return findEditor(record.child) ?? findEditor(record.sibling);
    }

    const root = document.getElementById('root');
    if (!root) throw new Error('editor root is missing');
    const fiberKey = Object.keys(root).find(
      (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
    );
    if (!fiberKey) throw new Error('editor React fiber is missing');
    const editor = findEditor((root as unknown as Record<string, unknown>)[fiberKey]);
    if (!editor) throw new Error('editor context is missing');
    return editor.serializeDocument();
  });
}

async function dismissRecovery(page: import('@playwright/test').Page): Promise<void> {
  const recovery = page.locator('dialog.recovery-dialog[open]');
  // Recovery sessions are loaded asynchronously after the home/editor shell
  // mounts. Keep a short grace window even when the first poll sees nothing,
  // otherwise the modal can appear between this helper and the next click.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if ((await recovery.count()) > 0) {
      await recovery.locator('.recovery-dialog__close').click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(500);
  }
}

async function switchToPhotoWorkspace(page: Page): Promise<void> {
  const workspace = page.getByRole('radio', { name: 'Photo workspace' });
  if (await workspace.isVisible({ timeout: 1000 }).catch(() => false)) {
    await workspace.click();
    return;
  }
  await page.getByLabel('More workspaces').click();
  await page.getByRole('menuitemradio', { name: /^Photo(?:\s|$)/i }).click();
}

/**
 * The repair layer starts empty; healing must sample the composite below it,
 * so the scope has to leave the `current` default explicitly, exactly like
 * the retouch-tools spec does.
 */
async function chooseSamplingScope(
  page: Page,
  toolLabel: string,
  scopeLabel: string,
): Promise<void> {
  const optionsButton = page.getByRole('button', { name: 'Tool options' });
  await expect(optionsButton).toBeVisible();
  const options = page.getByRole('dialog', { name: `${toolLabel} tool options` });
  if ((await optionsButton.getAttribute('aria-expanded')) !== 'true') {
    await optionsButton.press('Enter');
  }
  await expect(options).toBeVisible();
  const sampling = options.getByRole('combobox', { name: 'Sampling scope' });
  await sampling.click();
  await page.getByRole('option', { name: scopeLabel, exact: true }).click();
  await expect(sampling).toContainText(scopeLabel);
  await page.keyboard.press('Escape');
}

/**
 * Hash the serialized document subtree of one layer. Repair pixels are
 * base64 tiles in the JSON, so equal hashes mean the persisted repair bytes
 * did not change — stronger than a canvas screenshot.
 */
async function repairLayerHash(page: Page): Promise<string> {
  return layerHash(page, 'Repair layer');
}

async function layerHash(page: Page, name: string): Promise<string> {
  const serialized = await serializedDocument(page);
  const document = JSON.parse(serialized) as {
    nodes?: Record<string, { name?: string; tiles?: Record<string, unknown> }>;
  };
  const layer = Object.values(document.nodes ?? {}).find((node) => node.name === name);
  if (!layer) throw new Error(`${name} is missing from the serialized document`);
  return createHash('sha256').update(JSON.stringify(layer)).digest('hex');
}

test.describe('Photo source, RAW, and bracket workflows', () => {
  test.describe.configure({ mode: 'serial' });

  test('develops a real DNG from sensor data and keeps the recipe visible', async ({
    page,
  }, testInfo) => {
    test.skip(
      !existsSync(RAW_FIXTURE),
      `set VARVE_RAW_FIXTURE to a supported DNG; missing ${RAW_FIXTURE}`,
    );
    test.setTimeout(300000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    const beforeHash = await sha256(RAW_FIXTURE);
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await dismissRecovery(page);
    const documentName = page.locator('.editor-menubar__doc-name-text');
    await documentName.click();
    const documentNameInput = page.getByRole('textbox', { name: 'Document name', exact: true });
    await documentNameInput.fill('RAW persistence fixture');
    await documentNameInput.press('Enter');
    await openImageTuning(page);
    const section = page.locator('.photo-source-section').first();
    const rawInput = section.locator('input[type="file"][accept=".dng,.DNG"]');
    await rawInput.setInputFiles(RAW_FIXTURE);

    await expect(section.getByTestId('photo-source-status')).toHaveText('RAW recipe', {
      timeout: 60000,
    });
    await expect(section).toContainText('varve-dng-bayer-uncompressed/1');
    await expect(section).toContainText(/Leica|Supported DNG/);
    await expect(section).toContainText('Sensor-clipped pixels:');
    await expect(section).toContainText('output clipping at reference white:');
    await expect
      .poll(() => renderedColourCount(page), {
        timeout: 60000,
        message: 'the developed RAW rendition should replace the loading frame',
      })
      .toBeGreaterThan(32);
    await section.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(REVIEW_DIR, '01-raw-developed.png'), fullPage: true });

    const exposure = section.getByRole('slider', { name: 'Exposure', exact: true });
    await exposure.fill('1');
    await expect(exposure).toHaveValue('1');
    await section.getByRole('button', { name: 'Compare pending', exact: true }).click();
    await expect(
      section.getByRole('group', { name: 'RAW before and after comparison', exact: true }),
    ).toBeVisible({
      timeout: 60000,
    });
    await page.screenshot({
      path: path.join(REVIEW_DIR, '02-raw-before-after.png'),
      fullPage: true,
    });

    await section.getByRole('button', { name: 'Apply development', exact: true }).click();
    await expect(section.getByTestId('photo-source-status')).toHaveText('RAW recipe');
    const layerRow = page.locator('.layers-panel__tree [role="treeitem"][data-node-id]').first();
    await expect(layerRow).toBeVisible({ timeout: 30000 });
    await layerRow.click({ force: true });
    await expect(section.getByTestId('photo-source-status')).toHaveText('RAW recipe');
    await expect
      .poll(() => serializedDocument(page), {
        timeout: 120000,
        message: 'the asynchronous RAW apply should commit its new recipe before save',
      })
      .toMatch(/"exposureStops":1(?:\.0+)?/);
    await expect.poll(() => sha256(RAW_FIXTURE)).toBe(beforeHash);
    const developedDownloadPromise = page.waitForEvent('download', { timeout: 30000 });
    await section.getByRole('link', { name: 'Download full-resolution developed SDR' }).click();
    const developedDownload = await developedDownloadPromise;
    const developedPath = await developedDownload.path();
    expect(developedPath).toBeTruthy();
    const developedPng = await readFile(developedPath!);
    expect(developedPng.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
    expect(developedPng.readUInt32BE(16)).toBe(3916);
    expect(developedPng.readUInt32BE(20)).toBe(2634);
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    expect(await serializedDocument(page)).toMatch(/"exposureStops":1(?:\.0+)?/);
    await page.reload({ timeout: 120000, waitUntil: 'commit' });
    await dismissRecovery(page);
    await page.locator('.varve-home').waitFor({ timeout: 45000 });
    const savedCard = page.getByRole('gridcell', { name: /RAW persistence fixture/ });
    await expect(savedCard).toBeVisible({ timeout: 30000 });
    await savedCard.dblclick({ timeout: 30000 });
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    await dismissRecovery(page);
    await page.getByRole('treeitem').first().click({ force: true });
    const reopenedInspector = page.locator('.editor__inspector-panel');
    await reopenedInspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    const reopenedTrigger = reopenedInspector.getByRole('button', {
      name: 'Image Tuning',
      exact: true,
    });
    if ((await reopenedTrigger.getAttribute('aria-expanded')) !== 'true') {
      await reopenedTrigger.click();
    }
    const reopenedSection = reopenedInspector.locator('.photo-source-section').first();
    await expect(reopenedSection.getByTestId('photo-source-status')).toHaveText('RAW recipe', {
      timeout: 60000,
    });
    await expect(reopenedSection).toContainText('Leica Camera AG M8 Digital Camera', {
      timeout: 60000,
    });
    await expect(
      reopenedSection.getByRole('slider', { name: 'Exposure', exact: true }),
    ).toHaveValue('1');
    await expect.poll(() => renderedColourCount(page), { timeout: 60000 }).toBeGreaterThan(32);
    await reopenedSection.scrollIntoViewIfNeeded();
    await page.screenshot({ path: path.join(REVIEW_DIR, '06-raw-reopened.png'), fullPage: true });
    await testInfo.attach('raw-development-panel', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });

  test('reviews a real exposure bracket and exports a range-bearing master plus SDR rendition', async ({
    page,
  }, testInfo) => {
    test.skip(
      !BRACKET_FILES.every((filePath) => existsSync(filePath)),
      `set VARVE_HDR_FIXTURE_DIR to the OpenCV memorial bracket; missing one or more files in ${BRACKET_DIR}`,
    );
    test.setTimeout(180000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    const beforeHashes = await Promise.all(BRACKET_FILES.map((filePath) => sha256(filePath)));
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await dismissRecovery(page);
    const documentName = page.locator('.editor-menubar__doc-name-text');
    await documentName.click();
    const documentNameInput = page.getByRole('textbox', { name: 'Document name', exact: true });
    await documentNameInput.fill('HDR master persistence fixture');
    await documentNameInput.press('Enter');
    await openImageTuning(page);
    const hdrSource = page.locator('.photo-source-section').nth(1);
    await hdrSource.getByRole('button', { name: 'Merge exposure bracket', exact: true }).click();
    const dialog = page.getByRole('dialog', { name: 'Merge exposure bracket' });
    await expect(dialog).toBeVisible();
    await dialog.locator('input[type="file"][multiple]').setInputFiles(BRACKET_FILES);
    await expect(dialog).toContainText('Exposure fusion', { timeout: 60000 });
    await expect(dialog).toContainText('Rendered inputs are decoded as assumed sRGB display data');
    await expect(dialog).toContainText('memorial03.png');
    await page.screenshot({ path: path.join(REVIEW_DIR, '03-bracket-review.png'), fullPage: true });

    await dialog.getByRole('button', { name: 'Build exposure-fusion master', exact: true }).click();
    const downloadLink = dialog.getByRole('link', {
      name: 'Download verified OpenEXR exposure-fusion master',
    });
    await expect(downloadLink).toBeVisible({ timeout: 60000 });
    await expect(dialog).toContainText(
      'SDR review rendition; extended master data is stored separately.',
    );
    await expect(dialog).toContainText(
      'Display-linear exposure-fusion master; it does not reconstruct calibrated scene radiance.',
    );
    await page.screenshot({ path: path.join(REVIEW_DIR, '04-bracket-merged.png'), fullPage: true });
    await dialog
      .getByRole('img', { name: 'SDR preview of the merged HDR result' })
      .scrollIntoViewIfNeeded();
    await dialog.screenshot({ path: path.join(REVIEW_DIR, '05-bracket-sdr-preview.png') });

    const downloadPromise = page.waitForEvent('download');
    await downloadLink.click();
    const download = await downloadPromise;
    const outputPath = await download.path();
    expect(outputPath).toBeTruthy();
    const exr = await readFile(outputPath!);
    expect([...exr.subarray(0, 4)]).toEqual([0x76, 0x2f, 0x31, 0x01]);
    const savedMasterPath = testInfo.outputPath('varve-hdr-master.exr');
    await download.saveAs(savedMasterPath);
    expect(await sha256(savedMasterPath)).toHaveLength(64);
    await expect
      .poll(() => Promise.all(BRACKET_FILES.map((filePath) => sha256(filePath))))
      .toEqual(beforeHashes);
    await testInfo.attach('hdr-master-header', {
      body: Buffer.from(exr.subarray(0, 256)),
      contentType: 'application/octet-stream',
    });

    await dialog.getByRole('button', { name: 'Cancel', exact: true }).click();
    const hdrSection = page.locator('.photo-source-section').nth(1);
    await hdrSection
      .locator('input[type="file"][accept=".exr,.EXR"]')
      .setInputFiles(savedMasterPath);
    await expect(hdrSection.getByTestId('hdr-source-status')).toHaveText('Range master', {
      timeout: 60000,
    });
    await expect(hdrSection).toContainText('float32 · display-linear');
    const outputExposure = hdrSection.getByRole('slider', { name: 'Output exposure', exact: true });
    await outputExposure.fill('1');
    await hdrSection
      .getByRole('button', { name: 'Apply SDR output transform', exact: true })
      .click();
    await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText(
      'HDR output transform updated; the range-bearing master was not changed',
    );
    await expect
      .poll(() => serializedDocument(page), { timeout: 30000 })
      .toMatch(/"toneMapExposureStops":1(?:\.0+)?/);
    await page.screenshot({
      path: path.join(REVIEW_DIR, '06-hdr-master-output-transform.png'),
      fullPage: true,
    });

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ timeout: 120000, waitUntil: 'commit' });
    await dismissRecovery(page);
    await page.locator('.varve-home').waitFor({ timeout: 45000 });
    const savedCard = page.getByRole('gridcell', { name: /HDR master persistence fixture/ });
    await expect(savedCard).toBeVisible({ timeout: 30000 });
    await savedCard.dblclick({ timeout: 30000 });
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    await dismissRecovery(page);
    await page.getByRole('treeitem').first().click({ force: true });
    const reopenedInspector = page.locator('.editor__inspector-panel');
    await reopenedInspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    const reopenedTuning = reopenedInspector.getByRole('button', {
      name: 'Image Tuning',
      exact: true,
    });
    if ((await reopenedTuning.getAttribute('aria-expanded')) !== 'true') {
      await reopenedTuning.click();
    }
    const reopenedHdrSection = reopenedInspector.locator('.photo-source-section').nth(1);
    await expect(reopenedHdrSection.getByTestId('hdr-source-status')).toHaveText('Range master', {
      timeout: 60000,
    });
    await expect(
      reopenedHdrSection.getByRole('slider', { name: 'Output exposure', exact: true }),
    ).toHaveValue('1');
    await expect(reopenedHdrSection).toContainText('float32 · display-linear');
    await reopenedHdrSection.scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(REVIEW_DIR, '07-hdr-master-reopened.png'),
      fullPage: true,
    });
  });

  test('keeps a downstream repair independent when the RAW recipe changes upstream', async ({
    page,
  }, testInfo) => {
    test.skip(
      !existsSync(RAW_FIXTURE),
      `set VARVE_RAW_FIXTURE to a supported DNG; missing ${RAW_FIXTURE}`,
    );
    test.setTimeout(420000);
    mkdirSync(REVIEW_DIR, { recursive: true });
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await dismissRecovery(page);
    const documentName = page.locator('.editor-menubar__doc-name-text');
    await documentName.click();
    const documentNameInput = page.getByRole('textbox', { name: 'Document name', exact: true });
    await documentNameInput.fill('RAW repair chain fixture');
    await documentNameInput.press('Enter');
    await openImageTuning(page);

    // 1. Develop a real RAW and commit the recipe.
    const section = page.locator('.photo-source-section').first();
    await section.locator('input[type="file"][accept=".dng,.DNG"]').setInputFiles(RAW_FIXTURE);
    await expect(section.getByTestId('photo-source-status')).toHaveText('RAW recipe', {
      timeout: 60000,
    });
    await section.getByRole('button', { name: 'Apply development', exact: true }).click();
    // The RAW recipe binding lives on the imported image-fill shape, which
    // keeps its filename through prepare; select it by name because the tree
    // renders topmost-first and the prepared raster layers sit above it.
    const sourceLayerRow = page
      .locator('.layers-panel__tree [role="treeitem"]')
      .filter({ hasText: 'photo-fixture' });
    await expect(sourceLayerRow).toBeVisible({ timeout: 30000 });

    // 2. Prepare the retouch pair: locked source + Repair layer.
    await section.getByRole('button', { name: 'Prepare retouch layers', exact: true }).click();
    const repairRow = page
      .locator('.layers-panel__tree [role="treeitem"]')
      .filter({ hasText: 'Repair layer' });
    await expect(repairRow).toBeVisible({ timeout: 30000 });
    await switchToPhotoWorkspace(page);

    // 3. Heal on the repair layer through the real canvas interaction.
    await repairRow.click();
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('content canvas is not measurable');
    await page.getByLabel('Retouch menu').click();
    await page.getByRole('menuitem', { name: 'Healing Brush' }).click();
    await expect(page.locator('[data-tool="healBrush"]')).toBeVisible();
    await expect(repairRow).toHaveAttribute('aria-selected', 'true', { timeout: 15000 });
    // Default scope `current` would sample the empty repair layer itself and
    // deposit nothing; the composite below is the intended source.
    await chooseSamplingScope(page, 'Healing Brush', 'All visible layers');

    const source = { x: box.x + box.width * 0.43, y: box.y + box.height * 0.43 };
    await page.keyboard.down('Alt');
    await page.mouse.click(source.x, source.y);
    await page.keyboard.up('Alt');
    await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText('Healing source set');
    const repairHashPristine = await repairLayerHash(page);
    await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
    await page.mouse.down();
    await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.51);
    await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.54);
    await page.mouse.up();
    await expect
      .poll(() => serializedDocument(page), { timeout: 30000 })
      .toMatch(/"retouchProvenance"/);

    // A repair-layer tile change proves the real stroke reached its persistent
    // target even though the document still displays its source snapshot.
    expect(await repairLayerHash(page)).not.toBe(repairHashPristine);
    const repairHashBefore = await repairLayerHash(page);
    const sourceHashBefore = await layerHash(page, 'Photo pixels');
    await page.screenshot({ path: path.join(REVIEW_DIR, '08-chain-repair-painted.png') });

    // 4. Change the upstream recipe and re-develop.
    await sourceLayerRow.click({ force: true });
    const reopenedSection = page.locator('.photo-source-section').first();
    await expect(reopenedSection.getByTestId('photo-source-status')).toHaveText('RAW recipe', {
      timeout: 30000,
    });
    await expect(reopenedSection).toContainText(
      /Downstream repair is baked to this RAW source revision/,
    );
    const exposure = reopenedSection.getByRole('slider', { name: 'Exposure', exact: true });
    await exposure.fill('2');
    await reopenedSection.getByRole('button', { name: 'Apply development', exact: true }).click();
    await expect
      .poll(() => serializedDocument(page), {
        timeout: 120000,
        message: 'the re-development should commit exposureStops 2',
      })
      .toMatch(/"exposureStops":2(?:\.0+)?/);
    await expect(reopenedSection).toContainText(
      'A downstream repair layer is baked to an older RAW revision',
    );
    await page.screenshot({
      path: path.join(REVIEW_DIR, '09-chain-stale-warning.png'),
      fullPage: true,
    });

    // 5. The repair layer's persisted pixels are byte-identical: the upstream
    // change must never silently recolor or relocate an existing repair. The
    // locked Photo pixels layer is also the visible baked source snapshot;
    // changing the hidden original's RAW recipe must not rewrite that snapshot.
    expect(await repairLayerHash(page)).toBe(repairHashBefore);
    expect(await layerHash(page, 'Photo pixels')).toBe(sourceHashBefore);

    // 6. Save, reload, reopen: staleness and repair bytes survive the round trip.
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ timeout: 120000, waitUntil: 'commit' });
    await dismissRecovery(page);
    await page.locator('.varve-home').waitFor({ timeout: 45000 });
    const savedCard = page.getByRole('gridcell', { name: /RAW repair chain fixture/ });
    await expect(savedCard).toBeVisible({ timeout: 30000 });
    await savedCard.dblclick({ timeout: 30000 });
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    await dismissRecovery(page);
    await expect(
      page.locator('.layers-panel__tree [role="treeitem"]').filter({ hasText: 'Repair layer' }),
    ).toBeVisible({ timeout: 30000 });
    expect(await repairLayerHash(page)).toBe(repairHashBefore);
    await page
      .locator('.layers-panel__tree [role="treeitem"][data-node-id]')
      .first()
      .click({ force: true });
    const reopenedInspector = page.locator('.editor__inspector-panel');
    await reopenedInspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
    const reopenedTuning = reopenedInspector.getByRole('button', {
      name: 'Image Tuning',
      exact: true,
    });
    if ((await reopenedTuning.getAttribute('aria-expanded')) !== 'true') {
      await reopenedTuning.click();
    }
    await expect(reopenedInspector.locator('.photo-source-section').first()).toContainText(
      'A downstream repair layer is baked to an older RAW revision',
      { timeout: 60000 },
    );
    await reopenedInspector.locator('.photo-source-section').first().scrollIntoViewIfNeeded();
    await page.screenshot({
      path: path.join(REVIEW_DIR, '10-chain-reopened-stale.png'),
      fullPage: true,
    });
    await testInfo.attach('raw-repair-chain-reopened', {
      body: await page.screenshot(),
      contentType: 'image/png',
    });
  });
});
