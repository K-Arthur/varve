/**
 * Runtime acceptance for the document-token → variable → property-binding
 * bridge. The source is imported through Token Sync, the fill binding is
 * created through the Inspector's real picker, and the canvas pixels remain
 * the authority for whether a resolved color reached artwork.
 */
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { type Download, expect, type Locator, type Page, test } from '@playwright/test';
import { captureProducerScreenshot } from '../../../scripts/screenshots/producer-capture.mjs';
import { dragOnCanvas, navigateToEditor } from '../shared';

const EXPORT_FIXTURE_PATH = resolve('docs/tokens/fixtures/runtime-export-2026-09-25.tokens.json');
const CONTENT_CANVAS = 'canvas.editor-canvas__content-layer';

const TOKEN_SOURCE = JSON.stringify(
  {
    color: {
      brand: {
        $description: 'Brand foundations shared by the sample artwork',
        $deprecated: false,
        $extensions: { 'org.varve.validation': { purpose: 'metadata round trip' } },
        primary: {
          $type: 'color',
          $description: 'Foundation brand color',
          $extensions: { 'org.varve.validation': { retained: true, precision: 1.00000001 } },
          $value: { colorSpace: 'srgb', components: [0.2, 0.4, 0.8] },
        },
      },
    },
    semantic: {
      brand: {
        curlyAlias: {
          $type: 'color',
          $value: '{color.brand.primary}',
        },
        pointerAlias: {
          $type: 'color',
          $ref: '#/color/brand/primary/$value',
        },
      },
    },
  },
  null,
  2,
);

type TokenDocument = {
  color: {
    brand: {
      primary: {
        $value: {
          colorSpace: string;
          components: number[];
          hex?: string;
        };
      };
    };
  };
};

async function openVariablesDialog(page: Page) {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const viewMenu = page.getByRole('menu', { name: 'View' });
  await expect(viewMenu).toBeVisible();
  await viewMenu.getByRole('menuitem', { name: 'Panels', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Variables and Tokens…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
  await expect(dialog).toBeVisible();
  return dialog;
}

async function openThemeSettings(page: Page): Promise<Locator> {
  await page
    .getByRole('menubar')
    .getByRole('menuitem', { name: /^File$/ })
    .click();
  await page.getByRole('menuitem', { name: /Settings/ }).click();
  const dialog = page.locator('dialog.varve-dialog--settings[open]');
  await expect(dialog).toBeVisible();
  await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
  await expect(dialog.getByRole('combobox', { name: 'Theme', exact: true })).toBeVisible();
  return dialog;
}

async function verifyArtworkAcrossThemes(page: Page): Promise<void> {
  const themes = [
    { label: 'Light', attribute: 'light', file: 'theme-light.png' },
    { label: 'Dark', attribute: 'dark', file: 'theme-dark.png' },
    { label: 'High Contrast', attribute: 'high-contrast', file: 'theme-high-contrast.png' },
  ];

  for (let index = 0; index < themes.length; index += 1) {
    const theme = themes[index]!;
    const dialog = await openThemeSettings(page);
    await dialog.getByRole('combobox', { name: 'Theme', exact: true }).click();
    await page.getByRole('option', { name: theme.label, exact: true }).click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', theme.attribute);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();

    await expectCanvasRgb(page, { x: 250, y: 240 }, [204, 51, 26]);
    await expectCanvasRgb(page, { x: 540, y: 240 }, [204, 51, 26]);
    await expectCanvasRgb(page, { x: 775, y: 240 }, [204, 51, 26]);
    await page.screenshot({ path: test.info().outputPath(theme.file) });
  }
}

function importInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Import DTCG token file"]');
}

async function chooseSelectOption(
  page: Page,
  form: Locator,
  label: string,
  option: string,
): Promise<void> {
  await form.getByRole('combobox', { name: label, exact: true }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

async function createLocalRemToken(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Create token', exact: true }).click();
  const form = dialog.getByRole('form', { name: 'Create local token' });
  await form.getByRole('textbox', { name: 'Full token path' }).fill('local.spacing.remUnsupported');
  await chooseSelectOption(page, form, 'Token type', 'Dimension');
  await form.getByRole('spinbutton', { name: 'Dimension value' }).fill('1.25');
  await chooseSelectOption(page, form, 'Dimension unit', 'rem');
  await form.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(form).toBeHidden();
}

async function createLocalColorAlias(page: Page, dialog: Locator): Promise<void> {
  await dialog.getByRole('button', { name: 'Create token', exact: true }).click();
  const form = dialog.getByRole('form', { name: 'Create local token' });
  await form.getByRole('textbox', { name: 'Full token path' }).fill('local.brand.alias');
  await chooseSelectOption(page, form, 'Token type', 'Color');
  await form.getByRole('button', { name: 'Create as alias', exact: true }).click();
  await form.getByRole('combobox', { name: 'Alias target', exact: true }).click();

  // The imported dimension is already in the document, but the alias picker
  // must offer only the exact type selected in the form.
  await expect(
    page.getByRole('option', { name: 'local.spacing.remUnsupported', exact: true }),
  ).toHaveCount(0);
  await page.getByRole('option', { name: 'semantic.brand.curlyAlias', exact: true }).click();
  await form.getByRole('button', { name: 'Add token', exact: true }).click();
  await expect(form).toBeHidden();
}

async function ensureFillSectionExpanded(page: Page): Promise<void> {
  const section = page.locator('[data-section-id="fills"]');
  const trigger = section.locator('.insp-disclosure__trigger');
  await expect(trigger).toBeVisible({ timeout: 10000 });
  if ((await trigger.getAttribute('aria-expanded')) !== 'true') await trigger.click();
  await expect(section.locator('.insp-fill-row')).toBeVisible();
}

async function bindSelectedShapeFill(page: Page, tokenName: string): Promise<void> {
  await ensureFillSectionExpanded(page);
  const fillRow = page.locator('.insp-fill-row').first();
  await fillRow.getByRole('button', { name: 'Fill actions' }).click();
  await page.getByRole('menuitem', { name: 'Link to variable', exact: true }).click();

  // This is the actual fill-binding combobox. Selecting through the menu
  // exercises the same path a user takes; no editor-context mutation is used.
  const picker = page.locator('.binding-menu');
  const search = picker.getByRole('combobox', { name: 'Search variables' });
  await expect(search).toBeVisible();
  await search.fill(tokenName);
  await picker.getByRole('option').filter({ hasText: tokenName }).first().click();
  await expect(
    page.getByRole('button', { name: new RegExp(`^Linked to ${tokenName}`) }),
  ).toBeVisible({ timeout: 10000 });
}

async function expectRemBindingUnavailable(page: Page): Promise<void> {
  const widthField = page.getByRole('spinbutton', { name: 'W (px)', exact: true });
  await expect(widthField).toBeVisible();
  await widthField.focus();
  await page.keyboard.press('=');

  const picker = page.locator('.binding-menu');
  const search = picker.getByRole('combobox', { name: 'Search variables' });
  await expect(search).toBeVisible();
  await search.fill('local.spacing.remUnsupported');
  const remOption = picker.getByRole('option').filter({ hasText: 'local.spacing.remUnsupported' });
  await expect(remOption).toHaveCount(1);
  await expect(remOption).toHaveAttribute('aria-disabled', 'true');
  await expect(remOption).toHaveAttribute('title', /root-font size/i);
  await page.screenshot({ path: test.info().outputPath('rem-binding-guard.png') });

  // The option is visibly discoverable with its reason, but selecting it is
  // a no-op and keeps the picker open instead of creating a dead binding.
  await remOption.click({ force: true });
  await expect(picker).toBeVisible();
  await expect(
    page.getByRole('button', { name: /^Linked to local\.spacing\.remUnsupported/ }),
  ).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(picker).toBeHidden();
}

async function readCanvasRgb(page: Page, point: { x: number; y: number }) {
  return page.locator(CONTENT_CANVAS).evaluate((element, sample) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context || canvas.clientWidth === 0 || canvas.clientHeight === 0) return null;
    // The drag helper uses CSS-pixel coordinates relative to the visible
    // canvas. Scale them to backing-store pixels so this works at HiDPI too.
    const x = Math.max(
      0,
      Math.min(canvas.width - 1, Math.round((sample.x * canvas.width) / canvas.clientWidth)),
    );
    const y = Math.max(
      0,
      Math.min(canvas.height - 1, Math.round((sample.y * canvas.height) / canvas.clientHeight)),
    );
    return Array.from(context.getImageData(x, y, 1, 1).data).slice(0, 3);
  }, point);
}

async function expectCanvasRgb(
  page: Page,
  point: { x: number; y: number },
  expected: [number, number, number],
): Promise<void> {
  await expect
    .poll(
      async () => {
        const actual = await readCanvasRgb(page, point);
        return (
          actual !== null &&
          expected.every((channel, index) => Math.abs((actual[index] ?? 0) - channel) <= 4)
        );
      },
      { timeout: 15000, message: `expected canvas sample near rgb(${expected.join(', ')})` },
    )
    .toBe(true);
}

async function readDownload(download: Download): Promise<string> {
  const stream = await download.createReadStream();
  if (!stream) throw new Error('Token export did not produce a readable download stream.');
  const chunks: Buffer[] = [];
  for await (const chunk of stream) chunks.push(chunk as Buffer);
  return Buffer.concat(chunks).toString('utf8');
}

test('imported DTCG aliases bind to artwork and follow source edits through history', async ({
  page,
}) => {
  // Save through the browser download + Home mirror path so the final reload
  // checks the same local persistence path used without File System Access.
  await page.addInitScript(() => {
    Object.defineProperty(window, 'showSaveFilePicker', { configurable: true, value: undefined });
  });
  await page.setViewportSize({ width: 1600, height: 1000 });
  await navigateToEditor(page);

  // Start with a fresh document and import a structured sRGB foundation plus
  // both reference forms through the real file input and preview/apply flow.
  let dialog = await openVariablesDialog(page);
  await importInput(page).setInputFiles({
    name: 'brand.tokens.json',
    mimeType: 'application/json',
    buffer: Buffer.from(TOKEN_SOURCE, 'utf8'),
  });
  await expect(dialog.getByText(/revision/i)).toBeVisible({ timeout: 15000 });
  await expect(dialog.getByText(/3 tokens ready to import/i)).toBeVisible();
  await dialog.screenshot({ path: test.info().outputPath('import-preview.png') });

  await dialog.getByRole('button', { name: 'Apply import' }).click();
  const sourceRow = dialog
    .locator('.token-sync-panel__source')
    .filter({ hasText: 'brand.tokens.json' });
  await expect(sourceRow).toBeVisible({ timeout: 15000 });
  await expect(sourceRow).toContainText('3 tokens');
  await dialog.screenshot({ path: test.info().outputPath('import-applied.png') });

  // Create a typed rem dimension and then a local color alias through the
  // actual form. The alias target list is filtered by the exact selected type.
  await createLocalRemToken(page, dialog);
  await createLocalColorAlias(page, dialog);
  const tokenSummary = dialog.locator('.token-sync-panel__summary');
  await expect(tokenSummary).toContainText('5 tokens');
  await dialog.screenshot({ path: test.info().outputPath('local-tokens-created.png') });

  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expect(dialog).toBeHidden();

  // Draw real rectangles for the qualified curly-brace alias, JSON Pointer
  // alias, and local alias; all three bindings use the fill picker.
  await page.keyboard.press('r');
  await dragOnCanvas(page, 160, 160, 340, 320);
  const shapeRows = page.locator('.layers-panel [role="treeitem"][data-layer-type="shape"]');
  await expect(shapeRows).toHaveCount(1);
  await shapeRows.first().click();
  await bindSelectedShapeFill(page, 'semantic.brand.curlyAlias');
  await expectCanvasRgb(page, { x: 250, y: 240 }, [51, 102, 204]);
  await captureProducerScreenshot(page, test.info(), 'curly-alias-bound.png');
  await expectRemBindingUnavailable(page);

  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await dragOnCanvas(page, 450, 160, 630, 320);
  await expect(shapeRows).toHaveCount(2);
  const selectedShape = page.locator(
    '.layers-panel [role="treeitem"][data-layer-type="shape"][aria-selected="true"]',
  );
  await expect(selectedShape).toHaveCount(1);
  await selectedShape.click();
  await bindSelectedShapeFill(page, 'semantic.brand.pointerAlias');
  await expectCanvasRgb(page, { x: 250, y: 240 }, [51, 102, 204]);
  await expectCanvasRgb(page, { x: 540, y: 240 }, [51, 102, 204]);
  await page.screenshot({ path: test.info().outputPath('both-aliases-bound.png') });

  await page.keyboard.press('Escape');
  await page.keyboard.press('r');
  await dragOnCanvas(page, 700, 160, 850, 320);
  await expect(shapeRows).toHaveCount(3);
  await bindSelectedShapeFill(page, 'local.brand.alias');
  await expectCanvasRgb(page, { x: 775, y: 240 }, [51, 102, 204]);
  await page.screenshot({ path: test.info().outputPath('local-alias-bound.png') });
  const selectedLocalAliasShape = page.locator(
    '.layers-panel [role="treeitem"][data-layer-type="shape"][aria-selected="true"]',
  );
  await expect(selectedLocalAliasShape).toHaveCount(1);
  const localAliasShapeId = await selectedLocalAliasShape.getAttribute('data-node-id');
  if (!localAliasShapeId) throw new Error('Local-alias shape is missing its persisted layer id.');

  // Edit only the foundation value in the existing source editor, retaining
  // the editor-generated source identity and the two authored references.
  dialog = await openVariablesDialog(page);
  await dialog.getByRole('button', { name: 'Edit source content' }).click();
  const sourceEditor = dialog.getByLabel('Source content: brand.tokens.json');
  await expect(sourceEditor).toBeVisible();
  const edited = JSON.parse(await sourceEditor.inputValue()) as TokenDocument;
  edited.color.brand.primary.$value.components = [0.8, 0.2, 0.1];
  delete edited.color.brand.primary.$value.hex;
  await sourceEditor.fill(JSON.stringify(edited, null, 2));
  await dialog.getByRole('button', { name: 'Validate and preview' }).click();
  await expect(dialog.getByText(/1 updated from brand\.tokens\.json/i)).toBeVisible({
    timeout: 15000,
  });
  await dialog.screenshot({ path: test.info().outputPath('source-edit-preview.png') });

  await dialog.getByRole('button', { name: 'Apply update' }).click();
  await expect(dialog.getByText(/revision/i)).toBeHidden();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await expectCanvasRgb(page, { x: 250, y: 240 }, [204, 51, 26]);
  await expectCanvasRgb(page, { x: 540, y: 240 }, [204, 51, 26]);
  await expectCanvasRgb(page, { x: 775, y: 240 }, [204, 51, 26]);
  await page.screenshot({ path: test.info().outputPath('source-update-applied.png') });

  // A source update is a document history entry: undo restores all bound
  // fills, and redo propagates the revised foundation through each alias.
  await page.keyboard.press('ControlOrMeta+z');
  await expectCanvasRgb(page, { x: 250, y: 240 }, [51, 102, 204]);
  await expectCanvasRgb(page, { x: 540, y: 240 }, [51, 102, 204]);
  await expectCanvasRgb(page, { x: 775, y: 240 }, [51, 102, 204]);
  await page.screenshot({ path: test.info().outputPath('source-update-undone.png') });

  await page.keyboard.press('ControlOrMeta+Shift+z');
  await expectCanvasRgb(page, { x: 250, y: 240 }, [204, 51, 26]);
  await expectCanvasRgb(page, { x: 540, y: 240 }, [204, 51, 26]);
  await expectCanvasRgb(page, { x: 775, y: 240 }, [204, 51, 26]);
  await page.screenshot({ path: test.info().outputPath('source-update-redone.png') });

  // Portable export must retain the source references rather than flattening
  // them to the current resolved RGB value.
  dialog = await openVariablesDialog(page);
  const downloadPromise = page.waitForEvent('download');
  await dialog.getByRole('button', { name: 'Export DTCG file' }).click();
  const download = await downloadPromise;
  expect(download.suggestedFilename()).toMatch(/\.tokens\.json$/);
  const exportedText = await readDownload(download);
  expect(JSON.parse(exportedText)).toMatchObject({
    color: {
      brand: {
        $description: 'Brand foundations shared by the sample artwork',
        $deprecated: false,
        $extensions: { 'org.varve.validation': { purpose: 'metadata round trip' } },
        primary: {
          $description: 'Foundation brand color',
          $extensions: { 'org.varve.validation': { retained: true, precision: 1.00000001 } },
        },
      },
    },
  });
  const exported = JSON.parse(exportedText) as {
    color?: {
      brand?: {
        primary?: {
          $value?: { colorSpace?: string; components?: number[] };
        };
      };
    };
    semantic?: {
      brand?: {
        curlyAlias?: { $value?: unknown };
        pointerAlias?: { $ref?: unknown; $value?: unknown };
      };
    };
  };
  expect(exported).toEqual(JSON.parse(readFileSync(EXPORT_FIXTURE_PATH, 'utf8')));
  expect(exported.color?.brand?.primary?.$value?.colorSpace).toBe('srgb');
  expect(exported.color?.brand?.primary?.$value?.components).toEqual([0.8, 0.2, 0.1]);
  expect(exported.semantic?.brand?.curlyAlias?.$value).toBe('{color.brand.primary}');
  expect(exported.semantic?.brand?.pointerAlias?.$ref).toBe('#/color/brand/primary/$value');
  expect(exported.semantic?.brand?.pointerAlias?.$value).toBeUndefined();
  await dialog.getByRole('button', { name: 'Close dialog' }).click();
  await verifyArtworkAcrossThemes(page);
  await page.keyboard.press('ControlOrMeta+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
  await page.reload({ timeout: 120000, waitUntil: 'domcontentloaded' });
  await page.locator('.varve-home').waitFor({ state: 'visible', timeout: 45000 });
  const savedDocument = page.getByRole('gridcell').first();
  await savedDocument.waitFor({ state: 'visible', timeout: 30000 });
  await savedDocument.dblclick({ timeout: 15000 });
  await page.locator('.layers-panel').waitFor({ state: 'visible', timeout: 60000 });

  const reopenedShape = page.locator(
    `.layers-panel [role="treeitem"][data-node-id="${localAliasShapeId}"]`,
  );
  await expect(reopenedShape).toBeVisible();
  await reopenedShape.click();
  await ensureFillSectionExpanded(page);
  await expect(page.getByRole('button', { name: /^Linked to local\.brand\.alias/ })).toBeVisible();
  await expectCanvasRgb(page, { x: 775, y: 240 }, [204, 51, 26]);
  await page.screenshot({ path: test.info().outputPath('reopened-persisted.png') });
  dialog = await openVariablesDialog(page);
  await expect(dialog.locator('.token-sync-panel__summary')).toContainText('5 tokens');
});
