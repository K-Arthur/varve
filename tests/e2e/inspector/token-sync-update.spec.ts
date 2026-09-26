/**
 * Token Sync — end-to-end external update (three-way merge) in a browser.
 *
 * The unit/component suites prove the merge engine and conflict review; the
 * failure modes this flow actually ships (a re-import that silently skipped
 * every colliding path, a no-op that announced success) are only visible in
 * the real file input, the real preview, and the real document transaction.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const SCREENSHOT_DIR = 'docs/screenshots/token-sync-import';

const BASE_TOKENS_JSON = JSON.stringify(
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

/** Same file, edited upstream: brand.primary changed, spacing.gap removed. */
const UPDATED_TOKENS_JSON = JSON.stringify(
  {
    color: {
      $description: 'Color foundation',
      brand: {
        primary: {
          $type: 'color',
          $description: 'Brand primary',
          $value: { colorSpace: 'srgb', components: [0.1, 0.4, 0.8] },
        },
        alias: { $type: 'color', $value: '{color.brand.primary}' },
      },
    },
    spacing: {
      $type: 'dimension',
      $root: { $value: { value: 16, unit: 'px' } },
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

async function writeTokens(page: Page, name: string, text: string): Promise<void> {
  await fileInput(page).setInputFiles({
    name,
    mimeType: 'application/json',
    buffer: Buffer.from(text, 'utf8'),
  });
  await expect(page.getByText(/revision/i)).toBeVisible({ timeout: 15000 });
}

test.describe('Token Sync external update workflow', () => {
  test('a re-import applies upstream edits and deletions as one update', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });

    await writeTokens(page, 'brand.tokens.json', BASE_TOKENS_JSON);
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await expect(dialog.getByText(/4 tokens/).first()).toBeVisible();

    // The same file, edited upstream and re-read.
    await writeTokens(page, 'brand.tokens.json', UPDATED_TOKENS_JSON);
    await expect(dialog.getByText(/1 updated, 1 deleted from brand\.tokens\.json/)).toBeVisible();
    // Assertions read the DOM and a screenshot reads painted pixels; give the
    // compositor a committed frame so the captured image matches the asserted
    // state instead of the frame before it.
    await page.waitForTimeout(600);
    await dialog.screenshot({ path: `${SCREENSHOT_DIR}/update-preview.png` });

    await dialog.getByRole('button', { name: 'Apply update' }).click();
    // Preview consumed, source reflects the deletion.
    await expect(dialog.getByText(/revision/i)).toBeHidden();
    await expect(dialog.getByText(/3 tokens/).first()).toBeVisible();
    await page.waitForTimeout(600);
    await dialog.screenshot({ path: `${SCREENSHOT_DIR}/update-applied.png` });

    // Structured-data proof: the exported bytes must show the upstream edit
    // and the upstream deletion, and must keep the metadata.
    const downloadPromise = page.waitForEvent('download');
    await page.getByRole('button', { name: 'Export DTCG file' }).click();
    const download = await downloadPromise;
    const stream = await download.createReadStream();
    const chunks: Buffer[] = [];
    for await (const chunk of stream) chunks.push(chunk as Buffer);
    const exported = JSON.parse(Buffer.concat(chunks).toString('utf8')) as {
      color?: {
        $description?: string;
        brand?: { primary?: { $value?: { components?: number[] }; $description?: string } };
      };
      spacing?: { gap?: unknown; $root?: unknown };
    };
    expect(exported.color?.brand?.primary?.$value?.components).toEqual([0.1, 0.4, 0.8]);
    expect(exported.color?.$description).toBe('Color foundation');
    expect(exported.spacing?.gap).toBeUndefined();
    expect(exported.spacing?.$root).toBeDefined();
  });

  test('an unchanged re-import reports a no-op instead of success', async ({ page }) => {
    await navigateToEditor(page);
    await openVariablesDialog(page);
    const dialog = page.getByRole('dialog', { name: 'Variables and tokens' });

    await writeTokens(page, 'brand.tokens.json', BASE_TOKENS_JSON);
    await dialog.getByRole('button', { name: 'Apply import' }).click();
    await expect(dialog.getByText(/4 tokens/).first()).toBeVisible();

    await writeTokens(page, 'brand.tokens.json', BASE_TOKENS_JSON);
    // The preview states the match; the disabled button's reason echoes it.
    await expect(dialog.getByText(/matches this document/).first()).toBeVisible();
    await expect(dialog.getByRole('button', { name: 'Apply update' })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await dialog.screenshot({ path: `${SCREENSHOT_DIR}/update-noop.png` });
  });
});
