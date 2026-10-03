import { writeFile } from 'node:fs/promises';
import { resolve } from 'node:path';
import { expect, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

declare global {
  interface Window {
    __varvePresentationSaves?: Array<{ name: string; bytes: number[] }>;
  }
}

async function chooseCustomSelectOption(
  page: import('@playwright/test').Page,
  label: string,
  option: string | RegExp,
) {
  await page.getByRole('combobox', { name: label }).click();
  await page.getByRole('listbox', { name: label }).getByRole('option', { name: option }).click();
}

test.describe('presentation authoring foundation', () => {
  test('creates a 16:9 deck and opens the Slides navigator in Design mode', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.removeItem('varve:crash-loop');
    });
    await page.addInitScript(() => {
      window.__varvePresentationSaves = [];
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async ({ suggestedName }: { suggestedName?: string }) => ({
          name: suggestedName ?? 'presentation.bin',
          createWritable: async () => ({
            write: async (data: Uint8Array) => {
              window.__varvePresentationSaves?.push({
                name: suggestedName ?? 'presentation.bin',
                bytes: Array.from(data),
              });
            },
            close: async () => {},
          }),
        }),
      });
    });
    await page.goto('/');
    await page.waitForSelector('.varve-home', { timeout: 45000 });

    await page.getByRole('button', { name: /^new$/i }).click({ force: true });
    const dialog = page.getByRole('dialog', { name: 'New design' });
    await expect(dialog).toBeVisible();
    await dialog.locator('label.varve-radio').filter({ hasText: 'New presentation' }).click();
    const presentationDialog = page.getByRole('dialog', { name: 'New presentation' });
    await expect(presentationDialog.locator('.varve-dialog__title')).toHaveText('New presentation');
    await expect(presentationDialog.getByRole('radio', { name: '16:9' })).toBeChecked();
    await presentationDialog.getByRole('button', { name: 'Create presentation' }).click();

    await page.locator('.layers-panel').waitFor({ timeout: 30000 });
    await expect(page.getByRole('tab', { name: 'Slides' })).toBeVisible();
    await page.getByRole('tab', { name: 'Slides' }).click();
    await expect(page.getByRole('list', { name: 'Slides in presentation order' })).toContainText(
      'Slide 1',
    );
    await expect(page.getByRole('button', { name: 'Add selected frames' })).toBeDisabled();
    await expect(page.locator('.presentation-navigator__thumbnail img')).toBeVisible({
      timeout: 30000,
    });
    await page.screenshot({
      path: testInfo.outputPath('presentation-navigator-light.png'),
      animations: 'disabled',
    });

    await page.locator('.presentation-layouts > summary').click();
    await chooseCustomSelectOption(page, 'Built-in layout', /Title \/ section/);
    await page.getByRole('button', { name: 'Add editable layout source' }).click();
    const layoutSource = page.getByRole('combobox', { name: 'Layout source' });
    await expect(layoutSource).toContainText('Title / section');
    await expect(page.locator('.presentation-layouts__status')).toContainText('Revision 1');

    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    await expect(audience.locator('.presentation-audience__image')).toBeVisible({ timeout: 30000 });
    const stageBounds = await audience.evaluate((element) => {
      const bounds = element.getBoundingClientRect();
      return { x: bounds.x, y: bounds.y, width: bounds.width, height: bounds.height };
    });
    const viewport = page.viewportSize();
    expect(stageBounds).toEqual({ x: 0, y: 0, width: viewport?.width, height: viewport?.height });
    await expect(audience.getByRole('button', { name: 'Exit' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('presentation-audience-preview.png'),
      animations: 'disabled',
    });
    await audience.getByRole('button', { name: 'Exit' }).click();
    await expect(audience).toBeHidden();

    await page.getByRole('button', { name: 'Export deck…' }).click();
    const exportDialog = page.getByRole('dialog', { name: /Export/ });
    await expect(exportDialog).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('presentation-export-dialog.png'),
      animations: 'disabled',
    });
    await exportDialog.getByRole('button', { name: 'Export PDF' }).click();
    await expect(exportDialog.getByText('File saved')).toBeVisible({ timeout: 30000 });
    const pdf = await page.evaluate(() => window.__varvePresentationSaves?.at(-1));
    expect(pdf?.name).toMatch(/\.pdf$/i);
    await writeFile(
      testInfo.outputPath('presentation-export.pdf'),
      new Uint8Array(pdf?.bytes ?? []),
    );

    await exportDialog.getByRole('button', { name: 'Export PNG sequence' }).click();
    await expect(exportDialog.getByText('File saved')).toBeVisible({ timeout: 30000 });
    const png = await page.evaluate(() => window.__varvePresentationSaves?.at(-1));
    expect(png?.name).toMatch(/\.zip$/i);
    await writeFile(
      testInfo.outputPath('presentation-export.zip'),
      new Uint8Array(png?.bytes ?? []),
    );
  });

  test('persists explicit order, sections, private notes, and skip state across save and reopen', async ({
    page,
  }, testInfo) => {
    const orphanWarnings: string[] = [];
    page.on('console', (message) => {
      if (message.text().includes('Orphan node:')) orphanWarnings.push(message.text());
    });
    await page.addInitScript(() => {
      localStorage.removeItem('varve:crash-loop');
    });
    await page.goto('/');
    await page.waitForSelector('.varve-home', { timeout: 45000 });
    await page.getByRole('button', { name: /^new$/i }).click({ force: true });
    const creation = page.getByRole('dialog', { name: 'New design' });
    await creation.locator('label.varve-radio').filter({ hasText: 'New presentation' }).click();
    await page.getByRole('button', { name: 'Create presentation' }).click();
    await page.locator('.layers-panel').waitFor({ timeout: 30000 });
    await page.getByRole('tab', { name: 'Slides' }).click();

    const slideList = page.getByRole('list', { name: 'Slides in presentation order' });
    for (let index = 1; index < 12; index += 1) {
      await slideList
        .locator(':scope > li')
        .first()
        .getByRole('button', { name: 'Duplicate', exact: true })
        .click();
    }
    await expect(slideList.locator(':scope > li')).toHaveCount(12);

    await page.locator('.presentation-navigator__sections > summary').click();
    await page.getByPlaceholder('Section name').fill('Client pitch');
    await page.getByRole('button', { name: 'Add section' }).click();
    await slideList
      .locator(':scope > li')
      .first()
      .getByRole('combobox', { name: 'Section for Slide 1' })
      .click();
    await page
      .getByRole('listbox', { name: 'Section for Slide 1' })
      .getByRole('option', { name: 'Client pitch' })
      .click();
    await page
      .getByLabel('Speaker notes (private)')
      .first()
      .fill('Client-only agenda: pricing review and launch date.');
    await page.getByRole('button', { name: 'Skip' }).last().click();

    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.screenshot({
      path: testInfo.outputPath('presentation-twelve-slide-navigator.png'),
      animations: 'disabled',
    });
    await page.reload({ timeout: 120000 });
    await page.waitForSelector('.varve-home', { timeout: 45000 });
    await page.locator('[role="gridcell"]').first().dblclick();
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    expect(orphanWarnings).toEqual([]);
    await page.getByRole('tab', { name: 'Slides' }).click();

    const reopenedList = page.getByRole('list', { name: 'Slides in presentation order' });
    await expect(reopenedList.locator(':scope > li')).toHaveCount(12);
    await expect(
      reopenedList
        .locator(':scope > li')
        .first()
        .getByRole('combobox', { name: 'Section for Slide 1' }),
    ).toContainText('Client pitch');
    await expect(page.getByLabel('Speaker notes (private)').first()).toHaveValue(
      'Client-only agenda: pricing review and launch date.',
    );
    await expect(reopenedList.locator(':scope > li').last()).toContainText('Skipped');
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience).toBeVisible();
    await expect(audience).not.toContainText('Client-only agenda');
  });

  test('exports the populated three-slide presentation fixture to a multipage PDF and ordered PNG archive', async ({
    page,
  }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.removeItem('varve:crash-loop');
      window.__varvePresentationSaves = [];
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: async ({ suggestedName }: { suggestedName?: string }) => ({
          name: suggestedName ?? 'presentation.bin',
          createWritable: async () => ({
            write: async (data: Uint8Array) => {
              window.__varvePresentationSaves?.push({
                name: suggestedName ?? 'presentation.bin',
                bytes: Array.from(data),
              });
            },
            close: async () => {},
          }),
        }),
      });
    });
    await navigateToEditor(page);
    await page.setInputFiles(
      '#file-open-input',
      resolve(process.cwd(), 'scripts/screenshots/fixtures/presentation.varve'),
    );
    await expect(page.locator('.editor-shell h1.sr-only')).toContainText('presentation.varve', {
      timeout: 30000,
    });
    await page.getByRole('tab', { name: 'Slides' }).click();
    const slideList = page.getByRole('list', { name: 'Slides in presentation order' });
    await expect(slideList.locator(':scope > li')).toHaveCount(3);
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience.locator('.presentation-audience__image')).toBeVisible({ timeout: 30000 });
    await page.screenshot({
      path: testInfo.outputPath('presentation-populated-audience-preview.png'),
      animations: 'disabled',
    });
    await audience.getByRole('button', { name: 'Exit' }).click();

    await page.getByRole('button', { name: 'Export deck…' }).click();
    const exportDialog = page.getByRole('dialog', { name: /Export/ });
    await exportDialog.getByRole('button', { name: 'Export PDF' }).click();
    await expect(exportDialog.getByText('File saved')).toBeVisible({ timeout: 30000 });
    const pdf = await page.evaluate(() => window.__varvePresentationSaves?.at(-1));
    expect(pdf?.name).toMatch(/\.pdf$/i);
    expect(pdf?.bytes.length ?? 0).toBeGreaterThan(1000);
    await writeFile(
      testInfo.outputPath('presentation-populated-export.pdf'),
      new Uint8Array(pdf?.bytes ?? []),
    );

    await exportDialog.getByRole('button', { name: 'Export PNG sequence' }).click();
    await expect(exportDialog.getByText('File saved')).toBeVisible({ timeout: 30000 });
    const pngSequence = await page.evaluate(() => window.__varvePresentationSaves?.at(-1));
    expect(pngSequence?.name).toMatch(/\.zip$/i);
    expect(pngSequence?.bytes.length ?? 0).toBeGreaterThan(1000);
    await writeFile(
      testInfo.outputPath('presentation-populated-export.zip'),
      new Uint8Array(pngSequence?.bytes ?? []),
    );
  });

  test('opens and navigates a populated 100-slide stress deck', async ({ page }, testInfo) => {
    await page.addInitScript(() => localStorage.removeItem('varve:crash-loop'));
    await navigateToEditor(page);
    await page.setInputFiles(
      '#file-open-input',
      resolve(process.cwd(), 'scripts/screenshots/fixtures/presentation.varve'),
    );
    await page.getByRole('tab', { name: 'Slides' }).click();
    const slides = page.getByRole('list', { name: 'Slides in presentation order' });
    await expect(slides.locator(':scope > li')).toHaveCount(3);

    const startedAt = Date.now();
    for (let slideNumber = 4; slideNumber <= 100; slideNumber += 1) {
      await slides
        .locator(':scope > li')
        .first()
        .getByRole('button', { name: 'Duplicate', exact: true })
        .click();
    }
    const authoringMs = Date.now() - startedAt;
    await expect(slides.locator(':scope > li')).toHaveCount(100, { timeout: 30000 });
    const lastSlide = slides.locator(':scope > li').last();
    const navigationStartedAt = Date.now();
    await lastSlide.getByRole('button', { name: /Select slide 100:/ }).click();
    await page.getByRole('button', { name: 'Present', exact: true }).click();
    const audience = page.getByRole('dialog', { name: /audience preview/ });
    await expect(audience.locator('.presentation-audience__image')).toBeVisible({ timeout: 30000 });
    const navigationMs = Date.now() - navigationStartedAt;
    const captureState = await page.evaluate(() => ({
      loadedSlideImages: Array.from(
        document.querySelectorAll<HTMLImageElement>('.presentation-navigator__thumbnail img'),
      ).filter((image) => image.complete && image.naturalWidth > 0).length,
      usedHeapBytes:
        (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
          ?.usedJSHeapSize ?? null,
    }));
    await page.screenshot({
      path: testInfo.outputPath('presentation-100-slide-audience-preview.png'),
      animations: 'disabled',
    });
    console.info(
      `[presentation-stress] slides=100 authoringMs=${authoringMs} lastSlideNavigationMs=${navigationMs} loadedThumbnails=${captureState.loadedSlideImages} usedHeapBytes=${captureState.usedHeapBytes ?? 'unavailable'}`,
    );
    await expect(audience).not.toContainText('Internal note:');
    await audience.getByRole('button', { name: 'Exit' }).click();
    await expect(audience).toBeHidden();
  });
});

test.describe('presentation touch and high-contrast review', () => {
  test.use({ viewport: { width: 1200, height: 750 }, hasTouch: true });

  test('reorders slides by tap in the high-contrast tablet layout', async ({ page }, testInfo) => {
    await page.addInitScript(() => {
      localStorage.removeItem('varve:crash-loop');
      localStorage.setItem('varve-theme', 'high-contrast');
    });
    await page.goto('/');
    await page.waitForSelector('.varve-home', { timeout: 45000 });
    await page.getByRole('button', { name: /^new$/i }).tap();
    const creation = page.getByRole('dialog', { name: 'New design' });
    await creation.locator('label.varve-radio').filter({ hasText: 'New presentation' }).tap();
    await page.getByRole('button', { name: 'Create presentation' }).tap();
    await page.locator('.layers-panel').waitFor({ timeout: 30000 });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'high-contrast');
    await page.getByRole('tab', { name: 'Slides' }).tap();
    const navigatorRows = await page.evaluate(() => {
      const bounds = (selector: string) =>
        document.querySelector(selector)?.getBoundingClientRect().toJSON() ?? null;
      return {
        header: bounds('.presentation-navigator__header'),
        deckTitle: bounds('.presentation-navigator__deck-title'),
        toolbar: bounds('.presentation-navigator__toolbar'),
      };
    });
    expect(navigatorRows.header).not.toBeNull();
    expect(navigatorRows.deckTitle).not.toBeNull();
    expect(navigatorRows.toolbar).not.toBeNull();
    expect(navigatorRows.deckTitle!.top).toBeGreaterThanOrEqual(navigatorRows.header!.bottom - 1);
    expect(navigatorRows.toolbar!.top).toBeGreaterThanOrEqual(navigatorRows.deckTitle!.bottom - 1);
    const slides = page.getByRole('list', { name: 'Slides in presentation order' });
    const firstSlide = slides.locator(':scope > li').first();
    const title = firstSlide.getByLabel('Slide title');
    await title.fill('One');
    await title.press('Enter');
    await firstSlide.getByRole('button', { name: 'Duplicate', exact: true }).tap();
    await slides
      .locator(':scope > li')
      .first()
      .getByRole('button', { name: 'Move One later' })
      .tap();
    await expect(
      slides
        .locator(':scope > li')
        .first()
        .getByRole('button', { name: 'Select slide 1: One copy' }),
    ).toBeVisible();
    await expect(
      slides.locator(':scope > li').nth(1).getByRole('button', { name: 'Select slide 2: One' }),
    ).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('presentation-tablet-high-contrast-touch-order.png'),
      animations: 'disabled',
    });
  });
});
