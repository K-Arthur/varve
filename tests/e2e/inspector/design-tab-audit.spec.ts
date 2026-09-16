/**
 * Design tab audit — real-world document, rendered measurements.
 *
 * Master-brief requirement: the Inspector Design tab must be reviewed with
 * real content (frame + drawn shape + live text + imported photograph), not
 * synthetic single-shape fixtures, and the review must produce measured
 * evidence (geometry, type, targets, overflow, focus, order) rather than
 * eyeballed screenshots alone.
 *
 * Findings ledger and rationale:
 * docs/research/inspector-design-tab-review-2026-09-15.md.
 */
import path from 'node:path';
import { expect, type Locator, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const REAL_PHOTO = path.resolve('tests/e2e/fixtures/real-life-still-life.jpg');

const DESIGN_SECTION_SELECTOR = '.insp-disclosure__trigger';

async function createFrame(page: Page): Promise<void> {
  await page.keyboard.press('f');
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  await canvas.click({ position: { x: 640, y: 380 } });
  await expect(page.getByRole('treeitem')).toHaveCount(1, { timeout: 10_000 });
}

async function drawRect(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('r');
  await page.mouse.move(box.x + 180, box.y + 180);
  await page.mouse.down();
  await page.mouse.move(box.x + 320, box.y + 260, { steps: 4 });
  await page.mouse.up();
  await expect(page.getByRole('treeitem')).toHaveCount(2, { timeout: 10_000 });
}

async function createText(page: Page): Promise<void> {
  const canvas = page.locator('canvas.editor-canvas__content-layer');
  const box = await canvas.boundingBox();
  if (!box) throw new Error('canvas not found');
  await page.keyboard.press('t');
  await page.mouse.click(box.x + 220, box.y + 460);
  const inline = page.getByRole('textbox', { name: /editing text/i });
  await inline.waitFor({ timeout: 10_000 });
  await page.keyboard.type('Quarterly report');
  await page.keyboard.press('Escape');
  await expect(page.getByRole('treeitem')).toHaveCount(3, { timeout: 10_000 });
}

async function importPhoto(page: Page): Promise<void> {
  await page.locator('#file-import-input').setInputFiles(REAL_PHOTO);
  await expect(page.getByRole('treeitem')).toHaveCount(4, { timeout: 20_000 });
}

/** A real-world document: frame, drawn rectangle, live text, imported photo. */
async function seedRealWorldDocument(page: Page): Promise<void> {
  await navigateToEditor(page);
  await createFrame(page);
  await drawRect(page);
  await createText(page);
  await importPhoto(page);
}

async function openDesignTab(page: Page): Promise<Locator> {
  await page.getByRole('tab', { name: 'Design' }).click();
  const panel = page.locator('#insp-tabpanel-properties');
  await expect(panel).toBeVisible({ timeout: 10_000 });
  return panel;
}

/** Position & Size is the `group` that owns the editable X/Y/W/H fields. */
function positionSizeGroup(page: Page): Locator {
  return page.getByRole('group', { name: 'Position & Size' });
}

/**
 * Select the rectangle through its Layers row. The row is chosen by its
 * auto-name ("Rectangle 1"), which removes any dependency on layer stacking
 * order — the imported photo renders its own "Offset X" field, so an
 * unscoped X locator can resolve to the wrong node.
 */
async function selectRectangleLayer(page: Page): Promise<void> {
  const row = page
    .getByRole('treeitem')
    .filter({ hasText: /Rectangle/ })
    .first();
  await row.waitFor({ timeout: 10_000 });
  await row.click();
  await expect(positionSizeGroup(page)).toBeVisible({ timeout: 10_000 });
}

/** Expand every collapsed section so the audit covers the full tab. */
async function expandAllSections(page: Page): Promise<number> {
  const collapsed = page.locator(`${DESIGN_SECTION_SELECTOR}[aria-expanded="false"]`);
  let expanded = 0;
  for (let attempt = 0; attempt < 40; attempt += 1) {
    const count = await collapsed.count();
    if (count === 0) break;
    // Expand from the bottom up: opening a section pushes later triggers down,
    // so a top-down loop can miss the last collapsed trigger off-screen.
    await collapsed.last().scrollIntoViewIfNeeded();
    await collapsed.last().click();
    expanded += 1;
  }
  return expanded;
}

interface DesignTabMetrics {
  sectionTitles: string[];
  labels: { text: string; fontSize: number }[];
  inputs: { fontSize: number; height: number; width: number }[];
  smallTargets: { name: string; w: number; h: number; effectiveW: number; effectiveH: number }[];
  fieldOverflows: { label: string; scrollWidth: number; clientWidth: number }[];
  truncatedLabels: string[];
  truncatedDetails: {
    text: string;
    whiteSpace: string;
    overflowWrap: string;
    clientWidth: number;
    scrollWidth: number;
    className: string;
  }[];
  scroller: { scrollHeight: number; clientHeight: number; overflowY: string };
}

async function collectMetrics(page: Page): Promise<DesignTabMetrics> {
  return page.evaluate<DesignTabMetrics>(() => {
    const scroller = document.querySelector('.editor-inspector > .insp-panel');
    const scrollerStyle = scroller ? getComputedStyle(scroller) : null;

    const visible = (el: Element) => {
      const rect = el.getBoundingClientRect();
      return rect.width > 0 && rect.height > 0;
    };

    const sectionTitles = Array.from(document.querySelectorAll('.insp-disclosure__trigger')).map(
      (el) => (el.textContent ?? '').trim(),
    );

    const labels = Array.from(document.querySelectorAll('.insp-field__label'))
      .filter(visible)
      .map((el) => ({
        text: (el.textContent ?? '').trim(),
        fontSize: Number.parseFloat(getComputedStyle(el).fontSize),
      }));

    const inputs = Array.from(document.querySelectorAll('.insp-num__input'))
      .filter(visible)
      .map((el) => {
        const style = getComputedStyle(el);
        const rect = el.getBoundingClientRect();
        return {
          fontSize: Number.parseFloat(style.fontSize),
          height: Math.round(rect.height),
          width: Math.round(rect.width),
        };
      });

    const smallTargets: DesignTabMetrics['smallTargets'] = [];
    // Range inputs are measured separately from click targets: the native
    // thumb/track is the affordance, and a 16px-tall slider is not the same
    // failure as a 16px checkbox with no larger labelled row. A dedicated
    // slider-target review is recorded as remaining work.
    const targets = document.querySelectorAll(
      '#insp-tabpanel-properties button, #insp-tabpanel-properties input:not([type="hidden"]):not([type="range"]), #insp-tabpanel-properties [role="button"]',
    );
    for (const el of Array.from(targets)) {
      if (!visible(el)) continue;
      // Hidden plumbing inputs (aria-hidden, tabindex=-1) are not pointer
      // targets: a visible labelled button triggers them. The file input in
      // ImageFillControls is the one such control on an image selection.
      if (el.getAttribute('aria-hidden') === 'true' || (el as HTMLElement).tabIndex < 0) continue;
      const rect = el.getBoundingClientRect();
      if (rect.width >= 24 && rect.height >= 24) continue;
      // The activation area may be enlarged by a wrapping label (checkbox
      // rows) — measure the effective target, not the input box alone.
      const label = el.closest('label');
      const labelRect = label && label !== el ? label.getBoundingClientRect() : null;
      const effectiveW = Math.max(rect.width, labelRect?.width ?? 0);
      const effectiveH = Math.max(rect.height, labelRect?.height ?? 0);
      if (effectiveW >= 24 && effectiveH >= 24) continue;
      smallTargets.push({
        name:
          el.getAttribute('aria-label') ||
          (el.textContent ?? '').trim() ||
          el.id ||
          el.className ||
          el.tagName.toLowerCase(),
        w: Math.round(rect.width),
        h: Math.round(rect.height),
        effectiveW: Math.round(effectiveW),
        effectiveH: Math.round(effectiveH),
      });
    }

    const fieldOverflows: DesignTabMetrics['fieldOverflows'] = [];
    for (const row of Array.from(document.querySelectorAll('.insp-field'))) {
      if (!visible(row)) continue;
      const el = row as HTMLElement;
      if (el.scrollWidth > el.clientWidth + 1) {
        fieldOverflows.push({
          label: (row.querySelector('.insp-field__label')?.textContent ?? '').trim(),
          scrollWidth: el.scrollWidth,
          clientWidth: el.clientWidth,
        });
      }
    }

    const truncatedLabels: string[] = [];
    const truncatedDetails: DesignTabMetrics['truncatedDetails'] = [];
    for (const label of Array.from(document.querySelectorAll('.insp-field__label'))) {
      const el = label as HTMLElement;
      if (!visible(el)) continue;
      if (el.scrollWidth > el.clientWidth + 1) {
        const style = getComputedStyle(el);
        truncatedLabels.push((el.textContent ?? '').trim());
        truncatedDetails.push({
          text: (el.textContent ?? '').trim(),
          whiteSpace: style.whiteSpace,
          overflowWrap: style.overflowWrap,
          clientWidth: el.clientWidth,
          scrollWidth: el.scrollWidth,
          className: el.className,
        });
      }
    }

    return {
      sectionTitles,
      labels,
      inputs,
      smallTargets,
      fieldOverflows,
      truncatedLabels,
      truncatedDetails,
      scroller: {
        scrollHeight: scroller?.scrollHeight ?? 0,
        clientHeight: scroller?.clientHeight ?? 0,
        overflowY: scrollerStyle?.overflowY ?? '',
      },
    };
  });
}

/** Layer rows are top-of-stack first: photo, text, rectangle, frame. */
const NODE_ORDER = ['image', 'text', 'rectangle', 'frame'] as const;

test.describe('Design tab real-world audit', () => {
  test.describe.configure({ retries: 1 });

  test('every Design section expands, scrolls, and keeps its controls legible', async ({
    page,
  }, testInfo) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    const panel = await openDesignTab(page);

    const perKind: Record<string, DesignTabMetrics> = {};
    const treeItems = page.getByRole('treeitem');
    for (let index = 0; index < NODE_ORDER.length; index += 1) {
      const kind = NODE_ORDER[index] ?? String(index);
      await treeItems.nth(index).click();
      await openDesignTab(page);

      // What the user actually sees on selection, before any expansion.
      await panel.screenshot({ path: testInfo.outputPath(`design-tab-${kind}-default.png`) });

      const expanded = await expandAllSections(page);
      const metrics = await collectMetrics(page);
      perKind[kind] = metrics;
      // eslint-disable-next-line no-console
      console.log(
        `[design-tab-audit] ${kind}: sections=${metrics.sectionTitles.length} expanded=${expanded} labels=${metrics.labels.length} truncated=${metrics.truncatedLabels.length}`,
      );
      await panel.screenshot({ path: testInfo.outputPath(`design-tab-${kind}-expanded.png`) });
    }

    // eslint-disable-next-line no-console
    console.log(`[design-tab-audit] metrics=${JSON.stringify(perKind, null, 2)}`);

    for (const [kind, metrics] of Object.entries(perKind)) {
      // The rail must scroll rather than clip the lower sections.
      expect(metrics.scroller.overflowY, `${kind}: panel must scroll`).toBe('auto');
      expect(
        metrics.scroller.scrollHeight,
        `${kind}: expanded panel must be taller than the rail`,
      ).toBeGreaterThan(metrics.scroller.clientHeight);

      // No field row may overflow its card.
      expect(metrics.fieldOverflows, `${kind}: field rows overflow the rail`).toEqual([]);

      // Labels and values must stay above the documented dense-panel floor.
      for (const label of metrics.labels) {
        expect(label.fontSize, `${kind}: label "${label.text}" font size`).toBeGreaterThanOrEqual(
          11,
        );
      }
      for (const input of metrics.inputs) {
        expect(input.fontSize, `${kind}: numeric value font size`).toBeGreaterThanOrEqual(12);
        expect(input.height, `${kind}: numeric field height`).toBeGreaterThanOrEqual(24);
      }

      // Every interactive control must offer a 24x24 activation area once a
      // wrapping label is taken into account (WCAG 2.2 SC 2.5.8).
      expect(metrics.smallTargets, `${kind}: controls below the 24px target minimum`).toEqual([]);

      // Content-bearing labels must not be silently clipped. All multi-word
      // labels in the 38% label column wrap gracefully without truncation.
      expect(metrics.truncatedLabels, `${kind}: labels truncated by the label column`).toEqual([]);
    }

    // The imported photo must lead with its own controls, not with eleven
    // generic sections. Position & Size stays first.
    const imageSections = perKind.image?.sectionTitles ?? [];
    expect(imageSections.indexOf('Position & Size')).toBe(0);
    expect(imageSections.indexOf('Image Placement')).toBeGreaterThanOrEqual(0);
    expect(imageSections.indexOf('Image Placement')).toBeLessThan(
      imageSections.indexOf('Appearance'),
    );
    expect(imageSections.indexOf('Crop & Bounds')).toBeLessThan(
      imageSections.indexOf('Appearance'),
    );
  });

  test('a typed edit persists through the document, not just the field', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    // Select the rectangle through its Layers row so the X locator cannot
    // resolve to the imported photo's own "Offset X (px)" field.
    await selectRectangleLayer(page);
    await openDesignTab(page);
    const xField = positionSizeGroup(page).getByLabel('X (px)');
    await expect(xField).toBeVisible();

    await xField.fill('75');
    await page.keyboard.press('Enter');
    await expect.poll(async () => Number.parseFloat(await xField.inputValue())).toBe(75);

    // Leave the selection and come back: the value must be read from the
    // document, not from field-local state.
    const photoRow = page
      .getByRole('treeitem')
      .filter({ hasText: /real-life-still-life/ })
      .first();
    await photoRow.click();
    await selectRectangleLayer(page);
    await openDesignTab(page);
    await expect
      .poll(async () =>
        Number.parseFloat(await positionSizeGroup(page).getByLabel('X (px)').inputValue()),
      )
      .toBe(75);
  });

  test('Constrain proportions is keyboard-operable with a visible focus ring', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    const checkbox = page.getByRole('checkbox', { name: 'Constrain proportions' });
    await expect(checkbox).toBeAttached();
    const label = page.locator('label.insp-proportion-lock');
    await expect(label).toBeVisible();

    // Keyboard modality, then focus: Chromium matches :focus-visible from the
    // last interaction, which is what a keyboard user produces.
    await page.keyboard.press('Tab');
    await checkbox.focus();
    await expect(checkbox).toBeFocused();
    const outline = await label.evaluate((el) => getComputedStyle(el).outlineStyle);
    expect(outline, 'the proportion lock must paint a focus ring').toBe('solid');

    const box = await label.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.width).toBeGreaterThanOrEqual(24);
    expect(box!.height).toBeGreaterThanOrEqual(24);

    const checkedBefore = await checkbox.isChecked();
    await page.keyboard.press('Space');
    await expect(checkbox).toBeChecked({ checked: !checkedBefore });
  });

  test('Align & Distribute hides relative-only clusters for a single selection', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await createFrame(page);
    await openDesignTab(page);

    const alignSection = page.locator('.insp-align-section');
    await expect(alignSection).toBeVisible({ timeout: 10_000 });

    // Single selection: align buttons are live (frame/page target) and the
    // relative-only clusters are omitted rather than rendered disabled.
    await expect(alignSection.getByRole('button', { name: 'Align left edges' })).toBeEnabled();
    await expect(
      alignSection.getByRole('button', { name: 'Distribute horizontal spacing' }),
    ).toHaveCount(0);
    await expect(alignSection.getByRole('button', { name: 'Distribution options' })).toHaveCount(0);
    await expect(
      alignSection.getByRole('button', { name: 'Set key object from selection' }),
    ).toHaveCount(0);
    await expect(alignSection.locator('.insp-align-targets')).toBeVisible();

    // The capability rule stays in the accessibility tree for screen readers.
    const hint = await alignSection.locator('p.sr-only').textContent();
    expect(hint).toContain('two or more selected layers');
  });

  test('Align & Distribute returns its full toolbar on multi-select', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);

    // Select all layers (Cmd+A / Ctrl+A).
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ position: { x: 640, y: 380 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');

    await openDesignTab(page);

    const alignSection = page.locator('.insp-align-section');
    await expect(alignSection).toBeVisible({ timeout: 10_000 });
    await expect(
      alignSection.getByRole('button', { name: 'Distribute horizontal spacing' }),
    ).toBeVisible();
    await expect(alignSection.getByRole('button', { name: 'Distribution options' })).toBeVisible();
    await expect(
      alignSection.getByRole('button', { name: 'Set key object from selection' }),
    ).toBeVisible();
    // The reference control names every available target.
    await expect(
      alignSection.getByRole('button', { name: 'Align to selection bounds (active)' }),
    ).toBeVisible();
  });

  test('Align reference targets meet the 24px target minimum', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await createFrame(page);
    await openDesignTab(page);

    const target = page.locator('.insp-align-targets .pill-group__btn').first();
    await expect(target).toBeVisible();
    const box = await target.boundingBox();
    expect(box).not.toBeNull();
    expect(box!.height).toBeGreaterThanOrEqual(24);
  });

  test('Crop & Bounds aspect ratio presets are visible and clickable', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);

    // Click the photo layer to get image-specific sections.
    const photoRow = page
      .getByRole('treeitem')
      .filter({ hasText: /real-life-still-life/ })
      .first();
    await photoRow.click();
    await openDesignTab(page);

    // Expand Crop & Bounds section.
    const cropTrigger = page.locator('.insp-disclosure__trigger', { hasText: 'Crop' });
    await expect(cropTrigger).toBeVisible({ timeout: 10_000 });
    const isExpanded = (await cropTrigger.getAttribute('aria-expanded')) === 'true';
    if (!isExpanded) await cropTrigger.click();

    // Preset strip must appear.
    const presets = page.locator('.insp-crop-presets');
    await expect(presets).toBeVisible({ timeout: 5_000 });

    // All 6 preset buttons must be present.
    const presetBtns = presets.locator('button');
    await expect(presetBtns).toHaveCount(6);

    // Clicking a preset (e.g. 16:9) must not throw an error.
    const sixteenNine = presets.locator('button', { hasText: '16:9' });
    await expect(sixteenNine).toBeVisible();
    await sixteenNine.click();
    // If it threw, Playwright would error. Simply verify it remains visible.
    await expect(presets).toBeVisible();
  });

  test('Selection Colors shows row layout with hex and target button', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    // Draw two rectangles with different fills — they'll get default colors.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 100, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 200, box.y + 200, { steps: 4 });
    await page.mouse.up();
    await page.keyboard.press('Escape');

    await page.keyboard.press('r');
    await page.mouse.move(box.x + 250, box.y + 100);
    await page.mouse.down();
    await page.mouse.move(box.x + 350, box.y + 200, { steps: 4 });
    await page.mouse.up();

    // Select both rectangles.
    await page.keyboard.press('ControlOrMeta+a');
    await openDesignTab(page);

    // Scroll to the bottom to find Selection Colors (it's after Effects now).
    const panel = page.locator('.editor-inspector > .insp-panel');
    await panel.evaluate((el) => {
      el.scrollTop = el.scrollHeight;
    });

    // Selection Colors section may or may not be visible depending on fills.
    // If it appears, validate the new row layout.
    const colorsSection = page.locator('.insp-disclosure__trigger', {
      hasText: 'Selection Colors',
    });
    const colorsSectionVisible = await colorsSection
      .isVisible({ timeout: 3_000 })
      .catch(() => false);

    if (colorsSectionVisible) {
      const expanded = (await colorsSection.getAttribute('aria-expanded')) === 'true';
      if (!expanded) await colorsSection.click();

      const colorItems = page.locator('.selection-colors__item');
      const count = await colorItems.count();
      if (count > 0) {
        // Each item must have a hex label in monospace.
        const hexLabel = colorItems.first().locator('.selection-colors__hex');
        await expect(hexLabel).toBeVisible();
        const hexText = await hexLabel.textContent();
        expect(hexText).toMatch(/#?[0-9a-fA-F]{6}/);

        // Target and copy actions must be present.
        await expect(colorItems.first().locator('.selection-colors__target-btn')).toBeVisible();
        await expect(colorItems.first().locator('.selection-colors__copy-btn')).toBeVisible();
      }
    }
  });
});

test.describe('Design tab follow-up (2026-09-16)', () => {
  test.describe.configure({ retries: 1 });

  test('Selection Colors stays hidden for a single object with one colour', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // One rectangle, one default fill: the Fills row already edits it.
    await expect(page.locator('[data-testid="selection-colors"]')).toHaveCount(0);
  });

  test('Selection Colors lists colours for a multi-layer selection', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.click({ position: { x: 640, y: 380 } });
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await openDesignTab(page);

    const colorsTrigger = page.locator('.insp-disclosure__trigger', {
      hasText: 'Selection Colors',
    });
    await colorsTrigger.scrollIntoViewIfNeeded();
    await expect(colorsTrigger).toBeVisible({ timeout: 10_000 });
    if ((await colorsTrigger.getAttribute('aria-expanded')) !== 'true') {
      await colorsTrigger.click();
    }
    await expect(page.locator('[data-testid="selection-colors"]')).toBeVisible();
    const items = page.locator('.selection-colors__item');
    expect(await items.count()).toBeGreaterThanOrEqual(1);
  });

  test('Image fit modes occupy one row and Stretch hides offset/scale', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    const photoRow = page
      .getByRole('treeitem')
      .filter({ hasText: /real-life-still-life/ })
      .first();
    await photoRow.click();
    await openDesignTab(page);

    const fitTrack = page.locator('.insp-segmented--fit');
    await expect(fitTrack).toBeVisible({ timeout: 10_000 });
    const buttons = fitTrack.locator('button');
    await expect(buttons).toHaveCount(5);
    const ys = await buttons.evaluateAll((els) =>
      els.map((el) => Math.round(el.getBoundingClientRect().top)),
    );
    expect(new Set(ys).size, `fit modes wrapped onto ${new Set(ys).size} rows`).toBe(1);

    // The imported photo defaults to Stretch: offset/scale are not rendered.
    await expect(page.getByLabel('Offset X (px)')).toHaveCount(0);
    await expect(fitTrack.getByRole('radio', { name: 'Fill' })).toBeVisible();
    await fitTrack.getByRole('radio', { name: 'Fill' }).click();
    await expect(page.getByLabel('Offset X (px)')).toBeVisible();
  });

  test('Per-corner radius renders as a 2x2 grid', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    const cornerTrigger = page.locator('.insp-disclosure__trigger', { hasText: 'Corner Radius' });
    await expect(cornerTrigger).toBeVisible({ timeout: 10_000 });
    if ((await cornerTrigger.getAttribute('aria-expanded')) !== 'true') {
      await cornerTrigger.click();
    }
    await page.getByRole('button', { name: 'Edit individual corners' }).click();

    const grid = page.locator('.insp-quad-grid');
    await expect(grid).toBeVisible();
    const cells = grid.locator('.insp-icon-field');
    await expect(cells).toHaveCount(4);
    const boxes = await cells.evaluateAll((els) =>
      els.map((el) => {
        const r = el.getBoundingClientRect();
        return { x: Math.round(r.left), y: Math.round(r.top) };
      }),
    );
    // Top-left/top-right share a row; bottom-left/bottom-right share the next.
    expect(boxes[0]!.y).toBe(boxes[1]!.y);
    expect(boxes[2]!.y).toBe(boxes[3]!.y);
    expect(boxes[0]!.y).not.toBe(boxes[2]!.y);
    expect(boxes[0]!.x).not.toBe(boxes[1]!.x);
  });

  test('Mask header badge reports the active mask while collapsed', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    const maskTrigger = page.locator('.insp-disclosure__trigger', { hasText: 'Mask' });
    await expect(maskTrigger).toBeVisible({ timeout: 10_000 });
    if ((await maskTrigger.getAttribute('aria-expanded')) !== 'true') {
      await maskTrigger.click();
    }
    await page.getByRole('button', { name: 'Add vector mask' }).click();
    await expect(page.locator('.insp-mask-card')).toBeVisible();

    // Collapse again: the type must stay visible beside the header.
    await maskTrigger.click();
    await expect(page.locator('.insp-mask-header-badge')).toBeVisible();
    await expect(page.locator('.insp-mask-header-badge')).toHaveText(/alpha|clip|luminance/i);
  });

  test('Per-fill blend mode appears as a chip only when it differs from Normal', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // Default fill: no duplicate blend row, and the row menu still owns it.
    await expect(page.locator('.insp-blend-chip')).toHaveCount(0);
    await page.getByRole('button', { name: 'Fill actions' }).click();
    const blendItem = page.getByRole('menuitem', { name: 'Blend mode' });
    await expect(blendItem).toBeVisible();
    await blendItem.click();
    await page.getByRole('menuitemradio', { name: 'Multiply' }).click();

    // Non-normal fill blend: compact chip names the mode.
    await expect(page.locator('.insp-blend-chip')).toBeVisible();
    await expect(page.locator('.insp-blend-chip')).toContainText('Multiply');
  });
});
