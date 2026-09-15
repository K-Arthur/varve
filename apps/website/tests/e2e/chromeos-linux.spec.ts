import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';

/**
 * ChromeOS Linux guide: the install contract must stay exact (package name,
 * checksum step, apt usage, uninstall/data boundary) and must be reachable from
 * the pages that describe Linux downloads and troubleshooting.
 *
 * The version and hash are read from the committed website release manifest
 * and the repository guide instead of being typed twice, so a release bump
 * cannot silently leave the page stale.
 */
const repoRoot = resolve(import.meta.dirname, '../../../..');
const manifest = JSON.parse(
  readFileSync(resolve(repoRoot, 'apps/website/src/data/release-manifest.json'), 'utf8'),
) as { version: string };
const guide = readFileSync(resolve(repoRoot, 'docs/release/chromeos-linux.md'), 'utf8');

test.beforeEach(async ({ page }) => {
  await page.addInitScript(() => {
    window.localStorage.setItem('varve:website-analytics-consent', 'denied');
  });
});

test('ChromeOS guide renders the exact package, verification, and uninstall contract', async ({
  page,
}) => {
  await page.goto('/docs/chromeos-linux');

  await expect(page.getByRole('heading', { name: 'Varve on ChromeOS' })).toBeVisible();
  await expect(page).toHaveTitle(/ChromeOS/);

  const aarch64Artifact = `Varve-${manifest.version}-linux-aarch64.deb`;
  await expect(page.getByText(aarch64Artifact).first()).toBeVisible();
  await expect(
    page
      .getByText(
        `curl -fLO https://github.com/K-Arthur/varve/releases/download/v${manifest.version}`,
      )
      .first(),
  ).toBeVisible();
  await expect(page.getByText('sha256sum -c --ignore-missing SHA256SUMS.txt')).toBeVisible();
  await expect(
    page.getByText(`sudo apt update && sudo apt install ./${aarch64Artifact}`),
  ).toBeVisible();
  await expect(page.getByText('sudo apt remove varve')).toBeVisible();
  await expect(page.getByText('Share with Linux')).toBeVisible();

  // The guide's status note must not claim support that does not exist.
  await expect(page.getByText(/experimental/i).first()).toBeVisible();
  await expect(page.getByText(/no physical Chromebook run/i)).toBeVisible();
});

test('the guide stays aligned with the repository installation contract', () => {
  // Guard against the site copy drifting from the canonical repo guide: both
  // must carry the same exact artifact name and the same apt install command.
  const aarch64Artifact = `Varve-${manifest.version}-linux-aarch64.deb`;
  for (const required of [
    aarch64Artifact,
    `sudo apt install ./${aarch64Artifact}`,
    'sha256sum -c --ignore-missing SHA256SUMS.txt',
    'sudo apt remove varve',
  ]) {
    expect(guide, `repo guide must contain: ${required}`).toContain(required);
  }
});

const LINUX_ARM64_UA =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';

test('Linux download surfaces link to the ChromeOS guide', async ({ page, browser }) => {
  const context = await browser.newContext({ userAgent: LINUX_ARM64_UA });
  const linuxPage = await context.newPage();
  await linuxPage.goto('/download');
  const linuxSection = linuxPage.locator('#platform-linux');
  await expect(linuxSection).toBeVisible();
  await expect(
    linuxSection.locator('.distro-table').getByText('ChromeOS (Linux development environment)'),
  ).toBeVisible();
  await expect(linuxSection.locator('a[href$="/docs/chromeos-linux"]').first()).toBeVisible();
  await context.close();

  await page.goto('/docs/getting-started');
  await expect(page.locator('a[href$="/docs/chromeos-linux"]').first()).toBeVisible();

  await page.goto('/support/troubleshooting');
  await expect(page.locator('a[href$="/docs/chromeos-linux"]').first()).toBeVisible();
  await expect(page.getByRole('heading', { name: /ChromeOS/ }).first()).toBeVisible();

  await page.goto('/docs');
  await expect(page.locator('a[href$="/docs/chromeos-linux"]').first()).toBeVisible();
});

test('the guide route is discoverable from the sitemap', async ({ request }) => {
  const res = await request.get('/sitemap.xml');
  expect(res.status()).toBe(200);
  const xml = await res.text();
  expect(xml).toContain('/docs/chromeos-linux');
});
