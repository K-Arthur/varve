import { readFile, writeFile } from 'node:fs/promises';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

test.use({ viewport: { width: 1440, height: 900 } });
test.setTimeout(420_000);

declare global {
  interface Window {
    __varvePerf?: {
      fixtures: {
        apply: (id: string) => Promise<{ ok: boolean }>;
      };
      forceFullRedraw: () => void;
    };
  }
}

async function openRetouchFixture(page: Page): Promise<void> {
  await navigateToEditor(page, '/?perf=1', { startupTimeout: 300_000 });
  const applied = await page.evaluate(() => window.__varvePerf?.fixtures.apply('retouch-raster'));
  expect(applied?.ok).toBe(true);
  await expect(
    page
      .locator('.layers-panel')
      .getByText(/raster layer/i)
      .first(),
  ).toBeVisible({
    timeout: 20_000,
  });
}

async function runPaletteAction(page: Page, query: string, optionName: RegExp): Promise<void> {
  await page.keyboard.press('Control+/');
  const palette = page.getByRole('dialog', { name: 'Command palette' });
  await palette.waitFor({ timeout: 30_000 });
  const search = palette.getByRole('combobox', { name: 'Search commands' });
  await search.fill(query);
  await palette.getByRole('option', { name: optionName }).first().click({ timeout: 15_000 });
  await expect(palette).toBeHidden({ timeout: 10_000 });
}

async function serializedDocument(page: Page): Promise<string> {
  return page.evaluate(() => {
    type EditorApi = { serializeDocument: () => string };
    function find(value: unknown): EditorApi | null {
      if (typeof value !== 'object' || value === null) return null;
      const record = value as Record<string, unknown>;
      const props = record.memoizedProps;
      if (typeof props === 'object' && props !== null) {
        const candidate = (props as Record<string, unknown>).value;
        if (
          typeof candidate === 'object' &&
          candidate !== null &&
          typeof (candidate as Record<string, unknown>).serializeDocument === 'function'
        ) {
          return candidate as EditorApi;
        }
      }
      return find(record.child) ?? find(record.sibling);
    }

    const root = document.getElementById('root');
    if (!root) throw new Error('editor root is missing');
    const key = Object.keys(root).find(
      (candidate) =>
        candidate.startsWith('__reactContainer$') || candidate.startsWith('__reactFiber$'),
    );
    if (!key) throw new Error('editor React fiber is missing');
    const editor = find((root as unknown as Record<string, unknown>)[key]);
    if (!editor) throw new Error('editor context is missing');
    return editor.serializeDocument();
  });
}

async function canvasHash(page: Page): Promise<string> {
  return page.locator('canvas.editor-canvas__content-layer').evaluate((element) => {
    const canvas = element as HTMLCanvasElement;
    const context = canvas.getContext('2d');
    if (!context) throw new Error('content canvas has no 2D context');
    const data = context.getImageData(0, 0, canvas.width, canvas.height).data;
    let hash = 2166136261;
    for (const value of data) {
      hash ^= value;
      hash = Math.imul(hash, 16777619);
    }
    return `${data.length}:${hash >>> 0}`;
  });
}

function retouchState(serialized: string): string {
  const parsed = JSON.parse(serialized) as { nodes?: unknown };
  if (typeof parsed.nodes !== 'object' || parsed.nodes === null || Array.isArray(parsed.nodes)) {
    return 'no-nodes';
  }
  const entries = Object.entries(parsed.nodes as Record<string, unknown>)
    .filter(([, node]) => {
      if (typeof node !== 'object' || node === null || Array.isArray(node)) return false;
      const record = node as Record<string, unknown>;
      return 'frequencySeparation' in record || 'liquify' in record;
    })
    .sort(([left], [right]) => left.localeCompare(right));
  return JSON.stringify(entries);
}

function textHash(value: string): string {
  let hash = 2166136261;
  for (let index = 0; index < value.length; index += 1) {
    hash ^= value.charCodeAt(index);
    hash = Math.imul(hash, 16777619);
  }
  return `${value.length}:${hash >>> 0}`;
}

async function assertFullRedrawIsStable(page: Page): Promise<string> {
  const before = await canvasHash(page);
  await page.evaluate(() => window.__varvePerf?.forceFullRedraw());
  await page.waitForTimeout(500);
  const after = await canvasHash(page);
  expect(after).toBe(before);
  return after;
}

async function selectExportTab(page: Page): Promise<void> {
  const exportTab = page.locator('[role="tablist"] button[role="tab"]', { hasText: /^export$/i });
  if (await exportTab.isVisible({ timeout: 1000 }).catch(() => false)) {
    await exportTab.click();
    return;
  }
  await page.getByRole('button', { name: /^More inspector tabs/ }).click();
  await page
    .getByRole('menu', { name: 'More inspector tabs' })
    .getByRole('menuitem', { name: 'Export', exact: true })
    .click();
}

async function exportPng(page: Page, outputPath: string): Promise<Buffer> {
  await selectExportTab(page);
  await page.getByRole('radio', { name: 'PNG', exact: true }).first().click();
  const downloadPromise = page.waitForEvent('download', { timeout: 180_000 });
  await page.getByRole('button', { name: 'Download PNG', exact: true }).click();
  const download = await downloadPromise;
  await download.saveAs(outputPath);
  return readFile(outputPath);
}

test('frequency separation and Liquify survive save/reopen and export', async ({
  page,
}, testInfo) => {
  await page.addInitScript(() => {
    const originalWarn = console.warn;
    Object.defineProperty(window, '__historyWarningStacks', {
      configurable: false,
      value: [] as string[],
    });
    console.warn = (...args: Parameters<typeof console.warn>) => {
      const warning = String(args[0]);
      if (
        warning.includes('updateDoc called outside transaction') ||
        warning.includes('[history] capture failed')
      ) {
        (window as unknown as { __historyWarningStacks: string[] }).__historyWarningStacks.push(
          new Error().stack ?? 'stack unavailable',
        );
      }
      originalWarn.apply(console, args);
    };
  });
  await openRetouchFixture(page);
  await page.locator('.editor-menubar__doc-name-text').click();
  const name = page.getByRole('textbox', { name: 'Document name', exact: true });
  await name.fill('Frequency Liquify persistence fixture');
  await name.press('Enter');

  const raster = page
    .locator('.layers-panel')
    .getByText(/raster layer/i)
    .first();
  await raster.click();
  await page.waitForTimeout(500);
  await page.getByTestId('editor-canvas').screenshot({
    path: testInfo.outputPath('frequency-liquify-before.png'),
  });
  await runPaletteAction(page, 'Frequency Separation', /Frequency Separation/);
  const separationDialog = page.getByRole('dialog', { name: /Frequency Separation/i });
  await expect(separationDialog.getByRole('button', { name: 'Before', exact: true })).toBeVisible();
  await separationDialog.getByRole('button', { name: 'Before', exact: true }).click();
  await separationDialog.getByRole('button', { name: 'Combined', exact: true }).click();
  await separationDialog.getByRole('button', { name: /Create Separation/i }).click();
  await expect(separationDialog).toBeHidden({ timeout: 30_000 });
  await expect(page.locator('.layers-panel').getByText(/Tone/).first()).toBeVisible({
    timeout: 20_000,
  });
  await expect(
    page
      .locator('.layers-panel')
      .getByText(/Detail/)
      .first(),
  ).toBeVisible({
    timeout: 20_000,
  });

  const group = page
    .locator('.layers-panel')
    .getByText(/Frequency Separation/)
    .first();
  await group.click();
  await page.keyboard.press('y');
  const options = page.getByRole('dialog', { name: /Liquify tool options/i });
  await expect(options).toBeVisible({ timeout: 15_000 });
  await expect(page.getByTestId('liquify-options')).toContainText(/shared deformation/i);

  const canvas = page.getByTestId('editor-canvas');
  const box = await canvas.boundingBox();
  expect(box).not.toBeNull();
  const startX = box!.x + box!.width * 0.45;
  const startY = box!.y + box!.height * 0.5;
  await page.mouse.move(startX, startY);
  await page.mouse.down();
  await page.mouse.move(startX + box!.width * 0.12, startY, { steps: 8 });
  await page.mouse.up();
  await page.waitForTimeout(900);
  const interactionSummary = await page.evaluate(() => {
    const perf = (
      window as unknown as {
        __varvePerf?: {
          interactions?: {
            summary: () => {
              count: number;
              inputToCommit: { count: number; p50: number; p95: number; max: number };
              total: { count: number; p50: number; p95: number; max: number };
            };
          };
        };
      }
    ).__varvePerf;
    return perf?.interactions?.summary() ?? null;
  });
  await testInfo.attach('frequency-liquify-interaction-summary.json', {
    body: JSON.stringify(interactionSummary, null, 2),
    contentType: 'application/json',
  });
  await writeFile(
    testInfo.outputPath('frequency-liquify-interaction-summary.json'),
    JSON.stringify(interactionSummary, null, 2),
  );
  console.log(`Liquify interaction summary: ${JSON.stringify(interactionSummary)}`);
  const historyWarningStacks = await page.evaluate(
    () => (window as unknown as { __historyWarningStacks: string[] }).__historyWarningStacks,
  );
  await testInfo.attach('history-warning-stacks.json', {
    body: JSON.stringify(historyWarningStacks, null, 2),
    contentType: 'application/json',
  });
  expect(historyWarningStacks).toEqual([]);
  expect(interactionSummary?.count).toBeGreaterThan(0);
  expect(interactionSummary?.inputToCommit.count).toBeGreaterThan(0);
  expect(interactionSummary?.inputToCommit.p95).toBeGreaterThanOrEqual(0);
  const committedHash = await assertFullRedrawIsStable(page);
  await page.getByTestId('editor-canvas').screenshot({
    path: testInfo.outputPath('frequency-liquify-after.png'),
  });
  await testInfo.attach('frequency-liquify-committed.png', {
    body: await canvas.screenshot(),
    contentType: 'image/png',
  });

  const saved = await serializedDocument(page);
  const committedRetouchState = retouchState(saved);
  expect(saved).toContain('frequencySeparation');
  expect(saved).toContain('liquify');
  await page.keyboard.press('Control+s');
  await expect(page.locator('.save-status')).toHaveText('Saved', { timeout: 30_000 });

  const outputPath = testInfo.outputPath('frequency-liquify.png');
  const png = await exportPng(page, outputPath);
  expect(png.subarray(0, 8)).toEqual(Buffer.from([137, 80, 78, 71, 13, 10, 26, 10]));
  expect(png.length).toBeGreaterThan(100);

  await page.reload({ timeout: 120_000, waitUntil: 'commit' });
  await page.locator('.varve-home').waitFor({ timeout: 45_000 });
  const savedCard = page.getByRole('gridcell', { name: /Frequency Liquify persistence fixture/ });
  await expect(savedCard).toBeVisible({ timeout: 30_000 });
  await savedCard.dblclick({ timeout: 30_000 });
  await page.locator('.layers-panel').waitFor({ timeout: 60_000 });
  await expect(
    page
      .locator('.layers-panel')
      .getByText(/Frequency Separation/)
      .first(),
  ).toBeVisible({
    timeout: 30_000,
  });
  await expect(page.locator('.layers-panel').getByText(/Tone/).first()).toBeVisible();
  await expect(
    page
      .locator('.layers-panel')
      .getByText(/Detail/)
      .first(),
  ).toBeVisible();
  await groupAfterReopen(page);
  const reopened = await serializedDocument(page);
  const reopenedRetouchState = retouchState(reopened);
  console.log(`retouch state before reopen: ${textHash(committedRetouchState)}`);
  console.log(`retouch state after reopen: ${textHash(reopenedRetouchState)}`);
  expect(reopened).toContain('liquify');
  expect(reopenedRetouchState).toBe(committedRetouchState);
  await page.waitForTimeout(800);
  expect(await assertFullRedrawIsStable(page)).toBeTruthy();
  expect(committedHash).toMatch(/^\d+:\d+$/);
  await testInfo.attach('frequency-liquify-reopened.png', {
    body: await page.getByTestId('editor-canvas').screenshot(),
    contentType: 'image/png',
  });
  await page.getByTestId('editor-canvas').screenshot({
    path: testInfo.outputPath('frequency-liquify-reopened-canvas.png'),
  });
  const reopenedOutputPath = testInfo.outputPath('frequency-liquify-reopened.png');
  const reopenedPng = await exportPng(page, reopenedOutputPath);
  expect(reopenedPng).toEqual(png);
});

async function groupAfterReopen(page: Page): Promise<void> {
  await page
    .locator('.layers-panel')
    .getByText(/Frequency Separation/)
    .first()
    .click();
  await page.keyboard.press('y');
  await expect(page.getByTestId('liquify-options')).toContainText(/shared deformation/i);
}
