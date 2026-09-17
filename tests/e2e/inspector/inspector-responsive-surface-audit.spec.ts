/**
 * Baseline evidence for Inspector rail responsiveness.
 *
 * These scenarios use the real editor shell, a drawn shape, and an imported
 * photograph. They deliberately measure the live DOM at multiple rail widths
 * before the responsive-surface repair.
 */
import path from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');
const RAILS = [240, 280, 320, 400, 640] as const;

async function drawRectangle(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 360, box.y + 300, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function openDesign(page: Page): Promise<void> {
  await page.getByRole('tab', { name: 'Design' }).click();
  await expect(page.locator('#insp-tabpanel-properties')).toBeVisible({ timeout: 10_000 });
}

async function setRail(page: Page, width: number): Promise<void> {
  await page.locator('.editor-shell').evaluate((shell, nextWidth) => {
    shell.style.setProperty('--inspector-width', `${nextWidth}px`);
  }, width);
  await expect(page.locator('.editor__inspector-panel')).toHaveCSS('width', `${width}px`);
  await page.waitForTimeout(80);
}

async function surfaceMetrics(page: Page) {
  return page.evaluate(() => {
    const rectOf = (element: Element) => {
      const rect = element.getBoundingClientRect();
      return {
        left: rect.left,
        right: rect.right,
        top: rect.top,
        bottom: rect.bottom,
        width: rect.width,
        height: rect.height,
      };
    };
    const panel = document.querySelector('.editor__inspector-panel');
    const scroller = document.querySelector('.editor-inspector > .insp-panel');
    const groups = [...document.querySelectorAll('.insp-disclosure')].map((section) => {
      const body = section.querySelector('.insp-disclosure__content');
      return {
        title: section.querySelector('.insp-disclosure__trigger')?.textContent?.trim() ?? '',
        rect: rectOf(section),
        scrollWidth: body?.scrollWidth ?? 0,
        clientWidth: body?.clientWidth ?? 0,
      };
    });
    const controls = [
      ...document.querySelectorAll(
        '.insp-field__control, .insp-select, .insp-num__input, .insp-image-fill__preview',
      ),
    ].map((element) => ({
      className: element.className,
      rect: rectOf(element),
      scrollWidth: element instanceof HTMLElement ? element.scrollWidth : 0,
      clientWidth: element instanceof HTMLElement ? element.clientWidth : 0,
    }));
    return {
      panel: panel ? rectOf(panel) : null,
      scroller: scroller
        ? {
            ...rectOf(scroller),
            scrollWidth: (scroller as HTMLElement).scrollWidth,
            clientWidth: (scroller as HTMLElement).clientWidth,
          }
        : null,
      groups,
      controls,
    };
  });
}

test('baseline: Position & Size remains over-wide across Inspector rails', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await drawRectangle(page);
  await openDesign(page);

  const position = page.getByRole('group', { name: 'Position & Size' });
  await expect(position).toBeVisible();
  const samples: Record<number, unknown> = {};
  for (const width of RAILS) {
    await setRail(page, width);
    await position.scrollIntoViewIfNeeded();
    samples[width] = await position.evaluate((group) => {
      const rectOf = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          bottom: rect.bottom,
          width: rect.width,
          height: rect.height,
        };
      };
      return {
        group: rectOf(group),
        fields: [...group.querySelectorAll('.insp-field')].map((field) => ({
          label: field.querySelector('.insp-field__label')?.textContent?.trim() ?? '',
          field: rectOf(field),
          input: field.querySelector('input') ? rectOf(field.querySelector('input')!) : null,
        })),
        overflow: (group as HTMLElement).scrollWidth - (group as HTMLElement).clientWidth,
      };
    });
  }
  console.log(`position-size baseline: ${JSON.stringify(samples)}`);
  await page.screenshot({
    path: testInfo.outputPath('position-size-baseline.png'),
    fullPage: false,
  });
});

test('baseline: image Fill and placement controls duplicate and stretch across rails', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await page.locator('#file-import-input').setInputFiles(PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole('treeitem').first().click();
  await openDesign(page);
  await expect(page.locator('.insp-image-fill__preview-img')).toBeVisible({ timeout: 15_000 });

  const samples: Record<number, unknown> = {};
  for (const width of RAILS) {
    await setRail(page, width);
    const metrics = await surfaceMetrics(page);
    samples[width] = metrics;
    await page.screenshot({
      path: testInfo.outputPath(`image-rail-${width}.png`),
      fullPage: false,
    });
  }
  console.log(`image-rail baseline: ${JSON.stringify(samples)}`);
});

test('baseline: sticky section headers expose the padded-top overlap', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);

  const panel = page.locator('#insp-tabpanel-properties');
  const isometricTrigger = page.getByRole('button', { name: /isometric grid/i }).first();
  await isometricTrigger.scrollIntoViewIfNeeded();
  await isometricTrigger.click();
  await panel.evaluate((element) => {
    element.scrollTop = Math.min(element.scrollHeight, 1_650);
  });
  await page.waitForTimeout(120);

  const metrics = await panel.evaluate((element) => {
    const scrollerRect = element.getBoundingClientRect();
    const owner = [...element.querySelectorAll<HTMLElement>('.insp-disclosure')].find((section) =>
      section
        .querySelector('.insp-disclosure__trigger')
        ?.textContent?.trim()
        .toLowerCase()
        .includes('isometric grid'),
    );
    const header = owner?.querySelector<HTMLElement>('.insp-disclosure__header');
    if (!header || !owner) throw new Error('expanded Isometric Grid header not found');
    const headerRect = header.getBoundingClientRect();
    const intersectingLabels = [...element.querySelectorAll<HTMLElement>('.insp-field__label')]
      .filter((label) => label.closest('.insp-disclosure') !== owner)
      .map((label) => ({
        label: label.textContent?.trim() ?? '',
        rect: label.getBoundingClientRect().toJSON(),
      }))
      .filter(({ rect }) => rect.bottom > headerRect.top && rect.top < headerRect.bottom);
    return {
      scrollTop: element.scrollTop,
      scroller: { top: scrollerRect.top, bottom: scrollerRect.bottom },
      header: { top: headerRect.top, bottom: headerRect.bottom },
      intersectingLabels,
    };
  });
  console.log(`sticky-header baseline: ${JSON.stringify(metrics)}`);
  await panel.screenshot({
    path: testInfo.outputPath('sticky-header-baseline.png'),
  });
});
