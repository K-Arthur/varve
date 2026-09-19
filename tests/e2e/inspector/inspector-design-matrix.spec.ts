/**
 * Inspector Design tab — baseline matrix capture (2026-09-19 pass).
 *
 * Captures the state that precedes the 2026-09-19 redesign pass across:
 *   - selection states (none / rect / ellipse / text / frame / image / group /
 *     multi-same / multi-mixed)
 *   - themes (light / dark / high-contrast)
 *   - rail widths (240 min / 320 default / 640 wide)
 *   - text scale (100% / 150% / 200% root font size)
 *
 * Unlike the 2026-09-17 baseline harness, this one resets the panel scroll to
 * the top before measuring offsets so the recorded geometry is
 * scroll-independent, and it captures computed typography/geometry/target-size
 * data instead of only scroll budgets.
 *
 * Evidence lands in the git-ignored `reports/inspector-redesign/baseline-matrix/`
 * so re-runs never churn committed screenshots.
 */
import { existsSync, mkdirSync, writeFileSync } from 'node:fs';
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');
const PHASE = process.env.VARVE_MATRIX_PHASE === 'after' ? 'after-matrix' : 'baseline-matrix';
const REPORT_DIR = path.resolve(`reports/inspector-redesign/${PHASE}`);
const SHOT_DIR = path.join(REPORT_DIR, 'shots');

type Theme = 'light' | 'dark' | 'high-contrast';
type Scenario =
  | 'no-selection'
  | 'rectangle'
  | 'ellipse'
  | 'text'
  | 'frame'
  | 'image'
  | 'group'
  | 'multi-same'
  | 'multi-mixed';

interface PanelMetrics {
  scenario: string;
  theme: Theme;
  width: number;
  textScale: string;
  sectionCount: number;
  collapsedCount: number;
  scrollHeight: number;
  clientHeight: number;
  ratio: number;
  panelWidth: number;
  order: string[];
  sectionIds: string[];
  sectionHeights: Record<string, number>;
  sectionOffsets: Record<string, number>;
  typeCensus: Record<string, number>;
  labelOffsets: number[];
  controlRightEdges: number[];
  controlHeights: number[];
  rowHeights: number[];
  iconSizes: number[];
  undersizedTargets: {
    name: string;
    w: number;
    h: number;
    cx: number;
    cy: number;
    spacingOk: boolean;
  }[];
  targetCount: number;
  tokenProbe: Record<string, string>;
}

async function setTheme(page: Page, theme: Theme): Promise<void> {
  await page.addInitScript((value) => localStorage.setItem('varve-theme', value), theme);
  await navigateToEditor(page);
  await page.waitForTimeout(120);
}

async function openDesignTab(page: Page): Promise<void> {
  const designTab = page.getByRole('tab', { name: 'Design' });
  if ((await designTab.getAttribute('aria-selected')) !== 'true') {
    await designTab.click();
  }
  await expect(page.locator('#insp-tabpanel-properties')).toBeVisible({ timeout: 10_000 });
}

async function setRail(page: Page, width: number): Promise<void> {
  await page.locator('.editor-shell').evaluate((shell, nextWidth) => {
    shell.style.setProperty('--inspector-width', `${nextWidth}px`);
  }, width);
  await expect(page.locator('.editor__inspector-panel')).toHaveCSS('width', `${width}px`);
  await page.waitForTimeout(80);
}

async function expandAllSections(page: Page): Promise<void> {
  const collapsed = page.locator('.insp-disclosure__trigger[aria-expanded="false"]');
  for (let attempt = 0; attempt < 80; attempt += 1) {
    const count = await collapsed.count();
    if (count === 0) break;
    await collapsed.last().scrollIntoViewIfNeeded();
    await collapsed.last().click();
  }
}

async function measurePanel(
  page: Page,
  scenario: Scenario,
  theme: Theme,
  width: number,
  textScale: string,
): Promise<PanelMetrics> {
  return page.evaluate(
    ({ label, themeName, railWidth, scale }) => {
      const scroller = document.querySelector(
        '.editor-inspector > .insp-panel',
      ) as HTMLElement | null;
      const panel = document.querySelector('.editor__inspector-panel');
      if (scroller) scroller.scrollTop = 0;
      const round = (n: number) => Math.round(n * 10) / 10;
      const sections = [...document.querySelectorAll('.insp-disclosure')];
      const order: string[] = [];
      const sectionIds: string[] = [];
      const sectionHeights: Record<string, number> = {};
      const sectionOffsets: Record<string, number> = {};
      const scrollerTop = scroller ? scroller.getBoundingClientRect().top : 0;
      for (const section of sections) {
        const trigger = section.querySelector('.insp-disclosure__trigger');
        const title = trigger?.textContent?.trim() ?? '';
        const id = (section as HTMLElement).dataset.sectionId ?? title;
        order.push(title);
        sectionIds.push(id);
        const rect = section.getBoundingClientRect();
        sectionHeights[id] = round(rect.height);
        sectionOffsets[id] = round(rect.top - scrollerTop);
      }

      const typeCensus: Record<string, number> = {};
      const bump = (element: Element | null | undefined, role: string) => {
        if (!element) return;
        const style = getComputedStyle(element as HTMLElement);
        const key = `${role}|${style.fontSize}|${style.fontWeight}|${style.lineHeight}|${style.letterSpacing}|${style.color}`;
        typeCensus[key] = (typeCensus[key] ?? 0) + 1;
      };
      for (const label of document.querySelectorAll('.insp-field__label')) bump(label, 'label');
      for (const value of document.querySelectorAll('.insp-num__input, .insp-select'))
        bump(value, 'value');
      for (const header of document.querySelectorAll('.insp-disclosure__trigger'))
        bump(header, 'section');
      for (const hint of document.querySelectorAll('.insp-hint, .insp-empty')) bump(hint, 'hint');

      const labelOffsets: number[] = [];
      for (const label of document.querySelectorAll('.insp-field__label')) {
        labelOffsets.push(round(label.getBoundingClientRect().left));
      }

      const controlRightEdges: number[] = [];
      const controlHeights: number[] = [];
      for (const control of document.querySelectorAll(
        '.insp-num__input, .insp-select, .insp-field__control, .insp-inline-btn',
      )) {
        const rect = control.getBoundingClientRect();
        controlRightEdges.push(round(rect.right));
        controlHeights.push(round(rect.height));
      }

      const rowHeights: number[] = [];
      for (const row of document.querySelectorAll('.insp-field')) {
        rowHeights.push(round(row.getBoundingClientRect().height));
      }

      const iconSizes: number[] = [];
      for (const icon of document.querySelectorAll('.insp-panel svg')) {
        const rect = icon.getBoundingClientRect();
        if (rect.width > 0) iconSizes.push(round(rect.width));
      }

      const undersizedTargets: {
        name: string;
        w: number;
        h: number;
        cx: number;
        cy: number;
        spacingOk: boolean;
      }[] = [];
      const targets = [
        ...document.querySelectorAll(
          '.insp-panel button, .insp-panel input, .insp-panel [role="button"], .insp-panel [role="spinbutton"]',
        ),
      ];
      const targetRects = targets.map((target) => target.getBoundingClientRect());
      const isClipped = (target: Element) => {
        const style = getComputedStyle(target as HTMLElement);
        return (
          (style.clipPath && style.clipPath !== 'none') || (style.clip && style.clip !== 'auto')
        );
      };
      const labelIsTarget = (target: Element) => {
        if (!(target instanceof HTMLInputElement)) return false;
        if (target.type !== 'checkbox' && target.type !== 'radio') return false;
        const label = target.closest('label');
        if (!label) return false;
        const rect = label.getBoundingClientRect();
        return rect.width >= 24 && rect.height >= 24;
      };
      const circleHitsRect = (cx: number, cy: number, rect: DOMRect) => {
        const nx = Math.max(rect.left, Math.min(cx, rect.right));
        const ny = Math.max(rect.top, Math.min(cy, rect.bottom));
        return Math.hypot(cx - nx, cy - ny) < 12;
      };
      const undersized: { name: string; w: number; h: number; cx: number; cy: number }[] = [];
      for (let index = 0; index < targets.length; index += 1) {
        const target = targets[index];
        const rect = targetRects[index];
        if (!target || !rect || rect.width === 0 || rect.height === 0) continue;
        if (isClipped(target) || labelIsTarget(target)) continue;
        if (rect.width < 24 || rect.height < 24) {
          undersized.push({
            name:
              target.getAttribute('aria-label') ??
              target.getAttribute('title') ??
              (target.textContent ?? '').trim().slice(0, 40),
            w: round(rect.width),
            h: round(rect.height),
            cx: round(rect.left + rect.width / 2),
            cy: round(rect.top + rect.height / 2),
          });
        }
      }
      for (const entry of undersized) {
        let ok = true;
        for (let index = 0; index < targets.length; index += 1) {
          const rect = targetRects[index];
          if (!rect || rect.width === 0 || rect.height === 0) continue;
          const inside =
            rect.left <= entry.cx &&
            entry.cx <= rect.right &&
            rect.top <= entry.cy &&
            entry.cy <= rect.bottom;
          if (inside) continue;
          if (circleHitsRect(entry.cx, entry.cy, rect)) ok = false;
        }
        for (const other of undersized) {
          if (other === entry) continue;
          if (Math.hypot(other.cx - entry.cx, other.cy - entry.cy) < 24) ok = false;
        }
        undersizedTargets.push({ ...entry, spacingOk: ok });
      }

      const probe = document.createElement('div');
      probe.style.position = 'absolute';
      probe.style.marginBlockStart = 'var(--space-1)';
      probe.style.paddingBlockStart = 'var(--space-2)';
      probe.style.rowGap = 'var(--space-3)';
      probe.style.fontSize = 'var(--font-size-xs)';
      probe.style.borderRadius = 'var(--radius-sm)';
      probe.style.borderWidth = 'var(--border-width-thin)';
      document.body.append(probe);
      const probeStyle = getComputedStyle(probe);
      const tokenProbe = {
        space1: probeStyle.marginBlockStart,
        space2: probeStyle.paddingBlockStart,
        space3: probeStyle.rowGap,
        fontSizeXs: probeStyle.fontSize,
        radiusSm: probeStyle.borderRadius,
        borderThin: probeStyle.borderWidth,
      };
      probe.remove();

      return {
        scenario: label,
        theme: themeName,
        width: railWidth,
        textScale: scale,
        sectionCount: sections.length,
        collapsedCount: sections.filter(
          (section) =>
            section.querySelector('.insp-disclosure__trigger')?.getAttribute('aria-expanded') ===
            'false',
        ).length,
        scrollHeight: scroller?.scrollHeight ?? 0,
        clientHeight: scroller?.clientHeight ?? 0,
        ratio:
          scroller && scroller.clientHeight > 0
            ? Math.round((scroller.scrollHeight / scroller.clientHeight) * 10) / 10
            : 0,
        panelWidth: panel ? Math.round(panel.getBoundingClientRect().width) : 0,
        order,
        sectionIds,
        sectionHeights,
        sectionOffsets,
        typeCensus,
        labelOffsets,
        controlRightEdges,
        controlHeights,
        rowHeights,
        iconSizes,
        undersizedTargets,
        targetCount: targets.length,
        tokenProbe,
      };
    },
    { label: scenario, themeName: theme, railWidth: width, scale: textScale },
  );
}

async function drawShape(
  page: Page,
  tool: 'r' | 'e' | 'o',
  x1 = 160,
  y1 = 160,
  x2 = 330,
  y2 = 290,
) {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press(tool);
  await page.mouse.move(box.x + x1, box.y + y1);
  await page.mouse.down();
  await page.mouse.move(box.x + x2, box.y + y2, { steps: 4 });
  await page.mouse.up();
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

async function createFrame(page: Page): Promise<void> {
  await page.keyboard.press('f');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 560, y: 320 } });
}

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

async function buildScenario(page: Page, scenario: Scenario): Promise<void> {
  switch (scenario) {
    case 'no-selection':
      return;
    case 'rectangle':
      await drawShape(page, 'r');
      break;
    case 'ellipse':
      await drawShape(page, 'o');
      break;
    case 'text':
      await createText(page);
      break;
    case 'frame':
      await createFrame(page);
      break;
    case 'image':
      await page.locator('#file-import-input').setInputFiles(PHOTO);
      break;
    case 'group': {
      await drawShape(page, 'r', 120, 140, 240, 240);
      await page.keyboard.press('Escape');
      await drawShape(page, 'r', 300, 260, 420, 360);
      await selectTwoRows(page);
      await page.keyboard.press('Control+g');
      await page.waitForTimeout(250);
      break;
    }
    case 'multi-same':
      await drawShape(page, 'r', 120, 140, 240, 240);
      await page.keyboard.press('Escape');
      await drawShape(page, 'r', 300, 260, 420, 360);
      await selectTwoRows(page);
      break;
    case 'multi-mixed':
      await drawShape(page, 'r', 120, 140, 240, 240);
      await page.keyboard.press('Escape');
      await createText(page);
      await selectTwoRows(page);
      break;
  }
  await expect(page.getByRole('treeitem').first()).toBeVisible({ timeout: 20_000 });
}

test.describe('Inspector baseline matrix', () => {
  test.beforeEach(() => {
    if (!existsSync(SHOT_DIR)) mkdirSync(SHOT_DIR, { recursive: true });
  });

  const SCENARIOS: Scenario[] = [
    'no-selection',
    'rectangle',
    'ellipse',
    'text',
    'frame',
    'image',
    'group',
    'multi-same',
    'multi-mixed',
  ];
  const RAILS = [240, 320, 640] as const;

  test('metrics — light theme across rails', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);
    const collected: PanelMetrics[] = [];
    for (const scenario of SCENARIOS) {
      await page.setViewportSize({ width: 1440, height: 900 });
      await setTheme(page, 'light');
      await buildScenario(page, scenario);
      await openDesignTab(page);
      await expandAllSections(page);
      for (const width of RAILS) {
        await setRail(page, width);
        const metrics = await measurePanel(page, scenario, 'light', width, '100%');
        collected.push(metrics);
        await page.screenshot({
          path: path.join(SHOT_DIR, `light-${scenario}-${width}.png`),
          fullPage: false,
        });
      }
      // Reset the storage preference between scenarios so each starts fresh.
      await page.evaluate(() => localStorage.removeItem('varve-theme'));
    }
    writeFileSync(path.join(REPORT_DIR, 'metrics-light.json'), JSON.stringify(collected, null, 2));
  });

  test('metrics — themes at default rail', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);
    const collected: PanelMetrics[] = [];
    const themes: Theme[] = ['light', 'dark', 'high-contrast'];
    const scenarios: Scenario[] = ['no-selection', 'rectangle', 'text', 'image'];
    for (const theme of themes) {
      for (const scenario of scenarios) {
        await page.setViewportSize({ width: 1440, height: 900 });
        await setTheme(page, theme);
        await buildScenario(page, scenario);
        await openDesignTab(page);
        await expandAllSections(page);
        await setRail(page, 320);
        const metrics = await measurePanel(page, scenario, theme, 320, '100%');
        collected.push(metrics);
        await page.screenshot({
          path: path.join(SHOT_DIR, `${theme}-${scenario}-320.png`),
          fullPage: false,
        });
        await page.evaluate(() => localStorage.removeItem('varve-theme'));
      }
    }
    writeFileSync(path.join(REPORT_DIR, 'metrics-themes.json'), JSON.stringify(collected, null, 2));
  });

  test('metrics — text scale at default rail', async ({ page }, testInfo) => {
    testInfo.setTimeout(600_000);
    const collected: PanelMetrics[] = [];
    const scales = ['100%', '150%', '200%'] as const;
    const scenarios: Scenario[] = ['rectangle', 'text', 'frame'];
    for (const scale of scales) {
      for (const scenario of scenarios) {
        await page.setViewportSize({ width: 2880, height: 1800 });
        await setTheme(page, 'light');
        await buildScenario(page, scenario);
        await openDesignTab(page);
        await expandAllSections(page);
        await page.evaluate((value) => {
          document.documentElement.style.fontSize = value;
        }, scale);
        await page.waitForTimeout(200);
        await setRail(page, 320);
        const metrics = await measurePanel(page, scenario, 'light', 320, scale);
        collected.push(metrics);
        await page.screenshot({
          path: path.join(SHOT_DIR, `textscale-${scale.replace('%', '')}-${scenario}-320.png`),
          fullPage: false,
        });
        await page.evaluate(() => {
          document.documentElement.style.fontSize = '';
          localStorage.removeItem('varve-theme');
        });
      }
    }
    writeFileSync(
      path.join(REPORT_DIR, 'metrics-textscale.json'),
      JSON.stringify(collected, null, 2),
    );
  });
});
