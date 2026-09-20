/**
 * Real-editor regression coverage for Inspector rail responsiveness.
 *
 * These scenarios use the real editor shell, a drawn shape, and an imported
 * photograph. They measure the live DOM at multiple rail widths so geometry
 * contracts are verified against the actual editor rather than fixtures only.
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

async function createFrame(page: Page): Promise<void> {
  await page.keyboard.press('f');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 640, y: 380 } });
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
    const fitTransform = document.querySelector('.insp-image-fill__fit-transform-group');
    const fitTransformFields = fitTransform
      ? [...fitTransform.querySelectorAll<HTMLElement>(':scope > .insp-field')].map((field) =>
          rectOf(field),
        )
      : [];
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
      fitTransformFields,
    };
  });
}

test('Position & Size keeps equal value columns across Inspector widths', async ({
  page,
}, testInfo) => {
  // Keep the CSS viewport equivalent to the normal 1440px editor while the
  // page is rendered at 200%; this isolates component reflow from the shell's
  // physical-window minimums.
  await page.setViewportSize({ width: 2880, height: 1800 });
  await navigateToEditor(page);
  await drawRectangle(page);
  await openDesign(page);

  const position = page.getByRole('group', { name: 'Position & Size' });
  await expect(position).toBeVisible();
  const samples: Record<number, unknown> = {};
  const expectedInspectorRowHeight = await page.locator('.editor-inspector').evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).getPropertyValue('--insp-row-height')),
  );
  for (const width of RAILS) {
    await setRail(page, width);
    await position.scrollIntoViewIfNeeded();
    const metrics = await position.evaluate((group) => {
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
    expect(metrics.overflow).toBeLessThanOrEqual(1);
    const byLabel = (label: string) =>
      metrics.fields.find((field) => field.label === label && field.input !== null);
    for (const field of metrics.fields) {
      if (!field.input) continue;
      expect(field.input.height).toBe(expectedInspectorRowHeight);
    }
    // The values fill equal columns (X/Y, then W/H around the action gutter);
    // the retired 9ch rail cap is intentionally gone for this section.
    const [x, y, w, h] = ['X', 'Y', 'W', 'H'].map(byLabel);
    if (x?.input && y?.input) {
      expect(Math.abs(x.input.width - y.input.width)).toBeLessThanOrEqual(1);
      expect(x.input.left).toBeLessThan(y.input.left);
    }
    if (w?.input && h?.input) {
      expect(Math.abs(w.input.width - h.input.width)).toBeLessThanOrEqual(1);
      expect(w.input.left).toBeLessThan(h.input.left);
    }
    samples[width] = metrics;
  }
  console.log(`position-size responsive: ${JSON.stringify(samples)}`);
  await page.screenshot({
    path: testInfo.outputPath('position-size-baseline.png'),
    fullPage: false,
  });
});

test('image Fill and placement controls compose without duplicate Fit or overflow', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await page.locator('#file-import-input').setInputFiles(PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 20_000 });
  await page.getByRole('treeitem').first().click();
  await openDesign(page);
  await expect(page.locator('.insp-image-fill__preview-img')).toBeVisible({ timeout: 15_000 });
  await expect(page.getByRole('combobox', { name: /image fit/i })).toHaveCount(1);
  const imagePlacement = page.getByRole('group', { name: 'Image Placement' });
  await expect(imagePlacement).toBeVisible();
  await expect(imagePlacement.getByRole('combobox', { name: /image fit/i })).toHaveCount(0);

  const samples: Record<number, unknown> = {};
  for (const width of RAILS) {
    await setRail(page, width);
    const metrics = await surfaceMetrics(page);
    const fill = metrics.groups.find((group) => group.title === 'Fill');
    expect(fill).toBeDefined();
    expect((fill?.scrollWidth ?? 0) - (fill?.clientWidth ?? 0)).toBeLessThanOrEqual(1);
    const preview = metrics.controls.find((control) =>
      String(control.className).includes('insp-image-fill__preview'),
    );
    expect(preview).toBeDefined();
    expect(preview?.rect.width ?? 0).toBeLessThanOrEqual(321);
    expect(metrics.fitTransformFields).toHaveLength(2);
    const [fitField, transformField] = metrics.fitTransformFields;
    if (width >= 320) {
      expect(Math.abs((fitField?.top ?? 0) - (transformField?.top ?? 0))).toBeLessThanOrEqual(1);
    } else {
      expect(transformField?.top ?? 0).toBeGreaterThan(fitField?.bottom ?? 0);
    }
    samples[width] = metrics;
    await page.screenshot({
      path: testInfo.outputPath(`image-rail-${width}.png`),
      fullPage: false,
    });
  }
  console.log(`image-rail baseline: ${JSON.stringify(samples)}`);
});

test('frame geometry and Stack / Grid keep stable inspector rails', async ({ page }, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await createFrame(page);
  await openDesign(page);

  const position = page.getByRole('group', { name: 'Position & Size' });
  const layout = page.getByRole('group', { name: 'Stack / Grid' });
  await expect(position).toBeVisible();
  await expect(layout).toBeVisible();

  const samples: Record<number, unknown> = {};
  const expectedInspectorRowHeight = await page.locator('.editor-inspector').evaluate((el) =>
    Number.parseFloat(getComputedStyle(el).getPropertyValue('--insp-row-height')),
  );
  for (const width of RAILS) {
    await setRail(page, width);
    const geometry = await position.evaluate((section) => {
      const rectOf = (element: Element) => {
        const rect = element.getBoundingClientRect();
        return {
          left: rect.left,
          right: rect.right,
          top: rect.top,
          width: rect.width,
          height: rect.height,
        };
      };
      const input = (name: RegExp) => {
        const field = [...section.querySelectorAll<HTMLElement>('.insp-field')].find((candidate) =>
          name.test(candidate.querySelector('.insp-field__label')?.textContent ?? ''),
        );
        return field?.querySelector('input') ? rectOf(field.querySelector('input')!) : null;
      };
      const group = section.querySelector<HTMLElement>('.insp-field-group--position');
      const sizeGroup = section.querySelector<HTMLElement>('.insp-field-group--size');
      const sizeActions = sizeGroup?.querySelector<HTMLElement>('.insp-size-actions');
      return {
        x: input(/^X/),
        y: input(/^Y/),
        width: input(/^W/),
        height: input(/^H/),
        sizeActions: sizeActions ? rectOf(sizeActions) : null,
        sizeRight: sizeGroup ? rectOf(sizeGroup).right : null,
        overflow: group ? group.scrollWidth - group.clientWidth : 0,
      };
    });
    expect(geometry.overflow).toBeLessThanOrEqual(1);
    expect(geometry.x).not.toBeNull();
    expect(geometry.y).not.toBeNull();
    expect(geometry.width).not.toBeNull();
    expect(geometry.height).not.toBeNull();
    // X/Y are equal halves of the row, and W/H are equal halves around the
    // action gutter; Y and H end on the same panel edge.
    expect(Math.abs((geometry.x?.width ?? 0) - (geometry.y?.width ?? 0))).toBeLessThanOrEqual(1);
    expect(
      Math.abs((geometry.width?.width ?? 0) - (geometry.height?.width ?? 0)),
    ).toBeLessThanOrEqual(1);
    expect(Math.abs((geometry.y?.right ?? 0) - (geometry.height?.right ?? 0))).toBeLessThanOrEqual(
      1,
    );
    expect(Math.abs((geometry.y?.right ?? 0) - (geometry.sizeRight ?? 0))).toBeLessThanOrEqual(1);
    expect(geometry.x?.left ?? 0).toBeLessThan(geometry.y?.left ?? 0);
    // The size actions sit in the gutter between W and H, never overlapping
    // either value.
    const gutter = geometry.sizeActions;
    expect(gutter).not.toBeNull();
    expect(gutter!.left).toBeGreaterThanOrEqual((geometry.width?.right ?? 0) - 1);
    expect(gutter!.right).toBeLessThanOrEqual((geometry.height?.left ?? 0) + 1);

    const layoutMetrics = await layout.evaluate((section) => {
      const fields = [...section.querySelectorAll<HTMLElement>('.insp-field')];
      const inputs = [
        ...section.querySelectorAll<HTMLElement>('.insp-layout-sizing .insp-num__input'),
      ];
      const sizing = section.querySelector<HTMLElement>('.insp-layout-sizing');
      const sizingStyle = sizing ? getComputedStyle(sizing) : null;
      const spacingProbe = document.createElement('div');
      spacingProbe.style.position = 'absolute';
      spacingProbe.style.marginBlockStart = 'var(--space-2)';
      spacingProbe.style.paddingBlockStart = 'var(--space-2)';
      document.body.append(spacingProbe);
      spacingProbe.style.rowGap = 'var(--space-1)';
      const space1 = getComputedStyle(spacingProbe).rowGap;
      spacingProbe.style.rowGap = 'var(--space-2)';
      const space2 = getComputedStyle(spacingProbe).rowGap;
      const tokenSpacing = {
        space1,
        space2,
      };
      spacingProbe.remove();
      return {
        overflow: section.scrollWidth - section.clientWidth,
        fieldHeights: fields.map((field) => field.getBoundingClientRect().height),
        inputWidths: inputs.map((input) => input.getBoundingClientRect().width),
        sizing: sizingStyle
          ? {
              marginBlockStart: sizingStyle.marginBlockStart,
              paddingBlockStart: sizingStyle.paddingBlockStart,
              gap: sizingStyle.rowGap,
            }
          : null,
        tokenSpacing,
      };
    });
    expect(layoutMetrics.overflow).toBeLessThanOrEqual(1);
    expect(
      layoutMetrics.fieldHeights.every(
        (height) => Math.abs(height - expectedInspectorRowHeight) <= 0.5,
      ),
    ).toBe(true);
    // The sizing numerics (Min/Max W and H) fill shared pair columns, so the
    // two inputs in each row are equal instead of each fitting its own label
    // and value range. The two rows are independent groups, so their label
    // columns may differ by the label text width (measured 3px).
    expect(layoutMetrics.inputWidths.length).toBeGreaterThanOrEqual(4);
    expect(
      Math.max(...layoutMetrics.inputWidths) - Math.min(...layoutMetrics.inputWidths),
    ).toBeLessThanOrEqual(4);
    expect(layoutMetrics.sizing).toEqual({
      marginBlockStart: layoutMetrics.tokenSpacing.space2,
      paddingBlockStart: layoutMetrics.tokenSpacing.space2,
      gap: layoutMetrics.tokenSpacing.space2,
    });
    samples[width] = { geometry, layout: layoutMetrics };
    if (width === 240 || width === 400 || width === 640) {
      await page.screenshot({
        path: testInfo.outputPath(`frame-rail-${width}.png`),
        fullPage: false,
      });
    }
  }

  console.log(`frame responsive inspector: ${JSON.stringify(samples)}`);
  await page.screenshot({
    path: testInfo.outputPath('frame-position-layout.png'),
    fullPage: false,
  });
});

test('Frame inspector keeps its geometry contract at 200% text scale', async ({
  page,
}, testInfo) => {
  await page.setViewportSize({ width: 1440, height: 900 });
  await navigateToEditor(page);
  await createFrame(page);
  await openDesign(page);
  await setRail(page, 320);

  // A root-font-size increase exercises rem-relative labels and spacing while
  // keeping the desktop shell in the viewport. It is distinct from canvas
  // zoom and from a browser's device-pixel scaling.
  await page.evaluate(() => {
    (document.documentElement as HTMLElement).style.fontSize = '200%';
  });
  await page.waitForTimeout(250);

  const metrics = await page.evaluate(() => {
    const position = document.querySelector<HTMLElement>(
      '.insp-disclosure:has(.insp-field-group--position)',
    );
    const panel = document.querySelector<HTMLElement>('.editor__inspector-panel');
    const group = position?.querySelector<HTMLElement>('.insp-field-group--position');
    const inputs = [...(position?.querySelectorAll<HTMLElement>('.insp-num__input') ?? [])];
    return {
      panelOverflow: panel ? panel.scrollWidth - panel.clientWidth : null,
      groupOverflow: group ? group.scrollWidth - group.clientWidth : null,
      fieldHeights: inputs.map((input) => input.getBoundingClientRect().height),
    };
  });

  expect(metrics.panelOverflow).not.toBeNull();
  expect(metrics.panelOverflow ?? 0).toBeLessThanOrEqual(1);
  expect(metrics.groupOverflow).not.toBeNull();
  expect(metrics.groupOverflow ?? 0).toBeLessThanOrEqual(1);
  expect(metrics.fieldHeights.every((height) => height >= 31 && height <= 64)).toBe(true);
  await page.screenshot({
    path: testInfo.outputPath('frame-text-200.png'),
    fullPage: false,
  });

  await page.evaluate(() => {
    (document.documentElement as HTMLElement).style.fontSize = '';
  });
});

test('sticky section headers own the Inspector scroller inset', async ({ page }, testInfo) => {
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
  expect(Math.abs(metrics.header.top - metrics.scroller.top)).toBeLessThanOrEqual(0.5);
  expect(metrics.intersectingLabels).toEqual([]);
  await panel.screenshot({
    path: testInfo.outputPath('sticky-header-baseline.png'),
  });
});
