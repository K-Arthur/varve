import { expect, type Page, test } from '@playwright/test';

/**
 * Download page: platform/architecture recommendation, trust copy, first-use
 * conversion, and responsive/keyboard behavior.
 *
 * The default project UA is HeadlessChrome, which the page treats as a bot —
 * every test that exercises recommendation sets an explicit UA so the
 * behavior under test is the real one.
 */

const LINUX_X64_UA =
  'Mozilla/5.0 (X11; Linux x86_64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const LINUX_ARM64_UA =
  'Mozilla/5.0 (X11; Linux aarch64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const WINDOWS_UA =
  'Mozilla/5.0 (Windows NT 10.0; Win64; x64) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const MACOS_UA =
  'Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7) AppleWebKit/537.36 (KHTML, like Gecko) Chrome/126.0 Safari/537.36';
const BOT_UA = 'Mozilla/5.0 (compatible; Googlebot/2.1; +http://www.google.com/bot.html)';
const IPHONE_UA =
  'Mozilla/5.0 (iPhone; CPU iPhone OS 17_0 like Mac OS X) AppleWebKit/605.1.15 (KHTML, like Gecko) Version/17.0 Mobile/15E148 Safari/604.1';

async function openDownload(page: Page) {
  await page.goto('/download');
}

test('Linux x86_64 visitor gets a labeled recommendation, not a claim', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: LINUX_X64_UA });
  const page = await context.newPage();
  await openDownload(page);

  await expect(page.locator('#detection-banner')).toBeVisible();
  await expect(page.locator('#detection-banner')).toContainText('recommend');
  await expect(page.locator('#detection-banner')).toContainText('best guess');

  // The recommended platform's tab is preselected and its column carries the chip.
  await expect(page.locator('#platform-tab-linux')).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.locator('.quick-download-col[data-platform-col="linux"] .recommend-chip'),
  ).toBeVisible();
  await expect(
    page.locator('.quick-download-col[data-platform-col="macos"] .recommend-chip'),
  ).toBeHidden();

  // x86_64 is first by default and marked for this device; ARM64 is not claimed.
  const linuxColumn = page.locator('.quick-download-col[data-platform-col="linux"]');
  await expect(linuxColumn.locator('.quick-architecture').first()).toHaveAttribute(
    'data-arch',
    'x86_64',
  );
  await expect(linuxColumn.locator('.quick-architecture[data-arch="x86_64"]')).toHaveClass(
    /recommended-arch/,
  );
  await expect(
    linuxColumn.locator('.quick-architecture[data-arch="x86_64"] .arch-chip'),
  ).toBeVisible();
  await expect(
    linuxColumn.locator('.quick-architecture[data-arch="aarch64"] .arch-chip'),
  ).toBeHidden();

  // Download controls carry analytics attributes and point at the release manifest URLs.
  const primary = linuxColumn
    .locator('.quick-architecture[data-arch="x86_64"] .quick-download-btn')
    .first();
  await expect(primary).toHaveAttribute('data-analytics-platform', 'linux');
  await expect(primary).toHaveAttribute('data-analytics-architecture', 'x64');
  await expect(primary).toHaveAttribute(
    'href',
    /github\.com\/K-Arthur\/varve\/releases\/download\//,
  );

  await context.close();
});

test('Linux ARM64 device gets the ARM64 build promoted first', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: LINUX_ARM64_UA });
  const page = await context.newPage();
  await openDownload(page);

  const linuxColumn = page.locator('.quick-download-col[data-platform-col="linux"]');
  await expect(linuxColumn.locator('.quick-architecture').first()).toHaveAttribute(
    'data-arch',
    'aarch64',
  );
  await expect(linuxColumn.locator('.quick-architecture[data-arch="aarch64"]')).toHaveClass(
    /recommended-arch/,
  );
  await expect(
    linuxColumn.locator('.quick-architecture[data-arch="aarch64"] .arch-chip'),
  ).toBeVisible();

  await context.close();
});

test('Windows visitor gets the Windows column recommended', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: WINDOWS_UA });
  const page = await context.newPage();
  await openDownload(page);

  await expect(page.locator('#platform-tab-windows')).toHaveAttribute('aria-selected', 'true');
  await expect(
    page.locator('.quick-download-col[data-platform-col="windows"] .recommend-chip'),
  ).toBeVisible();
  // The x64 hint is reported for Windows (reliable there), not hidden.
  await expect(
    page.locator(
      '.quick-download-col[data-platform-col="windows"] .quick-architecture[data-arch="x86_64"] .arch-chip',
    ),
  ).toBeVisible();

  await context.close();
});

test('macOS guidance is Apple-Silicon-only and never claims a specific Mac model', async ({
  browser,
}) => {
  const context = await browser.newContext({ userAgent: MACOS_UA });
  const page = await context.newPage();
  await openDownload(page);

  await expect(page.locator('#platform-tab-macos')).toHaveAttribute('aria-selected', 'true');
  const banner = page.locator('#detection-banner');
  await expect(banner).toBeVisible();
  await expect(banner).toContainText('Apple Silicon only');
  // The browser "Intel" hint is called out as ambiguous (Rosetta), not asserted.
  await expect(banner).toContainText('About This Mac');
  await expect(
    page.locator('.quick-download-col[data-platform-col="macos"] .recommend-chip'),
  ).toBeVisible();

  await context.close();
});

test('bots and crawlers get no recommendation, no banner, no preselect', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: BOT_UA });
  const page = await context.newPage();
  await openDownload(page);

  await expect(page.locator('#detection-banner')).toBeHidden();
  await expect(page.locator('.recommend-chip').first()).toBeHidden();
  await expect(page.locator('.arch-chip').first()).toBeHidden();
  // Default first platform stays active for everyone.
  await expect(page.locator('#platform-tab-linux')).toHaveAttribute('aria-selected', 'true');

  await context.close();
});

test('mobile visitors see the desktop-only notice and no recommendation', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: IPHONE_UA,
    hasTouch: true,
    viewport: { width: 390, height: 844 },
  });
  const page = await context.newPage();
  await openDownload(page);

  await expect(page.locator('#mobile-download-notice')).toBeVisible();
  await expect(page.locator('#detection-banner')).toBeHidden();
  await expect(page.locator('.recommend-chip').first()).toBeHidden();

  await context.close();
});

test('manual override dismisses the recommendation and persists across reloads', async ({
  browser,
}) => {
  const context = await browser.newContext({ userAgent: LINUX_X64_UA });
  const page = await context.newPage();
  await openDownload(page);

  await expect(page.locator('#detection-banner')).toBeVisible();
  await page.getByRole('link', { name: 'Choose another platform' }).click();
  await expect(page.locator('#detection-banner')).toBeHidden();
  await expect(page.locator('.recommend-chip').first()).toBeHidden();

  // The choice is stored on this machine only and wins on the next visit.
  await page.reload();
  await expect(page.locator('#detection-banner')).toBeHidden();
  await expect(page.locator('.recommend-chip').first()).toBeHidden();

  await context.close();
});

test('tablist keyboard navigation works (Arrow keys, Home, End)', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: WINDOWS_UA });
  const page = await context.newPage();
  await openDownload(page);

  const linuxTab = page.locator('#platform-tab-linux');
  await linuxTab.focus();
  await page.keyboard.press('ArrowRight');
  await expect(page.locator('#platform-tab-macos')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#platform-macos')).toHaveClass(/active/);
  await page.keyboard.press('End');
  await expect(page.locator('#platform-tab-windows')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#platform-tab-windows')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(page.locator('#platform-tab-linux')).toHaveAttribute('aria-selected', 'true');
  await page.keyboard.press('ArrowLeft');
  await expect(page.locator('#platform-tab-windows')).toHaveAttribute('aria-selected', 'true');

  await context.close();
});

test('checksums-and-requirements jump links activate the matching tab', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: LINUX_X64_UA });
  const page = await context.newPage();
  await openDownload(page);

  await page
    .locator('.quick-download-col[data-platform-col="linux"] .quick-download-detail-link')
    .click();
  await expect(page.locator('#platform-linux')).toHaveClass(/active/);
  await expect(page.locator('#platform-linux .checksum-value').first()).toBeVisible();

  await context.close();
});

test('desktop quick-download buttons align across platform architecture rows', async ({
  browser,
}) => {
  const context = await browser.newContext({
    userAgent: LINUX_X64_UA,
    viewport: { width: 1280, height: 900 },
  });
  const page = await context.newPage();
  await openDownload(page);
  await page.waitForLoadState('networkidle');
  await expect(
    page.locator(
      '.quick-download-col[data-platform-col="linux"] .quick-architecture[data-arch="x86_64"]',
    ),
  ).toHaveClass(/recommended-arch/);
  await expect(page.locator('.quick-download-btn').first()).toBeVisible();
  await page.evaluate(() => document.fonts.ready);

  const geometry = await page.evaluate(() => {
    const columns = [...document.querySelectorAll<HTMLElement>('.quick-download-col')];
    const buttons = columns.map((column) =>
      [...column.querySelectorAll<HTMLElement>('.quick-architecture')].map((row) => {
        const button = row.querySelector<HTMLElement>('.quick-download-btn');
        const rect = button?.getBoundingClientRect();
        return rect ? { top: rect.top, right: rect.right } : null;
      }),
    );
    return {
      firstRow: buttons.flatMap((rows) => (rows[0] ? [rows[0]] : [])),
      secondRow: buttons.flatMap((rows) => (rows[1] ? [rows[1]] : [])),
      viewportWidth: document.documentElement.clientWidth,
      maxButtonRight: Math.max(
        ...buttons.flatMap((rows) => rows.filter(Boolean).map((button) => button!.right)),
      ),
    };
  });
  const firstRowTops = geometry.firstRow.map((button) => button.top);
  expect(Math.max(...firstRowTops) - Math.min(...firstRowTops)).toBeLessThanOrEqual(1);
  const secondRowTops = geometry.secondRow.map((button) => button.top);
  expect(Math.max(...secondRowTops) - Math.min(...secondRowTops)).toBeLessThanOrEqual(1);
  expect(geometry.maxButtonRight).toBeLessThanOrEqual(geometry.viewportWidth);

  await context.close();
});

test('ARM64 recommendation keeps architecture rows before the detail link', async ({ browser }) => {
  const context = await browser.newContext({ userAgent: LINUX_ARM64_UA });
  const page = await context.newPage();
  await openDownload(page);
  await page.waitForLoadState('networkidle');
  await expect(
    page.locator(
      '.quick-download-col[data-platform-col="linux"] .quick-architecture[data-arch="aarch64"]',
    ),
  ).toHaveClass(/recommended-arch/);

  const childOrder = await page
    .locator('.quick-download-col[data-platform-col="linux"]')
    .evaluate((column) => ({
      column: [...column.children].map((child) => child.className),
      architectureList: [...column.querySelectorAll('.quick-architecture-list > *')].map(
        (child) => child.className,
      ),
    }));
  const lastArchitecture = Math.max(
    ...childOrder.architectureList.map((className, index) =>
      className.includes('quick-architecture') ? index : -1,
    ),
  );
  const detailLink = childOrder.column.findIndex((className) =>
    className.includes('quick-download-detail-link'),
  );
  const architectureList = childOrder.column.findIndex((className) =>
    className.includes('quick-architecture-list'),
  );
  expect(lastArchitecture).toBeGreaterThanOrEqual(0);
  expect(detailLink).toBeGreaterThan(architectureList);
  expect(childOrder.architectureList[0]).toContain('recommended-arch');

  await context.close();
});

test('no horizontal overflow at 320px with the long artifact names', async ({ browser }) => {
  const context = await browser.newContext({
    userAgent: LINUX_X64_UA,
    viewport: { width: 320, height: 720 },
  });
  const page = await context.newPage();
  await openDownload(page);

  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  // A checksum line at 320px wraps instead of overflowing.
  const checksumBox = await page.locator('.checksum-value').first().boundingBox();
  expect(checksumBox).not.toBeNull();
  expect(checksumBox!.width).toBeLessThanOrEqual(321);

  await context.close();
});

test('the page works with JavaScript disabled (server-rendered baseline)', async ({ browser }) => {
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  await openDownload(page);

  // The quick grid and the first platform section are server-rendered; no
  // detection banner is needed for the page to be usable.
  await expect(page.locator('.quick-download-btn').first()).toBeVisible();
  await expect(page.locator('#platform-linux')).toHaveClass(/active/);
  await expect(
    page.locator('.quick-download-col[data-platform-col="linux"] .quick-architecture').first(),
  ).toHaveAttribute('data-arch', 'x86_64');
  const overflow = await page.evaluate(() => {
    const doc = document.documentElement;
    return { scrollWidth: doc.scrollWidth, clientWidth: doc.clientWidth };
  });
  expect(overflow.scrollWidth).toBeLessThanOrEqual(overflow.clientWidth + 1);

  await context.close();
});

test('after-install section links a downloadable sample document and tutorials', async ({
  browser,
}) => {
  const context = await browser.newContext({ userAgent: LINUX_X64_UA });
  const page = await context.newPage();
  await openDownload(page);

  const sampleLink = page.locator('#after-install a[download]');
  await expect(sampleLink).toHaveAttribute('href', /\/samples\/varve-poster\.varve$/);
  const sampleResponse = await page.request.get('/samples/varve-poster.varve');
  expect(sampleResponse.ok()).toBeTruthy();

  await expect(
    page.locator('#after-install').getByRole('link', { name: 'first-project guide' }),
  ).toHaveAttribute('href', /\/docs\/getting-started\/first-project$/);

  // Troubleshooting links resolve to existing pages.
  await expect(
    page.locator('#troubleshoot-help').getByRole('link', { name: 'Troubleshooting guide' }),
  ).toHaveAttribute('href', /\/support\/troubleshooting$/);

  await context.close();
});
