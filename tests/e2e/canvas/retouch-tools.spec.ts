import { mkdirSync } from 'node:fs';
import { readFile } from 'node:fs/promises';
import path from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO_FIXTURE = path.resolve('tests/e2e/fixtures/photo-fixture.jpg');
const REVIEW_DIR = path.resolve('reports/ui-review/retouch');

async function switchWorkspace(page: import('@playwright/test').Page, label: string) {
  const workspace = page.getByRole('radio', { name: `${label} workspace` });
  if (await workspace.isVisible({ timeout: 1000 }).catch(() => false)) {
    await workspace.click();
    return;
  }
  const homeFile = page.getByRole('gridcell').first();
  if (await homeFile.isVisible({ timeout: 1000 }).catch(() => false)) {
    await homeFile.click();
    await workspace.waitFor({ state: 'visible', timeout: 30000 });
    await workspace.click();
    return;
  }
  await page.getByLabel('More workspaces').click();
  await page.getByRole('menuitemradio', { name: new RegExp(`^${label}(?:\\s|$)`, 'i') }).click();
}

async function selectExportTab(page: import('@playwright/test').Page): Promise<void> {
  const exportTab = page.locator('[role="tablist"] button[role="tab"]', {
    hasText: /^export$/i,
  });
  if (await exportTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await exportTab.click();
    return;
  }
  await page.getByRole('button', { name: /^More inspector tabs/ }).click();
  await page
    .getByRole('menu', { name: 'More inspector tabs' })
    .getByRole('menuitem', { name: 'Export', exact: true })
    .click();
}

async function dismissRecovery(page: import('@playwright/test').Page): Promise<void> {
  const recovery = page.locator('dialog.recovery-dialog[open]');
  // Recovery can mount asynchronously after the editor shell is visible. Keep
  // polling briefly so it cannot intercept the first real canvas interaction.
  for (let attempt = 0; attempt < 16; attempt += 1) {
    if ((await recovery.count()) > 0) {
      await recovery.locator('.recovery-dialog__close').click({ force: true, timeout: 5000 });
    }
    await page.waitForTimeout(500);
  }
}

async function preparePhotoRetouch(page: import('@playwright/test').Page) {
  await page.locator('#file-import-input').setInputFiles(PHOTO_FIXTURE);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 30000 });
  const fitButton = page.getByRole('button', { name: 'Fit selection to viewport' });
  if (await fitButton.isVisible({ timeout: 1000 }).catch(() => false)) await fitButton.click();

  const inspector = page.locator('.editor__inspector-panel');
  await inspector.getByRole('tab', { name: 'Adjustments', exact: true }).click();
  const tuning = inspector.getByRole('button', { name: 'Image Tuning', exact: true });
  await expect(tuning).toBeVisible();
  if ((await tuning.getAttribute('aria-expanded')) !== 'true') await tuning.click();
  const photoSource = inspector.locator('.photo-source-section').first();
  await expect(photoSource).toBeVisible();
  await photoSource.getByRole('button', { name: 'Prepare retouch layers', exact: true }).click();
  await expect(
    page.locator('.layers-panel__tree [role="treeitem"]').filter({ hasText: 'Repair layer' }),
  ).toBeVisible({ timeout: 30000 });
  await switchWorkspace(page, 'Photo');
}

async function chooseSamplingScope(
  page: import('@playwright/test').Page,
  toolLabel: string,
  scopeLabel: string,
): Promise<void> {
  const optionsButton = page.getByRole('button', { name: 'Tool options' });
  await expect(optionsButton).toBeVisible();
  const options = page.getByRole('dialog', { name: `${toolLabel} tool options` });
  if ((await optionsButton.getAttribute('aria-expanded')) !== 'true') {
    // The toolbar keeps focus on the active tool after the retouch flyout
    // closes. Keyboard activation avoids a transient tooltip pointer capture
    // while still exercising the production popover and its real controls.
    await optionsButton.press('Enter');
  }
  await expect(options).toBeVisible();
  const sampling = options.getByRole('combobox', { name: 'Sampling scope' });
  await sampling.click();
  await page.getByRole('option', { name: scopeLabel, exact: true }).click();
  await expect(sampling).toContainText(scopeLabel);
  await page.keyboard.press('Escape');
}

async function authoritativeCanvasPixelHash(
  page: import('@playwright/test').Page,
): Promise<string> {
  await page.evaluate(async () => {
    const perf = (window as unknown as { __varvePerf?: { forceFullRedraw?: () => void } })
      .__varvePerf;
    perf?.forceFullRedraw?.();
    await new Promise<void>((resolve) =>
      requestAnimationFrame(() => requestAnimationFrame(() => resolve())),
    );
  });
  // The content renderer may use a worker frame after the invalidation. Two
  // rAFs only prove that the request was scheduled; allow the authoritative
  // replay to commit before sampling pixels.
  let previous = '';
  for (let attempt = 0; attempt < 4; attempt += 1) {
    await page.waitForTimeout(attempt === 0 ? 500 : 250);
    const current = await page
      .locator('canvas.editor-canvas__content-layer')
      .evaluate((element) => {
        const canvas = element as HTMLCanvasElement;
        const context = canvas.getContext('2d');
        if (!context) throw new Error('content canvas has no 2D context');
        const pixels = context.getImageData(0, 0, canvas.width, canvas.height).data;
        let hash = 2166136261;
        for (const value of pixels) {
          hash ^= value;
          hash = Math.imul(hash, 16777619);
        }
        return `${pixels.length}:${hash >>> 0}`;
      });
    if (current === previous) return current;
    previous = current;
  }
  return previous;
}

async function hidePerfHud(page: import('@playwright/test').Page): Promise<void> {
  await page.evaluate(() => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          enable?: (enabled: boolean) => void;
          forceFullRedraw?: () => void;
          interactions?: { reset?: () => void };
          snap?: { reset?: () => void };
        };
      }
    ).__varvePerf;
    perf?.enable?.(false);
    perf?.interactions?.reset?.();
    perf?.snap?.reset?.();
    perf?.forceFullRedraw?.();
  });
  await page.waitForTimeout(500);
}

async function serializedDocument(page: import('@playwright/test').Page): Promise<string> {
  return page.evaluate(() => {
    interface EditorApi {
      serializeDocument: () => string;
    }

    function editorFrom(value: unknown): EditorApi | null {
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
      return editorFrom(record.child) ?? editorFrom(record.sibling);
    }

    const root = document.getElementById('root');
    if (!root) throw new Error('editor root is missing');
    const fiberKey = Object.keys(root).find(
      (key) => key.startsWith('__reactContainer$') || key.startsWith('__reactFiber$'),
    );
    if (!fiberKey) throw new Error('editor React fiber is missing');
    const editor = editorFrom((root as unknown as Record<string, unknown>)[fiberKey]);
    if (!editor) throw new Error('editor context is missing');
    return editor.serializeDocument();
  });
}

test('Photo workspace retouch tools paint through the real canvas interaction', async ({
  page,
}) => {
  // Cold editor mount plus canvas interactions under concurrent-agent load can
  // exceed 120 s even when the interaction itself is healthy.
  test.setTimeout(240000);
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await dismissRecovery(page);
  await preparePhotoRetouch(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not measurable');
  const retouchMenu = page.getByLabel('Retouch menu');
  await expect(retouchMenu).toBeVisible();
  await retouchMenu.click();
  await expect(page.getByRole('menuitem', { name: 'Healing Brush' })).toBeVisible();
  await page.getByRole('menuitem', { name: 'Healing Brush' }).click();
  await expect(page.locator('[data-tool="healBrush"]')).toBeVisible();
  await chooseSamplingScope(page, 'Healing Brush', 'All visible layers');

  const before = await canvas.screenshot();

  const source = { x: box.x + box.width * 0.43, y: box.y + box.height * 0.43 };
  await page.keyboard.down('Alt');
  await page.mouse.click(source.x, source.y);
  await page.keyboard.up('Alt');
  await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText('Healing source set');

  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.48);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.55, box.y + box.height * 0.51);
  await page.mouse.move(box.x + box.width * 0.58, box.y + box.height * 0.54);
  await page.mouse.up();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before), {
      timeout: 15000,
      message: 'healing should change the imported photograph',
    })
    .toBe(false);

  await hidePerfHud(page);
  await page.screenshot({ path: path.join(REVIEW_DIR, '01-healing-brush-painted.png') });
});

test('Spot Heal and Patch use the persistent raster target and coherent undo', async ({
  page,
}, testInfo) => {
  // Save, reload, reopen, export, and undo/redo in one test. Under several
  // concurrent agents sharing the machine the 120 s budget has been observed
  // to run out after the reopen succeeded, so keep a load-tolerant budget.
  test.setTimeout(240000);
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await dismissRecovery(page);
  const documentName = page.locator('.editor-menubar__doc-name-text');
  await documentName.click();
  const documentNameInput = page.getByRole('textbox', { name: 'Document name', exact: true });
  await documentNameInput.fill('Retouch persistence fixture');
  await documentNameInput.press('Enter');
  await preparePhotoRetouch(page);
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not measurable');
  const retouchMenu = page.getByLabel('Retouch menu');
  await retouchMenu.click();
  await page.getByRole('menuitem', { name: 'Spot Heal' }).click();
  await expect(page.locator('[data-tool="spotHeal"]')).toBeVisible();
  await chooseSamplingScope(page, 'Spot Heal', 'All visible layers');

  const beforeSpot = await canvas.screenshot();
  await canvas.click({ position: { x: box.width * 0.55, y: box.height * 0.45 } });
  await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText(
    /Spot healed from a nearby source patch|no valid nearby source patch/,
  );
  await expect
    .poll(async () => (await canvas.screenshot()).equals(beforeSpot), {
      timeout: 15000,
      message: 'spot healing should change the imported photograph when a source exists',
    })
    .toBe(false);
  await hidePerfHud(page);
  await page.screenshot({ path: path.join(REVIEW_DIR, '02-spot-heal-painted.png') });

  await retouchMenu.click();
  await page.getByRole('menuitem', { name: 'Patch Tool' }).click();
  await expect(page.locator('[data-tool="patch"]')).toBeVisible();
  await chooseSamplingScope(page, 'Patch Tool', 'All visible layers');
  const beforePatch = await authoritativeCanvasPixelHash(page);
  await page.mouse.move(box.x + box.width * 0.76, box.y + box.height * 0.52);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.86, box.y + box.height * 0.62);
  await page.mouse.up();
  await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText(
    'Source region selected. Click to position the patch.',
  );
  await page.mouse.click(box.x + box.width * 0.68, box.y + box.height * 0.6);
  await expect(page.locator('#strata-canvas-announcer-polite')).toHaveText(
    'Patch applied to the raster layer',
  );
  const patched = await authoritativeCanvasPixelHash(page);
  expect(patched).not.toBe(beforePatch);

  await page.keyboard.press('Control+z');
  expect(await authoritativeCanvasPixelHash(page)).toBe(beforePatch);
  await page.keyboard.press('Control+Shift+z');
  expect(await authoritativeCanvasPixelHash(page)).toBe(patched);
  await hidePerfHud(page);
  await page.screenshot({ path: path.join(REVIEW_DIR, '03-patch-redone.png') });

  await selectExportTab(page);
  await page.getByRole('button', { name: 'PNG', exact: true }).first().click();
  const exportDownloadPromise = page.waitForEvent('download', { timeout: 180000 });
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const exportDownload = await exportDownloadPromise;
  const exportPath = testInfo.outputPath('retouched-export.png');
  await exportDownload.saveAs(exportPath);
  const exported = await readFile(exportPath);
  expect(exported.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));

  // Save through the normal project path, reload the browser, and reopen from
  // Home. The repair layer is a durable raster target; this assertion keeps
  // the evidence tied to persisted pixels rather than only the live canvas.
  const savedDocument = await serializedDocument(page);
  expect(savedDocument).toContain('"name":"Repair layer"');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  await page.reload({ timeout: 120000, waitUntil: 'commit' });
  await dismissRecovery(page);
  await page.locator('.varve-home').waitFor({ timeout: 45000 });
  const savedCard = page.getByRole('gridcell', { name: /Retouch persistence fixture/ });
  await expect(savedCard).toBeVisible({ timeout: 30000 });
  await savedCard.dblclick({ timeout: 30000 });
  await page.locator('.layers-panel').waitFor({ timeout: 60000 });
  await dismissRecovery(page);
  await expect(
    page.locator('.layers-panel__tree [role="treeitem"]').filter({ hasText: 'Repair layer' }),
  ).toBeVisible({ timeout: 30000 });
  const reopenedRepair = page
    .locator('.layers-panel__tree [role="treeitem"]')
    .filter({ hasText: 'Repair layer' });
  await reopenedRepair.click();
  const fitSelection = page.getByRole('button', { name: 'Fit selection to viewport' });
  if (await fitSelection.isVisible({ timeout: 1000 }).catch(() => false)) {
    await fitSelection.click();
  }
  await page.waitForTimeout(1000);
  await hidePerfHud(page);
  await page.screenshot({ path: path.join(REVIEW_DIR, '04-reopened.png') });
  const reopenedDocument = await serializedDocument(page);
  expect(reopenedDocument).toContain('"name":"Repair layer"');
  expect(reopenedDocument).toContain('"name":"Photo pixels"');
  const reopenedModel = JSON.parse(reopenedDocument) as {
    nodes?: Record<string, { name?: unknown; tiles?: Record<string, { pixels?: unknown }> }>;
  };
  const reopenedLayers = Object.values(reopenedModel.nodes ?? {}).filter(
    (node) => node.name === 'Repair layer' || node.name === 'Photo pixels',
  );
  expect(reopenedLayers).toHaveLength(2);
  for (const layer of reopenedLayers) {
    const tiles = Object.values(layer.tiles ?? {});
    expect(tiles.length, `${String(layer.name)} should retain serialized tiles`).toBeGreaterThan(0);
    expect(
      tiles.some((tile) => {
        if (typeof tile.pixels !== 'string') return false;
        const bytes = Buffer.from(tile.pixels, 'base64');
        for (let index = 3; index < bytes.length; index += 4) {
          if (bytes[index] !== 0) return true;
        }
        return false;
      }),
      `${String(layer.name)} should retain non-transparent pixels`,
    ).toBe(true);
  }
});

test('Clone Stamp refuses locked and non-pixel targets instead of redirecting the edit', async ({
  page,
}) => {
  test.setTimeout(240000);
  mkdirSync(REVIEW_DIR, { recursive: true });
  await page.setViewportSize({ width: 1280, height: 800 });
  await navigateToEditor(page, '/?perf=1');
  await dismissRecovery(page);
  await preparePhotoRetouch(page);

  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('content canvas is not measurable');
  const treeItems = page.locator('.layers-panel__tree [role="treeitem"]');
  const announcer = page.locator('#strata-canvas-announcer-polite');

  // 1) A locked source layer is a described refusal; nothing is created and
  //    no other layer is silently retouched in its place.
  const retouchMenu = page.getByLabel('Retouch menu');
  await retouchMenu.click();
  await page.getByRole('menuitem', { name: 'Clone Stamp' }).click();
  await expect(page.locator('[data-tool="cloneStamp"]')).toBeVisible();
  // The tool-options popover opens automatically; close it so canvas clicks
  // below land on the canvas rather than the popover.
  await page.keyboard.press('Escape');
  await treeItems.filter({ hasText: 'Photo pixels' }).click();
  const lockedCount = await treeItems.count();
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + box.width * 0.4, box.y + box.height * 0.4);
  await page.keyboard.up('Alt');
  await expect(announcer).toHaveText(/locked/i);
  expect(await treeItems.count()).toBe(lockedCount);

  // 2) A selected non-raster object must not be silently replaced by some
  //    other pixel layer elsewhere in the document. The imported photo is an
  //    image-filled shape; selecting it and retouching must refuse, not write
  //    to the repair layer behind the user's back.
  const imageShape = treeItems.filter({ hasText: 'photo-fixture' }).first();
  await expect(imageShape).toBeVisible();
  await imageShape.click();
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + box.width * 0.5, box.y + box.height * 0.5);
  await page.keyboard.up('Alt');
  await expect(announcer).toHaveText(/not a pixel layer/i);
  expect(await treeItems.count()).toBe(lockedCount);

  // 3) The Repair layer remains a usable destination: setting the source and
  //    painting through the real canvas interaction changes the photograph.
  await treeItems.filter({ hasText: 'Repair layer' }).click();
  await chooseSamplingScope(page, 'Clone Stamp', 'All visible layers');
  await expect(page.locator('.paint-overlay__badge')).toContainText('Repair layer');
  await page.keyboard.down('Alt');
  await page.mouse.click(box.x + box.width * 0.43, box.y + box.height * 0.43);
  await page.keyboard.up('Alt');
  await expect(announcer).toHaveText('Clone source set');
  // The source marker is real chrome, not just tool state: it must be on the
  // canvas once the anchor exists.
  await expect(page.locator('.paint-overlay__clone-source')).toBeVisible();
  await expect(page.locator('.paint-overlay__badge')).toBeVisible();

  const before = await canvas.screenshot();
  await page.mouse.move(box.x + box.width * 0.52, box.y + box.height * 0.5);
  await page.mouse.down();
  await page.mouse.move(box.x + box.width * 0.56, box.y + box.height * 0.54);
  await page.mouse.move(box.x + box.width * 0.6, box.y + box.height * 0.58);
  await page.mouse.up();
  await expect
    .poll(async () => (await canvas.screenshot()).equals(before), {
      timeout: 15000,
      message: 'clone stamp should change the photograph on the repair layer',
    })
    .toBe(false);

  await hidePerfHud(page);
  await page.screenshot({ path: path.join(REVIEW_DIR, '05-target-safety.png') });
  expect(await treeItems.count()).toBe(lockedCount);
});
