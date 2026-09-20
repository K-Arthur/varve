/**
 * Inspector density contract.
 *
 * This is intentionally assertion-based: screenshots are emitted through
 * Playwright's test output directory so the spec never mutates a shared
 * reports folder or silently replaces a visual baseline.
 */
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

async function drawRectangle(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.waitFor({ state: 'visible', timeout: 15_000 });
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 140, box.y + 140);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 290, { steps: 3 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function densityMetrics(page: Page) {
  return page.evaluate(() => {
    const inspector = document.querySelector<HTMLElement>('.editor-inspector');
    const scroller = document.querySelector<HTMLElement>('.editor-inspector > .insp-panel');
    const section = document.querySelector<HTMLElement>('.insp-disclosure');
    const content = section?.querySelector<HTMLElement>('.insp-disclosure__content');
    const firstInput = document.querySelector<HTMLElement>(
      '.editor-inspector .insp-num__input, .editor-inspector .insp-select, .editor-inspector input',
    );
    if (!inspector || !scroller || !section || !content || !firstInput) {
      throw new Error('Inspector density probe could not find its structural elements');
    }
    const inspectorStyle = getComputedStyle(inspector);
    const contentStyle = getComputedStyle(content);
    const sectionStyle = getComputedStyle(section);
    return {
      mode: document.documentElement.dataset.density,
      rowHeight: Number.parseFloat(inspectorStyle.getPropertyValue('--insp-row-height')),
      panelInset: inspectorStyle.paddingTop,
      sectionGap: sectionStyle.marginBottom,
      contentGap: contentStyle.rowGap,
      contentPadding: `${contentStyle.paddingTop}/${contentStyle.paddingBottom}`,
      inputHeight: firstInput.getBoundingClientRect().height,
      panelScrollHeight: scroller.scrollHeight,
      panelClientHeight: scroller.clientHeight,
      horizontalOverflow: scroller.scrollWidth - scroller.clientWidth,
      sectionOverflow: [...document.querySelectorAll<HTMLElement>('.insp-disclosure__content')].map(
        (body) => body.scrollWidth - body.clientWidth,
      ),
    };
  });
}

test('Default Pro is breathable and Compact Pro remains dense', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  const baselinePanelHeight = await page.locator('.editor-inspector').evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  await drawRectangle(page);

  const selectedBefore = await page.getByRole('treeitem').first().getAttribute('aria-selected');
  const defaultMetrics = await densityMetrics(page);
  const defaultPanelHeight = await page.locator('.editor-inspector').evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  await page.locator('.editor-inspector').screenshot({
    path: testInfo.outputPath('inspector-spacing-default.png'),
    animations: 'disabled',
  });

  await page.evaluate(() => document.documentElement.setAttribute('data-density', 'compact'));
  await page.waitForTimeout(100);
  const compactMetrics = await densityMetrics(page);
  const compactPanelHeight = await page.locator('.editor-inspector').evaluate(
    (el) => el.getBoundingClientRect().height,
  );
  await page.locator('.editor-inspector').screenshot({
    path: testInfo.outputPath('inspector-spacing-compact.png'),
    animations: 'disabled',
  });

  expect(defaultMetrics.mode).toBe('comfortable');
  expect(defaultMetrics.rowHeight).toBe(34);
  expect(defaultMetrics.inputHeight).toBe(34);
  expect(compactMetrics.mode).toBe('compact');
  expect(compactMetrics.rowHeight).toBe(28);
  expect(compactMetrics.inputHeight).toBe(28);
  expect(Number.parseFloat(defaultMetrics.contentGap)).toBeGreaterThan(
    Number.parseFloat(compactMetrics.contentGap),
  );
  expect(Number.parseFloat(defaultMetrics.sectionGap)).toBeGreaterThan(
    Number.parseFloat(defaultMetrics.contentGap),
  );
  expect(Number.parseFloat(compactMetrics.sectionGap)).toBeGreaterThan(
    Number.parseFloat(compactMetrics.contentGap),
  );
  expect(defaultMetrics.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(compactMetrics.horizontalOverflow).toBeLessThanOrEqual(1);
  expect(defaultPanelHeight).toBeLessThanOrEqual(baselinePanelHeight * 1.15);
  expect(Math.abs(compactPanelHeight - defaultPanelHeight)).toBeLessThanOrEqual(
    defaultPanelHeight * 0.02,
  );
  for (const overflow of [...defaultMetrics.sectionOverflow, ...compactMetrics.sectionOverflow]) {
    expect(overflow).toBeLessThanOrEqual(1);
  }
  expect(compactMetrics.panelScrollHeight).toBeLessThan(defaultMetrics.panelScrollHeight);
  expect(await page.getByRole('treeitem').first().getAttribute('aria-selected')).toBe(selectedBefore);

  await page.screenshot({ path: testInfo.outputPath('inspector-density-context.png') });
});

test('Inspector density stays usable at narrow rails and across themes', async ({ page }) => {
  await page.setViewportSize({ width: 1120, height: 700 });
  await navigateToEditor(page);
  await drawRectangle(page);

  for (const theme of ['light', 'dark', 'high-contrast'] as const) {
    await page.evaluate((nextTheme) => {
      document.documentElement.dataset.theme = nextTheme;
      document.documentElement.dataset.density = 'compact';
    }, theme);
    await page.waitForTimeout(80);
    const metrics = await densityMetrics(page);
    expect(metrics.inputHeight).toBe(28);
    expect(metrics.horizontalOverflow).toBeLessThanOrEqual(1);
    expect(metrics.sectionOverflow.every((overflow) => overflow <= 1)).toBe(true);
  }
});
