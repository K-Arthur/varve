import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { openMenu } from '../helpers/menu-helpers';
import { dragOnCanvas, navigateToEditor } from '../shared';

const analysisPackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/style-audit.varveplugin',
);
const renamePackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/batch-rename.varveplugin',
);
const loopPackage = path.join(process.cwd(), 'tests/e2e/plugins/fixtures/fault-loop.varveplugin');
const secondLoopPackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/fault-loop-two.varveplugin',
);
const analysisUpdatePackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/style-audit-update.varveplugin',
);
const longNamePackage = path.join(
  process.cwd(),
  'tests/e2e/plugins/fixtures/style-audit-long-name.varveplugin',
);

async function openPluginManager(page: Page) {
  await openMenu(page, 'File');
  await page.getByRole('menuitem', { name: /Manage Plugins/ }).click();
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'Plugins' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return dialog;
}

async function installIntoDialog(
  dialog: Awaited<ReturnType<typeof openPluginManager>>,
  file: string,
  name: string,
) {
  await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(file);
  const review = dialog.getByRole('heading', { name: 'Review installation' });
  await expect(review).toBeVisible();
  const section = dialog.locator('.plugin-manager__review');
  await expect(section).toContainText(name);
  for (const checkbox of await section.getByRole('checkbox').all()) await checkbox.check();
  await section.getByRole('button', { name: 'Install and enable' }).click();
  const card = dialog.locator('.plugin-manager__card').filter({ hasText: name });
  await expect(card).toContainText('Ready');
  return { dialog, card };
}

async function installPackage(page: Page, file: string, name: string) {
  const dialog = await openPluginManager(page);
  return installIntoDialog(dialog, file, name);
}

async function openPluginManagerFromPalette(page: Page) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible({ timeout: 30000 });
  await palette.getByRole('combobox', { name: 'Search commands' }).fill('Manage Plugins');
  await expect(palette.getByRole('option', { name: /Manage Plugins/i })).toBeVisible();
  await page.keyboard.press('Enter');
  const dialog = page.getByRole('dialog', { name: 'Settings' });
  await expect(dialog.getByRole('tab', { name: 'Plugins' })).toHaveAttribute(
    'aria-selected',
    'true',
  );
  return dialog;
}

async function expectPluginPaletteAction(page: Page, present: boolean) {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await expect(palette).toBeVisible();
  await palette
    .getByRole('combobox', { name: 'Search commands' })
    .fill('Selection Style Readiness');
  const action = palette.getByRole('option', { name: /Selection Style Readiness/ });
  if (present) await expect(action).toBeVisible();
  else await expect(action).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(palette).toHaveCount(0);
}

/** Creates a committed text layer at canvas-relative coordinates. */
async function createTextAt(page: Page, x: number, y: number, text: string): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('editor canvas has no bounds');
  const editor = page.getByRole('textbox', { name: /editing text/i });
  for (let attempt = 0; attempt < 3; attempt++) {
    await page.keyboard.press('t');
    await page.mouse.click(box.x + x, box.y + y);
    const appeared = await editor
      .waitFor({ state: 'visible', timeout: 2500 })
      .then(() => true)
      .catch(() => false);
    if (appeared) {
      await page.keyboard.insertText(text);
      await page.keyboard.press('Escape');
      await editor.waitFor({ state: 'hidden', timeout: 5000 }).catch(() => {});
      await page.waitForTimeout(120);
      return;
    }
    await page.keyboard.press('Escape');
    await page.waitForTimeout(200);
  }
  throw new Error(`text editor did not appear at ${x},${y}`);
}

/** After reload the editor may restore the document or return to Home. */
async function reopenEditorAfterReload(page: Page): Promise<void> {
  if (
    !(await page
      .locator('.editor-shell')
      .isVisible({ timeout: 10000 })
      .catch(() => false))
  ) {
    await navigateToEditor(page);
    return;
  }
  const welcomeClose = page.getByRole('dialog').getByRole('button', { name: /close|get started/i });
  if (
    await welcomeClose
      .first()
      .isVisible({ timeout: 1000 })
      .catch(() => false)
  ) {
    await welcomeClose.first().click();
  }
}

test.describe('local application plugins', () => {
  test.describe.configure({ mode: 'serial' });

  test.beforeEach(async ({ page }) => {
    await navigateToEditor(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
  });

  test('opens the manager from the command palette and restores keyboard focus', async ({
    page,
  }, testInfo) => {
    const selectedLayer = page.getByRole('treeitem', { selected: true });
    await selectedLayer.focus();
    const dialog = await openPluginManagerFromPalette(page);
    await page.screenshot({
      path: testInfo.outputPath('plugin-manager-empty.png'),
      fullPage: true,
    });

    const pluginsTab = dialog.getByRole('tab', { name: 'Plugins' });
    await pluginsTab.focus();
    await page.keyboard.press('ArrowDown');
    await expect(dialog.getByRole('tab', { name: 'Collab' })).toHaveAttribute(
      'aria-selected',
      'true',
    );
    await page.keyboard.press('ArrowUp');
    await expect(pluginsTab).toHaveAttribute('aria-selected', 'true');

    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(selectedLayer).toBeFocused();
  });

  test('shows accessible package artwork and makes pinned plugins easy to find', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 800, height: 768 });
    const dialog = await openPluginManager(page);
    const analysis = await installIntoDialog(dialog, analysisPackage, 'Selection Style Readiness');
    const rename = await installIntoDialog(dialog, renamePackage, 'Number Selected Layers');

    await expect(
      analysis.card.getByRole('img', { name: 'Selected layer cards beside a style summary panel' }),
    ).toHaveAttribute('src', /^data:image\/png;base64,/u);
    await expect(analysis.card).toContainText(
      'Summarizes selected-layer styles, mixed values, and readiness issues before handoff.',
    );
    await expect(
      rename.card.getByRole('img', { name: 'Three unnamed layers transform into a numbered list' }),
    ).toHaveAttribute('src', /^data:image\/png;base64,/u);
    await expect(dialog.locator('.plugin-manager__card h3').allTextContents()).resolves.toEqual([
      'Number Selected Layers',
      'Selection Style Readiness',
    ]);
    const initialOverflow = await dialog
      .locator('.settings-dialog__content')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(initialOverflow).toBeLessThanOrEqual(1);

    await analysis.card.getByRole('button', { name: 'Pin Selection Style Readiness' }).click();
    await expect(
      analysis.card.getByRole('button', { name: 'Unpin Selection Style Readiness' }),
    ).toHaveAttribute('aria-pressed', 'true');
    await dialog.getByRole('button', { name: /^Pinned \(1\)$/ }).click();
    await expect(dialog.getByRole('article')).toHaveCount(1);
    await expect(dialog.getByRole('article', { name: 'Selection Style Readiness' })).toBeVisible();

    const search = dialog.getByRole('searchbox', { name: 'Search installed plugins' });
    await search.fill('mixed values');
    await expect(dialog.getByRole('article')).toHaveCount(1);
    await expect(dialog.getByRole('article', { name: 'Selection Style Readiness' })).toBeVisible();
    await search.fill('numbered layer names');
    await expect(dialog.getByRole('article')).toHaveCount(0);
    await expect(dialog.getByRole('status').filter({ hasText: 'Showing 0 of 2' })).toBeVisible();

    await search.fill('');
    await page.setViewportSize({ width: 1280, height: 1100 });
    await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
    await page.mouse.move(1180, 90);
    await dialog.locator('.plugin-manager__list-heading').scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-manager-pinned.png'),
      fullPage: true,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await analysis.card.scrollIntoViewIfNeeded();
    const largeTextOverflow = await dialog
      .locator('.settings-dialog__content')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(largeTextOverflow).toBeLessThanOrEqual(1);
    await page.screenshot({
      path: testInfo.outputPath('plugin-manager-pinned-200-percent.png'),
      fullPage: false,
    });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });

    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    const reopenedDialog = await openPluginManager(page);
    await reopenedDialog.getByRole('button', { name: /^Pinned \(1\)$/ }).click();
    await expect(
      reopenedDialog.getByRole('article', { name: 'Selection Style Readiness' }),
    ).toBeVisible();
    await expect(reopenedDialog.getByRole('article')).toHaveCount(1);
  });

  test('keeps long plugin names and access review readable across display modes', async ({
    page,
  }, testInfo) => {
    test.setTimeout(90000);
    await page.setViewportSize({ width: 800, height: 768 });
    const dialog = await openPluginManager(page);
    const longName =
      'Selection Style Readiness for reviewable local package workflows with a carefully expanded long display label';

    for (const theme of ['Light', 'Dark', 'High Contrast']) {
      await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
      await dialog.getByRole('combobox', { name: 'Theme' }).click();
      await page
        .getByRole('listbox', { name: 'Theme' })
        .getByRole('option', { name: theme })
        .click();
      await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
      await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(longNamePackage);
      const review = dialog.locator('.plugin-manager__review');
      await expect(review).toContainText(longName);
      const width = await dialog
        .locator('.settings-dialog__content')
        .evaluate((element) => element.scrollWidth - element.clientWidth);
      expect(width).toBeLessThanOrEqual(1);
      await page.screenshot({
        path: testInfo.outputPath(
          `plugin-review-${theme.toLowerCase().replaceAll(' ', '-')}-800.png`,
        ),
        fullPage: true,
      });
      await review.getByRole('button', { name: 'Cancel' }).click();
    }

    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(longNamePackage);
    const review = dialog.locator('.plugin-manager__review');
    const selectionAccess = review.getByRole('checkbox', {
      name: /Read the current selection/,
    });
    await selectionAccess.check();
    await expect(selectionAccess).toBeChecked();
    const installAndEnable = review.getByRole('button', { name: 'Install and enable' });
    await expect(installAndEnable).toBeEnabled();
    await installAndEnable.click();
    const longNameCard = dialog
      .locator('.plugin-manager__card')
      .filter({ hasText: 'dev.varve.test.long-name' });
    await expect(longNameCard).toContainText(longName);
    await page.screenshot({
      path: testInfo.outputPath('plugin-manager-long-name.png'),
      fullPage: true,
    });
    await longNameCard.getByRole('button', { name: 'Remove', exact: true }).click();
    await longNameCard.getByRole('button', { name: 'Remove plugin' }).click();

    await page.emulateMedia({ forcedColors: 'active', reducedMotion: 'reduce' });
    await page.evaluate(() => {
      document.documentElement.style.fontSize = '200%';
    });
    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(renamePackage);
    const stressReview = dialog.locator('.plugin-manager__review');
    await expect(stressReview).toContainText('Read the current selection');
    await expect(stressReview).toContainText('Change the open document');
    const stressWidth = await dialog
      .locator('.settings-dialog__content')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(stressWidth).toBeLessThanOrEqual(1);
    const stressPanelWidth = await dialog
      .getByRole('tabpanel', { name: 'Plugins' })
      .evaluate((element) => element.getBoundingClientRect().width);
    expect(stressPanelWidth).toBeGreaterThanOrEqual(260);
    const clippedNavigationLabel = await dialog
      .locator('.settings-dialog__tab')
      .evaluateAll((tabs) => tabs.some((tab) => tab.scrollHeight > tab.clientHeight + 1));
    expect(clippedNavigationLabel).toBe(false);
    await page.screenshot({
      path: testInfo.outputPath('plugin-review-forced-colors-reduced-motion-200-percent.png'),
      fullPage: true,
    });
    await stressReview.getByRole('button', { name: 'Cancel' }).click();
  });

  test('returns plugin actions and surfaces to baseline across 50 install/run/remove cycles', async ({
    page,
  }, testInfo) => {
    test.setTimeout(300000);
    await page.evaluate(() => {
      const workers = {
        created: 0,
        terminated: 0,
        active: 0,
        heapSamples: [] as number[],
      };
      Object.assign(window, { __pluginWorkerAudit: workers });
      const NativeWorker = window.Worker;
      window.Worker = new Proxy(NativeWorker, {
        construct(target, args, newTarget) {
          const worker = Reflect.construct(target, args, newTarget) as Worker;
          if (!String(args[0]).toLowerCase().includes('guestworker')) return worker;
          workers.created += 1;
          workers.active += 1;
          let terminated = false;
          const terminate = worker.terminate.bind(worker);
          worker.terminate = () => {
            if (!terminated) {
              terminated = true;
              workers.active -= 1;
              workers.terminated += 1;
            }
            terminate();
          };
          return worker;
        },
      });
    });

    let dialog = await openPluginManager(page);
    const unchangedArtwork = await page.getByRole('treeitem').allTextContents();
    const inspectorSurfaceBaseline = await page.locator('.insp-plugin-sections').count();
    const baseline = await page.evaluate(() => {
      const audit = (
        window as unknown as {
          __pluginWorkerAudit: { created: number; heapSamples: number[] };
        }
      ).__pluginWorkerAudit;
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize;
      if (typeof heap === 'number') audit.heapSamples.push(heap);
      return audit.created;
    });
    for (let cycle = 1; cycle <= 50; cycle += 1) {
      let card = (await installIntoDialog(dialog, analysisPackage, 'Selection Style Readiness'))
        .card;
      await card.getByRole('button', { name: 'Run', exact: true }).click();
      // Review validation, install revalidation, and execution each own a worker.
      const expectedCreated = baseline + cycle * 3;
      await expect
        .poll(() =>
          page.evaluate(
            () =>
              (window as unknown as { __pluginWorkerAudit: { created: number } })
                .__pluginWorkerAudit.created,
          ),
        )
        .toBe(expectedCreated);
      await expect
        .poll(() =>
          page.evaluate(() => {
            const audit = (
              window as unknown as {
                __pluginWorkerAudit: {
                  created: number;
                  active: number;
                  terminated: number;
                };
              }
            ).__pluginWorkerAudit;
            return audit.active === 0 && audit.terminated === audit.created;
          }),
        )
        .toBe(true);
      await expect(card.getByText(/Opacity:/)).toBeVisible();
      if (cycle % 10 === 0) {
        await page.evaluate(() => {
          const audit = (
            window as unknown as {
              __pluginWorkerAudit: { heapSamples: number[] };
            }
          ).__pluginWorkerAudit;
          const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
            ?.usedJSHeapSize;
          if (typeof heap === 'number') audit.heapSamples.push(heap);
        });
        await dialog.getByRole('button', { name: 'Close dialog' }).click();
        await expectPluginPaletteAction(page, true);
        dialog = await openPluginManager(page);
        card = dialog
          .locator('.plugin-manager__card')
          .filter({ hasText: 'Selection Style Readiness' });
      }
      await card.getByRole('button', { name: 'Remove', exact: true }).click();
      await card.getByRole('button', { name: 'Remove plugin' }).click();
      await expect(dialog.locator('.plugin-manager__card')).toHaveCount(0);
      await expect(page.locator('.insp-plugin-sections')).toHaveCount(inspectorSurfaceBaseline);
      if (inspectorSurfaceBaseline > 0) {
        await expect(page.locator('.insp-plugin-sections')).not.toContainText(
          'Selection readiness',
        );
      }
      if (cycle % 10 === 0) {
        await dialog.getByRole('button', { name: 'Close dialog' }).click();
        await expectPluginPaletteAction(page, false);
        if (cycle < 50) dialog = await openPluginManager(page);
      }
    }
    const metrics = await page.evaluate(() => {
      const audit = (
        window as unknown as {
          __pluginWorkerAudit: {
            created: number;
            terminated: number;
            active: number;
            heapSamples: number[];
          };
        }
      ).__pluginWorkerAudit;
      const heap = (performance as Performance & { memory?: { usedJSHeapSize: number } }).memory
        ?.usedJSHeapSize;
      if (typeof heap === 'number') audit.heapSamples.push(heap);
      return audit;
    });
    expect(metrics.created - baseline).toBe(150);
    expect(metrics.terminated).toBe(metrics.created);
    expect(metrics.active).toBe(0);
    const heapDeltaBytes =
      metrics.heapSamples.length >= 2
        ? metrics.heapSamples[metrics.heapSamples.length - 1]! - metrics.heapSamples[0]!
        : null;
    const report = { ...metrics, heapDeltaBytes };
    await expect(page.getByRole('treeitem').allTextContents()).resolves.toEqual(unchangedArtwork);
    await testInfo.attach('plugin-worker-soak.json', {
      body: JSON.stringify(report, null, 2),
      contentType: 'application/json',
    });
    console.info(`[plugin-worker-soak] ${JSON.stringify(report)}`);
  });

  test('reviews, runs, disables, and reopens a read-only analysis package', async ({
    page,
  }, testInfo) => {
    const { dialog, card } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    await page.screenshot({ path: testInfo.outputPath('plugin-installed.png'), fullPage: true });
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByText(/Opacity:/)).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    const inspectorContribution = page.locator('.insp-plugin-sections');
    await expect(inspectorContribution).toContainText('Selection readiness');
    await inspectorContribution.scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plugin-inspector.png'), fullPage: true });
    await openPluginManager(page);
    await card.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(card).toContainText('Disabled');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.screenshot({ path: testInfo.outputPath('plugin-disabled.png'), fullPage: true });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(page.getByRole('treeitem')).toHaveCount(1);
    await page.reload();
    if (
      !(await page
        .locator('.editor-shell')
        .isVisible({ timeout: 10000 })
        .catch(() => false))
    ) {
      const recentDocument = page.getByRole('gridcell').first();
      await recentDocument.waitFor({ state: 'visible', timeout: 45000 });
      await recentDocument.dblclick({ timeout: 15000 });
      await page.locator('.editor-shell').waitFor({ state: 'visible', timeout: 45000 });
    }
    const reopened = await openPluginManager(page);
    await expect(
      reopened.locator('.plugin-manager__card').filter({ hasText: 'Selection Style Readiness' }),
    ).toContainText('Disabled');
  });

  test('keeps plugin recovery available while safe mode suppresses contributions', async ({
    page,
  }, testInfo) => {
    const { card } = await installPackage(page, analysisPackage, 'Selection Style Readiness');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByText(/Opacity:/)).toBeVisible();
    await page.evaluate(() => {
      localStorage.setItem(
        'varve:safe-mode',
        JSON.stringify({ active: true, options: { disableExtensions: true } }),
      );
    });

    await page.reload();
    await expect(page.getByRole('heading', { name: 'Varve had trouble starting' })).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('plugin-safe-mode-startup.png'),
      fullPage: true,
    });
    await page.getByRole('button', { name: 'Start Varve in safe mode' }).click();
    await page.getByRole('button', { name: /^new$/i }).click();
    const createInSafeMode = page
      .locator('dialog[open]')
      .getByRole('button', { name: /^create(\s+design)?$/i })
      .first();
    await createInSafeMode.waitFor({ state: 'visible' });
    await createInSafeMode.click();
    await page.locator('.editor-shell').waitFor({ state: 'visible' });
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
    await expect(page.locator('.safe-mode-active-indicator')).toContainText(
      'Selected startup restrictions remain in place',
    );

    const dialog = await openPluginManager(page);
    const recoveredCard = dialog
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Selection Style Readiness' });
    await expect(recoveredCard).toContainText('Paused in safe mode');
    await expect(recoveredCard.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    const savedEnablement = recoveredCard.getByRole('button', {
      name: 'Disable',
      exact: true,
    });
    await expect(savedEnablement).toHaveAttribute('aria-disabled', 'true');
    await expect(savedEnablement).toHaveAttribute('title', /Exit safe mode/);
    const removeInSafeMode = recoveredCard.getByRole('button', {
      name: 'Remove',
      exact: true,
    });
    await expect(removeInSafeMode).toBeEnabled();
    await removeInSafeMode.focus();
    await removeInSafeMode.press('Enter');
    await expect(recoveredCard.getByRole('button', { name: 'Remove plugin' })).toBeEnabled();
    await recoveredCard.getByRole('button', { name: 'Keep plugin' }).click();
    await expect(recoveredCard).toContainText('Paused in safe mode');
    await page.screenshot({
      path: testInfo.outputPath('plugin-safe-mode-manager.png'),
      fullPage: true,
    });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.getByRole('button', { name: 'Exit safe mode' }).click();
    await expect(page.locator('.safe-mode-active-indicator')).toHaveCount(0);
    await expect(page.locator('.insp-plugin-sections')).toContainText('Selection readiness');
    const activeDialog = await openPluginManager(page);
    const activeCard = activeDialog
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Selection Style Readiness' });
    const activeRun = activeCard.getByRole('button', { name: 'Run', exact: true });
    await expect(activeRun).toBeEnabled();
    await activeRun.click();
    await expect(activeCard.getByText(/Opacity:/)).toBeVisible();
  });

  test('previews and applies an undoable rename, then removes its package', async ({
    page,
    browser,
    baseURL,
  }, testInfo) => {
    const { dialog, card } = await installPackage(page, renamePackage, 'Number Selected Layers');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Apply 1 rename' })).toBeVisible();
    await card.getByRole('button', { name: 'Apply 1 rename' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-rename-preview.png'),
      fullPage: true,
    });
    await card.getByRole('button', { name: 'Apply 1 rename' }).click();
    await expect(page.getByRole('treeitem').first()).toContainText('01 ·');
    await card.getByRole('button', { name: 'Remove', exact: true }).click();
    await card.getByRole('button', { name: 'Remove plugin' }).click();
    await expect(dialog.locator('.plugin-manager__card')).toHaveCount(0);
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.keyboard.press('Control+z');
    await expect(page.getByRole('treeitem').first()).toContainText('Rectangle');
    await page.keyboard.press('Control+Shift+z');
    await expect(page.getByRole('treeitem').first()).toContainText('01 ·');
    await page.screenshot({
      path: testInfo.outputPath('plugin-renamed-artwork.png'),
      fullPage: true,
    });

    // The browser fallback writes the portable document to the Home mirror.
    // Reopen it with no plugin installed: the canonical layer name must survive.
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });
    await page.keyboard.press('Control+s');
    await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30000 });
    await page.reload({ timeout: 120000 });
    const savedDocument = page.locator('[role="gridcell"]').first();
    await savedDocument.waitFor({ state: 'visible', timeout: 30000 });
    await savedDocument.dblclick();
    await page.locator('.layers-panel').waitFor({ timeout: 60000 });
    await expect(page.getByRole('treeitem').first()).toContainText('01 ·');
    const reopened = await openPluginManager(page);
    await expect(reopened.locator('.plugin-manager__card')).toHaveCount(0);
    await reopened.getByRole('button', { name: 'Close dialog' }).click();
    await page.evaluate(() => {
      Object.defineProperty(window, 'showSaveFilePicker', {
        configurable: true,
        value: undefined,
      });
    });

    // Save a portable .varve copy, then open it in a fresh browser profile.
    // The second profile has no plugin installation or local grants.
    const copyDownloadPromise = page.waitForEvent('download');
    await page.getByRole('menuitem', { name: 'File', exact: true }).click();
    await page.getByRole('menuitem', { name: /save a copy/i }).click();
    const copyDownload = await copyDownloadPromise;
    const copyPath = testInfo.outputPath(copyDownload.suggestedFilename());
    await copyDownload.saveAs(copyPath);
    await testInfo.attach('portable-document.varve', {
      path: copyPath,
      contentType: 'application/json',
    });

    const independentContext = await browser.newContext({ baseURL });
    try {
      const independentPage = await independentContext.newPage();
      await navigateToEditor(independentPage);
      await independentPage.locator('#file-open-input').setInputFiles(copyPath);
      await expect(independentPage.getByRole('treeitem').first()).toContainText('01 ·', {
        timeout: 30000,
      });
      const independentManager = await openPluginManager(independentPage);
      await expect(independentManager.locator('.plugin-manager__card')).toHaveCount(0);
    } finally {
      await independentContext.close();
    }
  });

  test('keeps the permission review readable in a narrow dark window', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1024, height: 960 });
    const dialog = await openPluginManager(page);
    await dialog.getByRole('tab', { name: 'Appearance', exact: true }).click();
    await dialog.getByRole('combobox', { name: 'Theme' }).click();
    await page
      .getByRole('listbox', { name: 'Theme' })
      .getByRole('option', { name: 'Dark' })
      .click();
    await dialog.getByRole('tab', { name: 'Plugins', exact: true }).click();
    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(renamePackage);
    const review = dialog.locator('.plugin-manager__review');
    await expect(review).toContainText('Read the current selection');
    await expect(review).toContainText('Change the open document');
    await review.getByRole('heading', { name: 'Review installation' }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-review-dark-1024.png'),
      fullPage: true,
    });
    const overflow = await dialog
      .locator('.settings-dialog__content')
      .evaluate((element) => element.scrollWidth - element.clientWidth);
    expect(overflow).toBeLessThanOrEqual(1);
    await review.getByRole('button', { name: 'Cancel' }).click();
    await expect(review).toHaveCount(0);
  });

  test('stops a noncooperative guest and quarantines a timed-out retry', async ({
    page,
  }, testInfo) => {
    test.setTimeout(120000);
    const { dialog, card } = await installPackage(page, loopPackage, 'Controlled Loop Fixture');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Stop', exact: true }).click();
    await expect(card).toContainText('Ready');
    await expect(dialog.getByText('Plugin command stopped.')).toBeVisible();
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card).toContainText('Running');
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.keyboard.press('r');
    await dragOnCanvas(page, 420, 150, 560, 290);
    await expect(page.getByRole('treeitem')).toHaveCount(2);
    const afterSelectionChange = await openPluginManager(page);
    const retryCard = afterSelectionChange
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Controlled Loop Fixture' });
    await expect(retryCard).toContainText('Failed', { timeout: 15000 });
    await expect(retryCard).toContainText('time limit');
    await expect(retryCard.getByRole('button', { name: 'Retry' })).toBeVisible();
    await retryCard.getByRole('button', { name: 'Retry' }).scrollIntoViewIfNeeded();
    await page.screenshot({ path: testInfo.outputPath('plugin-failed.png'), fullPage: true });
    await expect(page.getByRole('treeitem')).toHaveCount(2);
  });

  test('shows new access on update and restores the last working package', async ({
    page,
  }, testInfo) => {
    const { dialog, card } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(analysisUpdatePackage);
    const review = dialog.locator('.plugin-manager__review');
    await expect(review.getByRole('heading', { name: 'Review update' })).toBeVisible();
    await expect(review).toContainText('New access requested: Change the open document');
    await expect(
      review.getByRole('checkbox', { name: /Change the open document/ }),
    ).not.toBeChecked();
    await review.getByRole('button', { name: 'Update and enable' }).click();
    await expect(card).toContainText('v1.2.0');
    await expect(card.getByRole('button', { name: 'Restore v1.1.0' })).toBeVisible();
    await card.getByRole('button', { name: 'Restore v1.1.0' }).click();
    await expect(card).toContainText('v1.1.0');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toBeEnabled();
    await page.screenshot({
      path: testInfo.outputPath('plugin-rollback-restored.png'),
      fullPage: true,
    });
  });

  test('keeps the current plugin usable when its rollback archive is corrupted', async ({
    page,
  }, testInfo) => {
    const { card } = await installPackage(page, analysisPackage, 'Selection Style Readiness');
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByLabel('Choose a .varveplugin package').setInputFiles(analysisUpdatePackage);
    await dialog
      .locator('.plugin-manager__review')
      .getByRole('button', { name: 'Update and enable' })
      .click();
    await expect(card).toContainText('v1.2.0');
    const pluginId = await card.locator('.plugin-manager__id').innerText();

    await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('varve-application-plugins-v1', 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction('packages', 'readwrite');
        const store = transaction.objectStore('packages');
        const request = store.get(id);
        request.onsuccess = () => {
          const record = request.result;
          if (!record?.previous?.archive) {
            transaction.abort();
            reject(new Error('test setup did not find the rollback archive'));
            return;
          }
          const archive = new Uint8Array(record.previous.archive);
          archive[0] = archive[0]! ^ 0xff;
          record.previous.archive = archive;
          store.put(record);
        };
        transaction.oncomplete = () => resolve();
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () =>
          reject(transaction.error ?? new Error('test transaction aborted'));
      });
      db.close();
    }, pluginId);

    await page.reload();
    await reopenEditorAfterReload(page);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 350, 300);
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(1);
    const reopenedDialog = await openPluginManager(page);
    const reopenedCard = reopenedDialog
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Selection Style Readiness' });
    await expect(reopenedCard).toContainText('v1.2.0');
    await reopenedCard.getByRole('button', { name: 'Restore v1.1.0' }).click();
    await expect(reopenedDialog.getByRole('alert')).toContainText(/invalid plugin package/i);
    await expect(reopenedCard).toContainText('v1.2.0');
    await reopenedCard.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(reopenedCard.getByText(/Opacity:/)).toBeVisible();
    await page.screenshot({
      path: testInfo.outputPath('plugin-corrupt-rollback-retained.png'),
      fullPage: true,
    });
  });

  test('revokes selection access while a guest is running', async ({ page }) => {
    const { card } = await installPackage(page, loopPackage, 'Controlled Loop Fixture');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await card.getByRole('button', { name: 'Access', exact: true }).click();
    const access = card.getByRole('region', { name: /Access for Controlled Loop Fixture/ });
    await access.getByRole('checkbox', { name: /Read the current selection/ }).uncheck();
    await access.getByRole('button', { name: 'Save access' }).click();
    await expect(card).toContainText('Needs permission');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await page.waitForTimeout(5500);
    await expect(card).not.toContainText('Failed');
  });

  test('reconciles revocation, uninstall, and reinstall across two windows', async ({
    page,
    context,
  }) => {
    test.setTimeout(120000);
    const { card } = await installPackage(page, loopPackage, 'Controlled Loop Fixture');
    const unchangedArtwork = await page.getByRole('treeitem').allTextContents();

    const secondWindow = await context.newPage();
    await navigateToEditor(secondWindow);
    await secondWindow.keyboard.press('r');
    await dragOnCanvas(secondWindow, 140, 140, 320, 270);
    const secondDialog = await openPluginManager(secondWindow);
    const secondCard = secondDialog
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Controlled Loop Fixture' });
    await expect(secondCard).toContainText('Ready');

    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await secondCard.getByRole('button', { name: 'Access', exact: true }).click();
    const access = secondCard.getByRole('region', {
      name: /Access for Controlled Loop Fixture/,
    });
    await access.getByRole('checkbox', { name: /Read the current selection/ }).uncheck();
    await access.getByRole('button', { name: 'Save access' }).click();
    await expect(card).toContainText('Needs permission');
    await expect(card.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
    await expect(page.getByRole('treeitem').allTextContents()).resolves.toEqual(unchangedArtwork);
    await page.waitForTimeout(5500);
    await expect(card).not.toContainText('Failed');

    await secondCard.getByRole('button', { name: 'Remove', exact: true }).click();
    await secondCard.getByRole('button', { name: 'Remove plugin' }).click();
    await expect(secondDialog.locator('.plugin-manager__card')).toHaveCount(0);
    await expect(page.locator('.plugin-manager__card')).toHaveCount(0);

    await installIntoDialog(secondDialog, loopPackage, 'Controlled Loop Fixture');
    await expect(page.locator('.plugin-manager__card')).toContainText('Ready');
    await expect(secondDialog.locator('.plugin-manager__card')).toContainText('Ready');
    await expect(
      page.locator('.plugin-manager__card').getByRole('button', { name: 'Run' }),
    ).toBeEnabled();
    await secondWindow.close();
  });

  test('rejects Apply when authoritative grants changed after preview', async ({ page }) => {
    const { dialog, card } = await installPackage(page, renamePackage, 'Number Selected Layers');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Preview' })).toBeVisible();
    const before = await page.getByRole('treeitem').allTextContents();
    const pluginId = await card.locator('.plugin-manager__id').innerText();

    // Simulate a simultaneous window whose change notice has not arrived yet.
    // The Apply guard must consult the durable revision before touching history.
    await page.evaluate(async (id) => {
      const db = await new Promise<IDBDatabase>((resolve, reject) => {
        const request = indexedDB.open('varve-application-plugins-v1', 2);
        request.onsuccess = () => resolve(request.result);
        request.onerror = () => reject(request.error);
      });
      await new Promise<void>((resolve, reject) => {
        const transaction = db.transaction(['packages', 'revisions'], 'readwrite');
        const packages = transaction.objectStore('packages');
        const revisions = transaction.objectStore('revisions');
        const currentRequest = packages.get(id);
        const revisionRequest = revisions.get(id);
        let current: Record<string, unknown> | undefined;
        let revision: { id: string; revision: number } | undefined;
        const writeWhenReady = () => {
          if (!current || !revision) return;
          current.grants = ['selection.read'];
          packages.put(current);
          revisions.put({ id, revision: revision.revision + 1 });
        };
        currentRequest.onsuccess = () => {
          current = currentRequest.result as Record<string, unknown> | undefined;
          writeWhenReady();
        };
        revisionRequest.onsuccess = () => {
          revision = revisionRequest.result as { id: string; revision: number } | undefined;
          writeWhenReady();
        };
        transaction.oncomplete = () => {
          db.close();
          resolve();
        };
        transaction.onerror = () => reject(transaction.error);
        transaction.onabort = () => reject(transaction.error);
      });
    }, pluginId);

    await card.getByRole('button', { name: 'Apply 1 rename' }).click();
    await expect(dialog.getByRole('alert')).toContainText('Plugin state changed in another window');
    await expect(page.getByRole('treeitem').allTextContents()).resolves.toEqual(before);
    await expect(card).toContainText('Preview');
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
  });

  test('analyzes a mixed vector, ellipse, and text selection', async ({ page }, testInfo) => {
    test.setTimeout(120000);
    // beforeEach left one selected rectangle; add two more node kinds.
    await page.keyboard.press('o');
    await dragOnCanvas(page, 380, 150, 560, 320);
    await createTextAt(page, 80, 430, 'Mixed label');
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(3);
    await rows.nth(0).click();
    await rows.nth(1).click({ modifiers: ['Control'] });
    await rows.nth(2).click({ modifiers: ['Control'] });
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(3);

    const { card } = await installPackage(page, analysisPackage, 'Selection Style Readiness');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByText(/Selection style audit: 3 layers/)).toBeVisible({
      timeout: 20000,
    });
    // Vector shapes share the 'shape' kind in the guest snapshot; the mixed
    // selection itself is proven by the layers tree and the font lines.
    await expect(card.getByText(/Selected objects by kind: shape 2, text 1/)).toBeVisible();
    await expect(rows.filter({ hasText: 'Ellipse' })).toHaveCount(1);
    await expect(card.getByText('Font family: no text layers selected.')).toHaveCount(0);
    await expect(card.getByText(/Font family:/).first()).toBeVisible();
    await expect(card.getByText(/Locked layers: 0/)).toBeVisible();
    // The same analysis reaches the host-rendered Inspector contribution.
    await card.getByRole('button', { name: 'Run', exact: true }).scrollIntoViewIfNeeded();
    await page.screenshot({
      path: testInfo.outputPath('plugin-mixed-analysis.png'),
      fullPage: true,
    });
    const dialog = page.getByRole('dialog', { name: 'Settings' });
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    const inspectorContribution = page.locator('.insp-plugin-sections');
    await expect(inspectorContribution).toContainText('Selection readiness');
    await expect(inspectorContribution).toContainText('Selection style audit: 3 layers');
    await expect(page.getByRole('treeitem')).toHaveCount(3);
  });

  test('hides a contributed panel, keeps the preference across reload, and shows it again', async ({
    page,
  }) => {
    test.setTimeout(120000);
    const { dialog, card } = await installPackage(
      page,
      analysisPackage,
      'Selection Style Readiness',
    );
    const inspectorContribution = page.locator('.insp-plugin-sections');
    await expect(inspectorContribution).toContainText('Selection readiness');

    await card.getByRole('button', { name: 'Hide Selection readiness Inspector panel' }).click();
    await expect(
      card.getByRole('button', { name: 'Show Selection readiness Inspector panel' }),
    ).toBeVisible();
    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await expect(inspectorContribution).toHaveCount(0);

    await page.reload({ timeout: 120000 });
    await reopenEditorAfterReload(page);
    const reopened = await openPluginManager(page);
    const reopenedCard = reopened
      .locator('.plugin-manager__card')
      .filter({ hasText: 'Selection Style Readiness' });
    await expect(
      reopenedCard.getByRole('button', { name: 'Show Selection readiness Inspector panel' }),
    ).toBeVisible();
    await reopenedCard
      .getByRole('button', { name: 'Show Selection readiness Inspector panel' })
      .click();
    await expect(
      reopenedCard.getByRole('button', { name: 'Hide Selection readiness Inspector panel' }),
    ).toBeVisible();
    await reopened.getByRole('button', { name: 'Close dialog' }).click();

    // With a selection present again, the shown panel renders its section.
    await page.keyboard.press('r');
    await dragOnCanvas(page, 150, 150, 320, 280);
    await page.keyboard.press('Control+a');
    await expect(inspectorContribution).toContainText('Selection readiness');
  });

  test('stops, revokes, and disables two competing plugins independently', async ({ page }) => {
    test.setTimeout(120000);
    const { dialog } = await installPackage(page, loopPackage, 'Controlled Loop Fixture');
    const firstCard = dialog.getByRole('article', { name: 'Controlled Loop Fixture', exact: true });
    await installIntoDialog(dialog, secondLoopPackage, 'Controlled Loop Fixture Two');
    const secondCard = dialog.getByRole('article', {
      name: 'Controlled Loop Fixture Two',
      exact: true,
    });
    const unchangedArtwork = await page.getByRole('treeitem').allTextContents();

    await firstCard.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(firstCard.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await secondCard.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(secondCard.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await expect(firstCard).toContainText('Running');
    await expect(secondCard).toContainText('Running');

    // Package actions stay available while guests occupy both execution slots.
    await firstCard.getByRole('button', { name: 'Access', exact: true }).click();
    const access = firstCard.getByRole('region', { name: /Access for Controlled Loop Fixture/ });
    await access.getByRole('checkbox', { name: /Read the current selection/ }).uncheck();
    await access.getByRole('button', { name: 'Save access' }).click();
    await expect(firstCard).toContainText('Needs permission');
    await expect(secondCard.getByRole('button', { name: 'Stop', exact: true })).toBeVisible();
    await secondCard.getByRole('button', { name: 'Disable', exact: true }).click();
    await expect(secondCard).toContainText('Disabled');
    await expect(page.getByRole('treeitem').allTextContents()).resolves.toEqual(unchangedArtwork);

    await page.waitForTimeout(5500);
    await expect(firstCard).not.toContainText('Failed');
    await expect(secondCard).not.toContainText('Failed');
    await expect(secondCard.getByRole('button', { name: 'Run', exact: true })).toHaveAttribute(
      'aria-disabled',
      'true',
    );
  });

  test('renames only unlocked layers and keeps undo/redo coherent', async ({ page }) => {
    test.setTimeout(120000);
    await page.keyboard.press('r');
    await dragOnCanvas(page, 420, 160, 560, 300);
    const rows = page.getByRole('treeitem');
    await expect(rows).toHaveCount(2);

    // The freshly drawn layer is selected; lock the other one so exactly one
    // of the two selected layers is off-limits to the rename plugin.
    let lockIndex = -1;
    for (let index = 0; index < 2; index++) {
      if ((await rows.nth(index).getAttribute('aria-selected')) !== 'true') {
        lockIndex = index;
        break;
      }
    }
    expect(lockIndex).toBeGreaterThanOrEqual(0);
    const unlockedIndex = lockIndex === 0 ? 1 : 0;
    await rows.nth(lockIndex).click({ button: 'right' });
    await page.getByRole('menuitem', { name: 'Lock', exact: true }).click();
    await rows.nth(unlockedIndex).click();
    await rows.nth(lockIndex).click({ modifiers: ['Control'] });
    await expect(page.getByRole('treeitem', { selected: true })).toHaveCount(2);

    const { dialog, card } = await installPackage(page, renamePackage, 'Number Selected Layers');
    await card.getByRole('button', { name: 'Run', exact: true }).click();
    await expect(card.getByRole('heading', { name: 'Preview' })).toBeVisible();
    await expect(card.getByRole('button', { name: 'Apply 1 rename' })).toBeVisible();
    await card.getByRole('button', { name: 'Apply 1 rename' }).click();
    await expect(rows.filter({ hasText: /01 ·/ })).toHaveCount(1);
    await expect(rows.nth(lockIndex)).not.toContainText('·');
    await expect(rows.nth(unlockedIndex)).toContainText('01 ·');

    await dialog.getByRole('button', { name: 'Close dialog' }).click();
    await page.keyboard.press('Control+z');
    await expect(rows.filter({ hasText: /01 ·/ })).toHaveCount(0);
    await page.keyboard.press('Control+Shift+z');
    await expect(rows.filter({ hasText: /01 ·/ })).toHaveCount(1);
    await expect(rows.nth(lockIndex)).not.toContainText('·');
  });
});
