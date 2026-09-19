/**
 * Inspector redesign baseline — per-selection height and scroll budgets.
 *
 * Establishes the measured before-state required by the Inspector redesign
 * review: for each representative selection, it expands every available
 * section, then measures the Design tab's total content height, viewport
 * coverage, and the scroll distance to the key property sections. Screenshots
 * and a JSON metrics file are written under reports/inspector-redesign/ so
 * the redesign's before/after comparison is numeric, not recalled from memory.
 *
 * Companion audit: docs/audits/inspector-systems-redesign-2026-09-17.md
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');
const REPORT_DIR = path.resolve('reports/inspector-redesign/baseline');
const SHOT_DIR = path.resolve('docs/screenshots/2026-09-17-inspector-review');

const SECTION_TRIGGER = '.insp-disclosure__trigger';

async function drawRect(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 160, box.y + 160);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 280, { steps: 4 });
  await page.mouse.up();
}

async function createFrame(page: Page): Promise<void> {
  await page.keyboard.press('f');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 560, y: 320 } });
}

async function createText(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 220, box.y + 420);
  const inline = page.getByRole('textbox', { name: /editing text/i });
  await inline.waitFor({ timeout: 10_000 });
  await page.keyboard.type('Heading copy');
  await page.keyboard.press('Escape');
}

async function importPhoto(page: Page): Promise<void> {
  await page.locator('#file-import-input').setInputFiles(PHOTO);
}

async function openDesignTab(page: Page): Promise<void> {
  const designTab = page.getByRole('tab', { name: 'Design' });
  if ((await designTab.getAttribute('aria-selected')) !== 'true') {
    await designTab.click();
  }
  await expect(page.locator('#insp-tabpanel-properties')).toBeVisible({ timeout: 10_000 });
}

/** Expand every collapsed section, bottom-up, until none remain collapsed. */
async function expandAllSections(page: Page): Promise<number> {
  const collapsed = page.locator(`${SECTION_TRIGGER}[aria-expanded="false"]`);
  let expanded = 0;
  for (let attempt = 0; attempt < 60; attempt += 1) {
    const count = await collapsed.count();
    if (count === 0) break;
    await collapsed.last().scrollIntoViewIfNeeded();
    await collapsed.last().click();
    expanded += 1;
  }
  return expanded;
}

interface PanelMetrics {
  scenario: string;
  sectionCount: number;
  collapsedCount: number;
  scrollHeight: number;
  clientHeight: number;
  ratio: number;
  panelWidth: number;
  sectionOffsets: Record<string, number>;
  sectionHeights: Record<string, number>;
  order: string[];
}

async function measurePanel(page: Page, scenario: string): Promise<PanelMetrics> {
  return page.evaluate((label) => {
    const scroller = document.querySelector('.editor-inspector > .insp-panel');
    const panel = document.querySelector('.editor__inspector-panel');
    const triggers = [...document.querySelectorAll('.insp-disclosure__trigger')];
    const wanted = [
      'Position & Size',
      'Stack / Grid',
      'Layout child',
      'Typography',
      'Fill',
      'Stroke',
      'Layer Effects',
      'Image Placement',
      'Corner Radius',
      'Appearance',
      'Align & Distribute',
    ];
    const offsets: Record<string, number> = {};
    const heights: Record<string, number> = {};
    const order: string[] = [];
    const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
    for (const trigger of triggers) {
      const title = trigger.textContent?.trim() ?? '';
      order.push(title);
      const section = trigger.closest('.insp-disclosure');
      if (section) {
        const rect = section.getBoundingClientRect();
        if (!offsets[title] && wanted.includes(title)) {
          offsets[title] = Math.round(rect.top - scrollerTop);
          heights[title] = Math.round(rect.height);
        }
      }
    }
    const scrollHeight = scroller?.scrollHeight ?? 0;
    const clientHeight = scroller?.clientHeight ?? 0;
    return {
      scenario: label,
      sectionCount: triggers.length,
      collapsedCount: triggers.filter((t) => t.getAttribute('aria-expanded') === 'false').length,
      scrollHeight,
      clientHeight,
      ratio: clientHeight > 0 ? Math.round((scrollHeight / clientHeight) * 10) / 10 : 0,
      panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
      sectionOffsets: offsets,
      sectionHeights: heights,
      order,
    } satisfies PanelMetrics;
  }, scenario);
}

async function captureScenario(
  page: Page,
  scenario: string,
  metrics: PanelMetrics[],
): Promise<void> {
  await openDesignTab(page);
  await expandAllSections(page);
  // Collapse-count must be zero for a true expanded-height measurement.
  const remaining = await page.locator(`${SECTION_TRIGGER}[aria-expanded="false"]`).count();
  expect(remaining, `scenario ${scenario} fully expanded`).toBe(0);
  const m = await measurePanel(page, scenario);
  metrics.push(m);
  if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
  await page.screenshot({
    path: path.join(SHOT_DIR, `baseline-${scenario}.png`),
    fullPage: false,
  });
}

test.describe('Inspector redesign baseline', () => {
  let metrics: PanelMetrics[] = [];

  test.beforeEach(async () => {
    metrics = [];
    if (!existsSync(REPORT_DIR)) mkdirSync(REPORT_DIR, { recursive: true });
  });

  test.afterEach(async () => {
    // test.info() instead of the fixtures argument: Playwright requires the
    // first hook argument to destructure {}, which Biome's noEmptyPattern
    // forbids — this shape satisfies both.
    const info = test.info();
    if (metrics.length > 0) {
      writeFileSync(
        path.join(REPORT_DIR, `${info.title.replace(/\W+/g, '-')}.json`),
        JSON.stringify(metrics, null, 2),
      );
    }
  });

  test('no selection: document scope heights', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await openDesignTab(page);
    const m = await measurePanel(page, 'no-selection');
    metrics.push(m);
    await page.screenshot({ path: path.join(SHOT_DIR, 'baseline-no-selection.png') });
    expect(m.sectionCount).toBeGreaterThan(0);
  });

  test('rectangle selection heights and scroll budget', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });
    await captureScenario(page, 'rectangle', metrics);
  });

  test('frame selection heights and scroll budget', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await createFrame(page);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });
    await captureScenario(page, 'frame', metrics);
  });

  test('text selection heights and scroll budget', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await createText(page);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });
    await captureScenario(page, 'text', metrics);
  });

  test('image selection heights and scroll budget', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await importPhoto(page);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 20_000 });
    await captureScenario(page, 'image', metrics);
  });

  /**
   * Additive selection through the layers rows. Under heavy machine load a
   * Control+click can land between the click handler attaching and the panel
   * rerendering, so the second click retries once before giving up.
   */
  async function selectTwoRows(page: Page): Promise<void> {
    const first = page.getByRole('treeitem').first();
    const second = page.getByRole('treeitem').nth(1);
    await first.click();
    for (let attempt = 0; attempt < 2; attempt += 1) {
      await second.click({ modifiers: ['Control'] });
      const multi = page.locator('.insp-panel__multi-count');
      if (await multi.isVisible({ timeout: 3000 }).catch(() => false)) return;
    }
    await expect(page.locator('.insp-panel__multi-count')).toBeVisible({ timeout: 5000 });
  }

  test('multi-selection (two rectangles) heights', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page);
    await page.keyboard.press('Escape');
    await drawRect(page);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
    await selectTwoRows(page);
    await captureScenario(page, 'multi-same', metrics);
  });

  test('mixed selection (rectangle + text) heights', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page);
    await page.keyboard.press('Escape');
    await createText(page);
    await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
    await selectTwoRows(page);
    await captureScenario(page, 'multi-mixed', metrics);
  });

  test('collapsed summaries are the trigger accessible description', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await drawRect(page);
    await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 10_000 });
    await openDesignTab(page);

    // Collapsed: the summary is wired via aria-describedby, so assistive tech
    // announces it after the name without widening the name itself.
    const trigger = page.locator('[data-section-id="corner-radius"] .insp-disclosure__trigger');
    await expect(trigger).toHaveAttribute('aria-expanded', 'false');
    const describedBy = await trigger.getAttribute('aria-describedby');
    expect(describedBy).toBeTruthy();
    const summaryText = await page.locator(`#${describedBy}`).textContent();
    expect(summaryText).toMatch(/px/);

    // Expanded: the summary leaves the DOM entirely.
    await trigger.click();
    await expect(trigger).toHaveAttribute('aria-expanded', 'true');
    await expect(trigger).not.toHaveAttribute('aria-describedby', describedBy ?? '');
    await expect(page.locator(`#${describedBy}`)).toHaveCount(0);
  });
});
