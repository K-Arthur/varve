/**
 * Token Sync — end-to-end import, apply, undo, and export.
 *
 * These specs drive the real file input, the real preview, and the real
 * document transaction in a browser, because the failure modes this pass
 * repaired (a fresh document that could never import, a preview keyed by
 * file name, an announce that fired on a no-op) are invisible to unit tests.
 */

import { expect, type Page, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor } from '../shared';

const SCREENSHOT_DIR = 'token-sync-import';

const TOKENS_JSON = JSON.stringify(
  {
    color: {
      $description: 'Color foundation',
      brand: {
        primary: {
          $type: 'color',
          $description: 'Brand primary',
          $value: { colorSpace: 'srgb', components: [0, 0.4, 0.8] },
        },
        alias: { $type: 'color', $value: '{color.brand.primary}' },
      },
    },
    spacing: {
      $type: 'dimension',
      $root: { $value: { value: 16, unit: 'px' } },
      gap: { $value: { value: 8, unit: 'px' }, $description: 'Default gap' },
    },
  },
  null,
  2,
);

async function openVariablesDialog(page: Page): Promise<void> {
  await page.getByRole('menuitem', { name: 'View', exact: true }).click();
  const viewMenu = page.getByRole('menu', { name: 'View' });
  await expect(viewMenu).toBeVisible();
  await viewMenu.getByRole('menuitem', { name: 'Panels', exact: true }).hover();
  await page.getByRole('menuitem', { name: 'Variables and Tokens…' }).click();
  const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
  await expect(dialog).toBeVisible();
}

function fileInput(page: Page) {
  return page.locator('input[type="file"][aria-label="Import DTCG token file"]');
}

/** The connected-source row, disambiguated from the announcer's echo. */
function sourceRow(page: Page, name: string) {
  return page.locator('.token-sync-panel__source-name').filter({ hasText: name });
}

async function importTokens(page: Page, name = 'brand.tokens.json'): Promise<void> {
  await fileInput(page).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(TOKENS_JSON, 'utf8'),
  });
  await expect(page.getByText(/revision/i)).toBeVisible({ timeout: 15000 });
}

test.describe('Token Sync import workflow', () => {
  test('a fresh document can import, undo, and redo an import', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);

    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });
    // Lead 1: the invitation must promise initialization, not refuse it.
    await expect(dialog.getByText(/a source is created for you/i)).toBeVisible();

    await importTokens(page);
    await expect(dialog.getByText(/4 tokens ready to import/)).toBeVisible();
    await dialog.screenshot({ path: evidencePath(`${SCREENSHOT_DIR}/import-preview.png`) });

    await dialog.getByRole('button', { name: 'Apply import' }).click();

    // The source now exists and reports its tokens. Scoped to the row: the
    // source menu and the selected-source detail repeat the same name.
    await expect(sourceRow(page, 'brand.tokens.json')).toBeVisible();
    await expect(dialog.getByText(/4 tokens/).first()).toBeVisible();
    await expect(dialog.getByText(/revision/i)).toBeHidden();
    await dialog.screenshot({ path: evidencePath(`${SCREENSHOT_DIR}/import-applied.png`) });

    // One coherent undo transaction removes everything the import created.
    await page.keyboard.press('ControlOrMeta+z');
    await expect(dialog.getByText(/a source is created for you/i)).toBeVisible({ timeout: 10000 });

    // …and redo restores it.
    await page.keyboard.press('ControlOrMeta+Shift+z');
    await expect(sourceRow(page, 'brand.tokens.json')).toBeVisible({ timeout: 10000 });
  });

  test('reports parse errors instead of offering a doomed apply', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);

    await fileInput(page).setInputFiles({
      name: 'broken.tokens.json',
      mimeType: 'application/json',
      buffer: Buffer.from('{ not json', 'utf8'),
    });
    await expect(page.getByText(/revision/i)).toBeVisible({ timeout: 15000 });
    await expect(page.getByText(/is not a JSON object and cannot be imported/i)).toBeVisible();
    await expect(page.getByRole('button', { name: 'Apply import' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('export is disabled until the document has tokens', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);
    await expect(page.getByRole('button', { name: 'Export DTCG file' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('exports the imported tokens as a DTCG file', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);
    await importTokens(page);
    await page.getByRole('button', { name: 'Apply import' }).click();
    await expect(sourceRow(page, 'brand.tokens.json')).toBeVisible();

    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export DTCG file' }).click();
    const download = await downloadPromise;
    expect(download.suggestedFilename()).toMatch(/\.tokens\.json$/);

    // The exported bytes must be a valid DTCG document carrying the import.
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const text = Buffer.concat(chunks).toString('utf8');
    const parsed = JSON.parse(text) as Record<string, unknown>;
    expect(parsed.$version).toBeUndefined();
    expect(parsed.color).toBeDefined();
    expect(parsed.spacing).toBeDefined();
    expect(JSON.stringify(parsed)).toContain('Brand primary');
  });
});
