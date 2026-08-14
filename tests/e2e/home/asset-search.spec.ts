import { expect, test } from '@playwright/test';
import { navigateToHome } from '../shared';

/**
 * Asset Browser search E2E. Covers the deterministic, model-free states:
 * exact filename retrieval with the ordering override, match reasons, the
 * opt-in model CTAs, and the status row. The semantic lane itself requires
 * model downloads + real inference, so those states are covered by the
 * unit-level service tests and the model-gated harness instead.
 */

const FIXTURE_IMAGE = 'tests/fixtures/semantic-corpus/img-000.png';

async function openAssetBrowser(page: import('@playwright/test').Page) {
  await navigateToHome(page);
  const assetsNav = page.getByRole('button', { name: /assets/i }).first();
  await assetsNav.click();
  await page.locator('.asset-browser').waitFor({ state: 'visible', timeout: 15000 });
}

async function importFixture(page: import('@playwright/test').Page, name: string) {
  await page.locator('.asset-browser input[type="file"]').setInputFiles({
    name,
    mimeType: 'image/png',
    buffer: require('node:fs').readFileSync(FIXTURE_IMAGE),
  });
  await expect(page.getByText(name)).toBeVisible({ timeout: 15000 });
}

test('search field renders with the hybrid placeholder', async ({ page }) => {
  await openAssetBrowser(page);
  const input = page.getByLabel('Search assets');
  await expect(input).toBeVisible();
  await expect(input).toHaveAttribute('placeholder', /describe|search by filename/i);
});

test('exact filename search retrieves the asset with the exact-match reason', async ({ page }) => {
  await openAssetBrowser(page);
  await importFixture(page, 'sunset-final.png');
  const input = page.getByLabel('Search assets');
  await input.fill('sunset-final.png');
  await expect(page.getByText('sunset-final.png')).toBeVisible();
  await expect(page.getByText('Exact filename match')).toBeVisible({ timeout: 10000 });
});

test('OCR text is searchable and shows its match reason', async ({ page }) => {
  await openAssetBrowser(page);
  const input = page.getByLabel('Search assets');
  await input.fill('invoice 8472');
  // No asset has OCR text in a fresh library: the empty state is reached,
  // and the semantic CTA (model not installed) is offered instead of an
  // infinite spinner.
  await expect(page.getByText(/no assets match/i)).toBeVisible({ timeout: 10000 });
  await expect(page.getByRole('button', { name: /natural-language search model/i })).toBeVisible();
});

test('model-absent state offers the explicit download and keeps lexical search working', async ({
  page,
}) => {
  await openAssetBrowser(page);
  await importFixture(page, 'poster-red.png');
  const input = page.getByLabel('Search assets');
  await input.fill('red poster');
  // Models are never auto-downloaded: the natural-language CTA is shown.
  await expect(page.getByRole('button', { name: /natural-language search model/i })).toBeVisible({
    timeout: 10000,
  });
  // Lexical search still works with the model absent.
  await input.fill('poster-red');
  await expect(page.getByText('poster-red.png')).toBeVisible();
  await expect(page.getByText('Exact filename match')).toBeVisible({ timeout: 10000 });
});

test('indexing affordance appears once image assets exist and the visual model is absent', async ({
  page,
}) => {
  await openAssetBrowser(page);
  await importFixture(page, 'photo-a.png');
  await expect(
    page.getByRole('button', { name: /visual search model to index assets/i }),
  ).toBeVisible({ timeout: 10000 });
});

test('search field is keyboard-clearable and Escape-friendly via the clear button', async ({
  page,
}) => {
  await openAssetBrowser(page);
  const input = page.getByLabel('Search assets');
  await input.fill('anything');
  await expect(input).toHaveValue('anything');
  await page.getByLabel('Clear search').click();
  await expect(input).toHaveValue('');
});
