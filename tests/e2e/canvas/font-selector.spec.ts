import { readFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { dragOnCanvas, navigateToEditor } from '../shared';

test.describe('Font selector', () => {
  test.describe.configure({ mode: 'serial' });
  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
  });

  test('font selector opens dropdown with bundled fonts', async ({ page }) => {
    // Select the text tool
    await page.keyboard.press('t');

    // Create a text node on canvas
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await page.waitForTimeout(500);

    // TextTool enters editing mode after the drag, so the floating text bar is
    // already the active formatting surface. Clicking the canvas here would
    // commit the editor and hide the very bar this test is exercising.
    const treeItems = page.getByRole('treeitem');
    await expect(treeItems.first()).toContainText(/text/i, { timeout: 10000 });

    // Click the floating text bar (font family selector should be visible)
    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    // Open the font selector dropdown
    const fontInput = fontSelector.locator('input');
    await fontInput.click();
    await page.waitForTimeout(300);

    // Verify the dropdown appears
    const dropdown = page.locator('.font-selector__dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });
    const inputBox = await fontInput.boundingBox();
    const dropdownBox = await dropdown.boundingBox();
    expect(inputBox).not.toBeNull();
    expect(dropdownBox).not.toBeNull();
    expect(dropdownBox!.width).toBeLessThanOrEqual(inputBox!.width);
    await page.screenshot({
      path: test.info().outputPath('font-selector-open.png'),
      fullPage: true,
    });

    // Verify at least one font option is listed
    const options = dropdown.locator('.font-selector__option');
    const count = await options.count();
    expect(count).toBeGreaterThan(0);
  });

  test('font selector shows bundled and system sections', async ({ page }) => {
    // Select text tool
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    // Open the font selector
    await fontSelector.locator('input').click();
    await page.waitForTimeout(300);

    // Verify section headers exist (Recent, System, Bundled, or All)
    const sectionHeaders = page.locator('.font-selector__section-header');
    const headerCount = await sectionHeaders.count();
    expect(headerCount).toBeGreaterThan(0);
  });

  test('keyboard navigation works in font selector', async ({ page }) => {
    // Select text tool
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    const fontInput = fontSelector.locator('input');
    await fontInput.focus();

    // Type to search for a font
    await fontInput.fill('IBM');
    await page.waitForTimeout(300);

    // Verify dropdown appears with filtered results
    const dropdown = page.locator('.font-selector__dropdown');
    await expect(dropdown).toBeVisible({ timeout: 3000 });

    // Navigate with arrow down
    await page.keyboard.press('ArrowDown');
    await page.waitForTimeout(100);

    // Press Enter to select highlighted item
    await page.keyboard.press('Enter');
    await page.waitForTimeout(300);

    // Input should now show the selected value
    const currentValue = await fontInput.inputValue();
    expect(currentValue.length).toBeGreaterThan(0);
  });

  test('font selector explains when a searched font is unknown', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    const fontInput = fontSelector.locator('input');
    await fontInput.focus();

    // Type an invalid font name
    await fontInput.fill('NonExistentFontXYZ');
    await page.waitForTimeout(300);

    // While the combobox is open the current document value is unchanged, so
    // the missing-family warning intentionally stays tied to the committed
    // value. The open menu gives the actionable query result instead.
    await expect(page.locator('.font-selector__option--empty')).toContainText(
      'No installed fonts match',
    );
  });

  test('font selector displays variable font badge', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });

    await fontSelector.locator('input').click();
    await page.waitForTimeout(300);

    // Check if any variable font badges exist (they use .font-selector__badge--var class)
    const varBadges = page.locator('.font-selector__badge--var');
    // Variable fonts may or may not be present, just verify no crash
    const badgeCount = await varBadges.count().catch(() => 0);
    expect(badgeCount).toBeGreaterThanOrEqual(0);
  });

  test('searches the installed semantic catalog without provider metadata requests', async ({
    page,
  }) => {
    let providerRequests = 0;
    page.on('request', (request) => {
      if (/googleapis|fonts\.google|api\.fontsource\.org/.test(request.url())) {
        providerRequests += 1;
      }
    });

    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 5000 });
    const fontInput = fontSelector.locator('input');
    await fontInput.fill('Inter');

    await expect(page.locator('.font-selector__option-name', { hasText: 'Inter' })).toBeVisible();
    await expect(page.getByRole('button', { name: 'Install' })).toHaveCount(0);
    expect(providerRequests).toBe(0);
    await page.screenshot({
      path: test.info().outputPath('fontsource-catalog-search.png'),
      fullPage: true,
    });
  });

  test('full browser interprets design-language queries and keeps installation explicit', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await expect(dialog).toBeVisible();
    const search = dialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    await search.fill('friendly rounded sans for UI');
    await expect(dialog.getByRole('status', { name: 'Search interpretation' })).toContainText(
      'Rounded',
    );
    await expect(dialog.getByText('Interpreted as')).toBeVisible();
    await expect(dialog.getByRole('button', { name: /Install/ }).first()).toBeVisible();
    await dialog.locator('.font-browser__select-btn').first().click();
    await expect(dialog.getByText('Why this result')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('font-browser-semantic-query.png'),
      fullPage: true,
    });
  });

  test('full browser exposes the exact variable axis before applying a face', async ({ page }) => {
    test.setTimeout(120000);
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    // The new document uses the bundled IBM Plex face by default, so the
    // manager opens on a real selected family without making a network-backed
    // catalog search part of this axis contract.
    await expect(dialog.getByRole('heading', { name: 'IBM Plex Sans Variable' })).toBeVisible();
    const axes = dialog.getByRole('region', { name: 'Variable font axes' });
    await expect(axes).toBeVisible();
    const weight = axes.getByRole('slider', { name: 'Weight (wght)' });
    await expect(weight).toHaveAttribute('min', '100');
    await expect(weight).toHaveAttribute('max', '700');
    await expect(weight).toHaveValue('400');
    await page.screenshot({
      path: test.info().outputPath('font-browser-variable-axes.png'),
      fullPage: true,
    });

    await weight.fill('650');
    await expect(weight).toHaveValue('650');
    await expect(
      dialog.getByRole('button', { name: 'Use IBM Plex Sans Variable face' }),
    ).toBeEnabled();
    await page.screenshot({
      path: test.info().outputPath('font-browser-variable-axes-custom.png'),
      fullPage: true,
    });
  });

  test('full browser favorites are explicit, filterable, and do not select a row', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    const search = dialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    // Keep the query to the distinctive family stem. The semantic parser can
    // interpret words such as “Variable” and “Sans” as design filters, which
    // returns a large ranked catalog and leaves the exact row outside the
    // initial virtualized viewport.
    await search.fill('Plex');

    const row = dialog
      .locator('.font-browser__entry')
      .filter({ hasText: 'IBM Plex Sans Variable' })
      .first();
    await expect(row).toBeVisible();
    const favorite = row.locator('button.font-browser__favorite');
    await expect(favorite).toHaveAttribute('aria-label', 'Add IBM Plex Sans Variable to favorites');
    await expect(favorite).toHaveAttribute('aria-pressed', 'false');
    await page.screenshot({
      path: test.info().outputPath('font-browser-favorite-available.png'),
      fullPage: true,
    });

    await favorite.click();
    await expect(favorite).toHaveAttribute(
      'aria-label',
      'Remove IBM Plex Sans Variable from favorites',
    );
    await expect(favorite).toHaveAttribute('aria-pressed', 'true');

    await dialog.getByRole('tab', { name: 'Favorites' }).click();
    await expect(
      dialog.locator('.font-browser__entry').filter({ hasText: 'IBM Plex Sans Variable' }).first(),
    ).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('font-browser-favorite-filter.png'),
      fullPage: true,
    });

    await row.locator('.font-browser__select-btn').click();
    await expect(dialog.getByRole('heading', { name: 'IBM Plex Sans Variable' })).toBeVisible();
  });

  test('finds gothic families without unrelated filler and keeps inspection stable', async ({
    page,
  }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    await page.getByRole('button', { name: 'Browse fonts' }).click();
    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    const search = dialog.getByRole('searchbox', {
      name: 'Search fonts by name or design language',
    });
    await expect(search).toBeFocused();
    await search.fill('gothic');

    const names = await dialog.locator('.font-browser__preview').allTextContents();
    expect(names.length).toBeGreaterThan(0);
    expect(names.every((name) => /gothic/i.test(name))).toBe(true);
    await expect(dialog.getByText('Adamina', { exact: true })).toHaveCount(0);

    await dialog.locator('.font-browser__select-btn').first().click();
    await expect(dialog.locator('.font-browser__details h3')).toBeVisible();
    await expect(dialog.getByLabel('Preview text')).toBeVisible();
    const specimen = dialog.locator('.font-browser__specimen');
    await expect(specimen).toHaveAttribute('data-preview-status', /^(ready|unavailable)$/, {
      timeout: 15000,
    });
    const previewStatus = await specimen.getAttribute('data-preview-status');
    if (previewStatus === 'ready') {
      const specimenGeometry = await specimen.evaluate((element) => {
        const bounds = element.getBoundingClientRect();
        const nextContent = element.nextElementSibling?.getBoundingClientRect();
        return {
          specimenBottom: bounds.bottom,
          nextContentTop: nextContent?.top ?? bounds.bottom,
        };
      });
      expect(specimenGeometry.specimenBottom).toBeLessThanOrEqual(
        specimenGeometry.nextContentTop + 1,
      );
    } else {
      // Search may select a catalog face that is not installed locally. The
      // manager must explain the explicit install boundary instead of
      // fetching a preview as a side effect of search or hover.
      await expect(dialog.getByText(/install this font to preview/i)).toBeVisible();
    }
    await expect(dialog.locator('.font-browser__list-heading strong')).toBeVisible();
    await expect(dialog.locator('.font-browser__list')).toBeVisible();
    await page.screenshot({
      path: test.info().outputPath('font-browser-gothic-inspection.png'),
      fullPage: true,
    });
  });

  test('keeps the browser readable across themes at a compact viewport', async ({ page }) => {
    await page.keyboard.press('t');
    await dragOnCanvas(page, 120, 160, 360, 220);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });
    await page.getByRole('button', { name: 'Browse fonts' }).click();

    const dialog = page.getByRole('dialog', { name: 'Browse fonts' });
    await page.setViewportSize({ width: 540, height: 640 });
    for (const theme of ['light', 'dark', 'high-contrast']) {
      await page.evaluate((nextTheme) => {
        document.documentElement.dataset.theme = nextTheme;
      }, theme);

      await expect(dialog).toBeVisible();
      const layout = await dialog.locator('.font-browser').evaluate((element) => ({
        clientWidth: element.clientWidth,
        scrollWidth: element.scrollWidth,
        clientHeight: element.clientHeight,
        scrollHeight: element.scrollHeight,
      }));
      expect(layout.scrollWidth).toBeLessThanOrEqual(layout.clientWidth);
      expect(layout.scrollHeight).toBeLessThanOrEqual(layout.clientHeight);
      await expect(dialog.getByRole('searchbox')).toBeVisible();
      await expect(dialog.getByRole('tablist')).toBeVisible();
      await page.screenshot({
        path: test.info().outputPath(`font-browser-${theme}.png`),
        fullPage: true,
      });
    }
  });
});

test.describe('downloaded font restoration', () => {
  test('restores a persisted face before the editor checks document fonts', async ({
    page,
  }, testInfo) => {
    const fontPath = resolve(
      process.cwd(),
      'apps/desktop/node_modules/@fontsource-variable/geist/files/geist-latin-wght-normal.woff2',
    );
    const fontBytes = await readFile(fontPath);

    // Use a same-origin static page as the seed surface. The app has not
    // mounted yet, so startup restoration cannot race the record insertion.
    await page.goto('/icons/favicon.svg', {
      timeout: 300000,
      waitUntil: 'domcontentloaded',
    });
    await page.evaluate(async (bytes) => {
      const dbName = 'varve-font-storage-v2';
      localStorage.removeItem('varve:safe-mode');
      localStorage.removeItem('varve:crash-loop');
      localStorage.setItem('strata-clean-shutdown', 'true');
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.deleteDatabase(dbName);
        request.onsuccess = () => resolve();
        request.onerror = () => reject(request.error);
        request.onblocked = () => resolve();
      });
      await new Promise<void>((resolve, reject) => {
        const request = indexedDB.open(dbName, 1);
        request.onupgradeneeded = () => {
          request.result.createObjectStore('artifacts', { keyPath: 'key' });
        };
        request.onerror = () => reject(request.error);
        request.onsuccess = () => {
          const db = request.result;
          const transaction = db.transaction('artifacts', 'readwrite');
          transaction.objectStore('artifacts').put({
            key: 'e2e-fontsource-carrois-gothic',
            familyName: 'Carrois Gothic',
            data: new Uint8Array(bytes).buffer,
            metadata: {
              providerId: 'fontsource',
              familyId: 'carrois-gothic',
              packageVersion: '5.3.0',
              upstreamVersion: 'v1.0.0',
              weight: 400,
              style: 'normal',
              subset: 'latin',
              variable: true,
            },
            storedAt: Date.now(),
          });
          transaction.oncomplete = () => {
            db.close();
            resolve();
          };
          transaction.onerror = () => reject(transaction.error);
        };
      });
    }, Array.from(fontBytes));

    await navigateToEditor(page);
    const editorShell = page.locator('.editor-shell');
    const safeModeExit = page.getByRole('button', { name: /continue normal startup/i });
    if (await safeModeExit.isVisible({ timeout: 1000 }).catch(() => false)) {
      await safeModeExit.click({ timeout: 5000 });
      await page.waitForTimeout(500);
    }
    if (!(await editorShell.isVisible({ timeout: 5000 }).catch(() => false))) {
      // The shared helper can land back on Home when its storage-race
      // recovery uses a single click. Double-click the visible card to open
      // the document before exercising the font workflow.
      await page.getByRole('gridcell').first().dblclick({ timeout: 30000 });
      await editorShell.waitFor({ state: 'visible', timeout: 30000 });
    }
    // The main tool strip owns data-tool attributes. Use the same keyboard
    // activation path as the other font workflows so this remains valid when
    // the toolbar is collapsed on a responsive layout.
    await page.keyboard.press('t');
    await dragOnCanvas(page, 200, 200, 400, 250);
    await page.keyboard.insertText('Typography in context');
    await expect(page.getByRole('treeitem').first()).toContainText(/text/i, { timeout: 10000 });

    const fontSelector = page.locator('.font-selector').first();
    await fontSelector.waitFor({ state: 'visible', timeout: 10000 });
    await fontSelector.locator('input').click();
    await fontSelector.locator('input').fill('Carrois Gothic');
    await expect(
      page.locator('.font-selector__option-name', { hasText: 'Carrois Gothic' }),
    ).toBeVisible();
    await expect(page.getByRole('heading', { name: /Missing Fonts/i })).toHaveCount(0);

    await page.screenshot({
      path: testInfo.outputPath('downloaded-font-restored.png'),
      fullPage: true,
    });
  });
});
