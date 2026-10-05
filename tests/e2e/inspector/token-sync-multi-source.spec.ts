/**
 * Token Sync — multi-source import, source switching, and source editing.
 *
 * Covers the four interaction paths that only exist in a real browser:
 *   1. a document created before DTCG support existed can start a source,
 *   2. a second import lands in its own source with its own name and status,
 *   3. switching the source previews that source's tokens,
 *   4. editing a source with non-DTCG data shows an error notice and leaves
 *      every other action usable.
 *
 * The race these tests guard against: "Imported … into a new source" is
 * announced from the apply path while the source row is painted by a later
 * render, so each step waits for the row rather than for the announcement.
 */
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const TOKENS_A = JSON.stringify(
  {
    color: {
      $description: 'Brand colors',
      primary: { $type: 'color', $value: { colorSpace: 'srgb', components: [0.2, 0.4, 0.8] } },
      accent: { $type: 'color', $value: '{color.primary}' },
    },
  },
  null,
  2,
);

const TOKENS_B = JSON.stringify(
  {
    spacing: {
      $description: 'Spacing scale',
      gap: { $type: 'dimension', $value: { value: 8, unit: 'px' } },
      stack: { $type: 'dimension', $value: { value: 16, unit: 'px' } },
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

async function importTokens(page: Page, name: string, text: string): Promise<void> {
  await fileInput(page).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  });
  await expect(page.getByText(/revision/i)).toBeVisible({ timeout: 15000 });
}

/** The whole source row (name + status + counts), scoped by its name. */
function sourceRow(page: Page, name: string) {
  return page.locator('.token-sync-panel__source').filter({ hasText: name });
}

/** Open a custom Select by its field label and pick an option. */
async function pickOption(page: Page, dialog: Locator, triggerName: string, option: string) {
  await dialog.getByRole('combobox', { name: triggerName }).click();
  await page.getByRole('option', { name: option, exact: true }).click();
}

test.describe('Token Sync multi-source workflow', () => {
  test('imports from a pre-DTCG document into two sources and previews each', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });

    // 1. A document created before DTCG support existed: no token store yet.
    await expect(dialog.getByText(/No token sources yet/)).toBeVisible();
    await expect(dialog.getByText(/a source is created for you/i)).toBeVisible();

    // First import creates source one.
    await importTokens(page, 'brand.tokens.json', TOKENS_A);
    await expect(dialog.getByText(/2 tokens ready to import/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    // Wait for the painted row, not the announcement.
    await expect(sourceRow(page, 'brand.tokens.json')).toBeVisible({ timeout: 15000 });
    await expect(sourceRow(page, 'brand.tokens.json')).toContainText('In sync');

    // 2. Second import: choose "create a new source" explicitly.
    await importTokens(page, 'brand2.tokens.json', TOKENS_B);
    await expect(dialog.getByText(/2 tokens ready to import/)).toBeVisible();
    const destination = dialog.getByRole('combobox', { name: 'Destination source' });
    await expect(destination).toBeVisible();
    await pickOption(page, dialog, 'Destination source', 'New source for brand2.tokens.json');
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await expect(sourceRow(page, 'brand2.tokens.json')).toBeVisible({ timeout: 15000 });

    // Both sources exist with their own names and statuses.
    await expect(sourceRow(page, 'brand.tokens.json')).toContainText('In sync');
    await expect(sourceRow(page, 'brand2.tokens.json')).toContainText('In sync');
    await expect(sourceRow(page, 'brand.tokens.json')).toContainText('2 tokens');
    await expect(sourceRow(page, 'brand2.tokens.json')).toContainText('2 tokens');

    // 3. Switching the source previews that source's tokens. Exactly one list
    //    is rendered, so scope by class and identify it by its own label —
    //    getByLabel would substring-match both list labels.
    const tokensList = dialog.locator('.token-sync-panel__tokens');
    await pickOption(page, dialog, 'Source', 'brand2.tokens.json');
    await expect(tokensList).toHaveCount(1);
    await expect(tokensList).toHaveAttribute('aria-label', 'Tokens in brand2.tokens.json');
    await expect(tokensList).toContainText('spacing.gap');
    await expect(tokensList).toContainText('spacing.stack');
    await expect(tokensList).not.toContainText('color.primary');

    await pickOption(page, dialog, 'Source', 'brand.tokens.json');
    await expect(tokensList).toHaveAttribute('aria-label', 'Tokens in brand.tokens.json');
    await expect(tokensList).toContainText('color.primary');
    await expect(tokensList).not.toContainText('spacing.gap');

    // 4. Editing a source with non-DTCG data shows an error notice.
    await pickOption(page, dialog, 'Source', 'brand2.tokens.json');
    await dialog.getByRole('button', { name: 'Edit source content' }).click();
    const editor = dialog.getByLabel(/Source content:/);
    await expect(editor).toBeVisible();
    await editor.fill('this is definitely not tokens');
    await dialog.getByRole('button', { name: 'Validate and preview' }).click();

    const notice = dialog.getByRole('alert');
    await expect(notice).toBeVisible();
    // The source editor reports the parser's own diagnostic (with line and
    // column) instead of a generic "not a JSON object" sentence.
    await expect(notice).toContainText(/Unexpected token/i);
    await expect(notice).toContainText(/nothing was changed/i);

    // The notice must not have cost us anything: the panel stays usable.
    await expect(dialog.getByRole('button', { name: 'Export DTCG file' })).not.toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(sourceRow(page, 'brand2.tokens.json')).toContainText('2 tokens');

    await dialog.getByRole('button', { name: 'Cancel edit' }).click();
    await expect(dialog.getByLabel(/Source content:/)).toHaveCount(0);
    await expect(dialog.getByRole('alert')).toHaveCount(0);

    // Switching still works after the failed edit.
    await pickOption(page, dialog, 'Source', 'brand.tokens.json');
    await expect(tokensList).toHaveAttribute('aria-label', 'Tokens in brand.tokens.json');
    await expect(tokensList).toContainText('color.primary');
  });
});
