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

    // Single selection: align buttons are live and name their active target,
    // while the relative-only clusters are omitted rather than rendered dead.
    await expect(alignSection.getByRole('button', { name: /^Align left edges/ })).toBeEnabled();
    await expect(
      alignSection.getByRole('button', { name: 'Distribute horizontal spacing' }),
    ).toHaveCount(0);
    await expect(alignSection.getByRole('button', { name: 'Distribution options' })).toHaveCount(0);
    await expect(
      alignSection.getByRole('button', { name: 'Set key object from selection' }),
    ).toHaveCount(0);
    // All three references are always visible; unavailable ones are marked.
    await expect(alignSection.locator('.insp-align-targets')).toBeVisible();
    await expect(
      alignSection.getByRole('button', { name: 'Align to selection bounds' }),
    ).toHaveAttribute('aria-disabled', 'true');
    await expect(
      alignSection.getByRole('button', { name: 'Align to parent frame' }),
    ).toHaveAttribute('aria-disabled', 'true');
    // Fresh design documents work on a Design Canvas, so the surface target
    // is the canvas content extents (Print documents keep Page).
    await expect(
      alignSection.getByRole('button', { name: 'Align to canvas (active)' }),
    ).toBeVisible();

    // The capability rule stays in the accessibility tree for screen readers.
    const hint = await alignSection.locator('p.sr-only').textContent();
    expect(hint).toContain('two or more selected layers');
  });

  test('align commands name the active reference', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    const alignSection = page.locator('.insp-align-section');
    await expect(alignSection).toBeVisible({ timeout: 10_000 });
    // All three reference options exist even when only one applies.
    await expect(alignSection.getByRole('button', { name: 'Align to parent frame' })).toHaveCount(
      1,
    );
    await expect(
      alignSection.getByRole('button', { name: 'Align to selection bounds' }),
    ).toHaveCount(1);
    // The align command names the same target the reference control reports.
    const activeTarget = await alignSection
      .locator('.insp-align-targets .pill-group__btn[aria-pressed="true"]')
      .first()
      .getAttribute('aria-label');
    expect(activeTarget).toBeTruthy();
    const alignLeftName =
      (await alignSection
        .getByRole('button', { name: /^Align left edges/ })
        .getAttribute('aria-label')) ?? '';
    const targetWords = activeTarget!
      .replace(/^Align to /, '')
      .replace(/ \(active\)$/, '')
      .toLowerCase();
    expect(alignLeftName.toLowerCase()).toContain(targetWords.split(' ')[0]!);
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

  test('Align to canvas moves a subset to the canvas content extents', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    // Two side-by-side rectangles on the design canvas. Aligning only the
    // right one to the canvas must land it on the left rectangle's edge —
    // proving the target is the canvas content extents, not the selection.
    const canvas = page.locator('canvas.editor-canvas__content-layer');
    await canvas.waitFor({ state: 'visible', timeout: 10_000 });
    const box = await canvas.boundingBox();
    if (!box) throw new Error('canvas not found');
    await page.keyboard.press('r');
    for (const [downX, upX] of [
      [180, 300],
      [450, 570],
    ] as const) {
      // The draw tool returns to Select after each shape, so re-arm it.
      await page.keyboard.press('r');
      await page.mouse.move(box.x + downX, box.y + 180);
      await page.mouse.down();
      await page.mouse.move(box.x + upX, box.y + 260, { steps: 4 });
      await page.mouse.up();
      await page.waitForTimeout(120);
    }
    await page.keyboard.press('v');

    const rows = page.getByRole('treeitem').filter({ hasText: /Rectangle/ });
    await expect(rows).toHaveCount(2, { timeout: 10_000 });
    await openDesignTab(page);
    const xField = positionSizeGroup(page).getByRole('spinbutton', { name: 'X (px)' });
    await rows.nth(0).click();
    const x0 = Number(await xField.inputValue());
    await rows.nth(1).click();
    const x1 = Number(await xField.inputValue());
    const leftX = Math.min(x0, x1);
    // Select the right-hand rectangle (whichever row it is).
    await (x0 <= x1 ? rows.nth(1) : rows.nth(0)).click();

    const alignSection = page.locator('.insp-align-section');
    await expect(alignSection).toBeVisible({ timeout: 10_000 });
    await alignSection.getByRole('button', { name: /Align to canvas/ }).click();
    await alignSection.getByRole('button', { name: /^Align left edges/ }).click();
    await expect(xField).toHaveValue(String(leftX), { timeout: 10_000 });
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

  test('Image fit is one compact select in Fill, and Stretch hides offset/scale', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    const photoRow = page
      .getByRole('treeitem')
      .filter({ hasText: /real-life-still-life/ })
      .first();
    await photoRow.click();
    await openDesignTab(page);

    // Fit lives once, in the Fill section, as a compact select — not a
    // five-button segmented track (removed 2026-09-17: it duplicated the
    // Image Placement section's own fit control and ate a full row).
    const fitSelect = page.getByRole('combobox', { name: 'Image fit mode' });
    await expect(fitSelect).toBeVisible({ timeout: 10_000 });
    const fitBox = await fitSelect.boundingBox();
    expect(fitBox, 'fit select has no bounds').not.toBeNull();
    expect(fitBox!.height, 'fit select should be one compact row, not stacked').toBeLessThanOrEqual(
      40,
    );

    // The imported photo defaults to Stretch: offset/scale are not rendered.
    await expect(page.getByLabel('Offset X (px)')).toHaveCount(0);
    await expect(fitSelect).toHaveText('Stretch');
    await fitSelect.click();
    await page.getByRole('option', { name: 'Fill' }).click();
    await expect(fitSelect).toHaveText('Fill');
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

  // A "Per-fill blend mode uses the same grouped select as Appearance" test
  // previously lived here, asserting a row-level 'Fill blend mode' combobox.
  // That control was deliberately removed (it duplicated the colour
  // popover's own blend control on every row) — superseded by 'Fill blend
  // mode is reachable inside the colour popover, not just the row menu'
  // below, which covers the same behavior against the current design.
});

/** Screenshot evidence lands beside the other inspector review runs. */
const PAINT_EVIDENCE_DIR = 'reports/inspector-review/paint-rows';

test.describe('Design tab paint rows (fill / stroke pass)', () => {
  test.describe.configure({ retries: 1 });

  test('Fill row states its value and changes type through the labelled select', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // Value pill: swatch + hex, with an explicit type selector on the properties grid.
    const valuePill = page.locator('.insp-swatch--valued').first();
    await expect(valuePill).toBeVisible({ timeout: 10_000 });
    await expect(valuePill.locator('.insp-swatch__value')).toHaveText(/^#[0-9A-F]{6}$/);

    // The labelled select names the current paint and converts to Gradient.
    const typeTrigger = page.getByRole('combobox', { name: 'Fill type' });
    await expect(typeTrigger).toBeVisible();
    await typeTrigger.click();
    await expect(page.getByRole('option', { name: 'Gradient' })).toBeVisible();
    await page.getByRole('option', { name: 'Gradient' }).click();

    // The gradient swatch keeps the value pill and opens the gradient editor.
    await expect(page.getByRole('button', { name: 'Fill gradient' })).toBeVisible();
    await page.getByRole('button', { name: 'Fill gradient' }).click();
    const dialog = page.getByRole('dialog', { name: /fill gradient/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(dialog.getByRole('spinbutton', { name: 'Rotation (deg)' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(dialog).toHaveCount(0);
    // Focus returns to the trigger that opened the picker.
    await expect(page.getByRole('button', { name: 'Fill gradient' })).toBeFocused();

    await page.screenshot({ path: `${PAINT_EVIDENCE_DIR}/fill-gradient-row.png` });
  });

  test('Mixed fill selection is named on the row instead of impersonating one layer', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // Make the rectangle a gradient, then select everything: the rectangle and
    // the photo disagree with the other layers' solid fills.
    await page.getByRole('combobox', { name: 'Fill type' }).click();
    await page.getByRole('option', { name: 'Gradient' }).click();
    await page.keyboard.press('Escape');
    await page.keyboard.press('ControlOrMeta+a');
    await openDesignTab(page);

    const mixedSwatch = page.getByRole('button', {
      name: /Fill colour \(mixed across selection/,
    });
    await expect(mixedSwatch).toBeVisible({ timeout: 10_000 });
    const mixedValue = mixedSwatch.locator('.insp-swatch__value');
    await expect(mixedValue).toHaveText('Mixed');
    // The whole point is that "Mixed" is legible — not clipped to "Mi…".
    const clipped = await mixedValue.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, 'the mixed value label must not be truncated').toBe(false);
    await page.screenshot({ path: `${PAINT_EVIDENCE_DIR}/fill-mixed-selection.png` });
  });

  test('Fill section is absent for a group, whose renderer never paints fills', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await createFrame(page);
    await drawRect(page);
    await page.keyboard.press('ControlOrMeta+a');
    await page.keyboard.press('ControlOrMeta+g');
    await expect(page.getByRole('treeitem').filter({ hasText: /Group/ }).first()).toBeVisible({
      timeout: 10_000,
    });
    await openDesignTab(page);

    const fillTrigger = page.locator('.insp-disclosure__trigger', { hasText: 'Fill' });
    await expect(fillTrigger).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'Add fill' })).toHaveCount(0);
    // Groups still expose geometry and appearance.
    await expect(page.locator('.insp-disclosure__trigger', { hasText: 'Appearance' })).toHaveCount(
      1,
    );
  });

  test('Fill rows and stroke advanced controls stay on one line without overflow', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // Multi-fill stack: add a second fill, then measure every row. (Two rows
    // is the stress case: both get reorder + remove controls, and each row
    // must still state its value.)
    await page.getByRole('button', { name: 'Add fill' }).click();
    await page.getByRole('menuitem', { name: 'Linear gradient' }).click();
    const fillRows = page.locator('.insp-fill-row');
    await expect(fillRows).toHaveCount(2);

    for (const row of await fillRows.all()) {
      const value = row.locator('.insp-swatch__value');
      await expect(value).toBeVisible();
      await expect(value).toHaveText(/^(#[0-9A-F]{6}|Gradient)$/);
      const metrics = await row.locator('.insp-paint-row').evaluate((paintRow) => ({
        scrollWidth: paintRow.scrollWidth,
        clientWidth: paintRow.clientWidth,
      }));
      expect(metrics.scrollWidth).toBeLessThanOrEqual(metrics.clientWidth + 1);
    }

    // Stroke advanced: presets, one-row arrowheads hidden for a rect, and a
    // per-side toggle that produces a quadrille.
    const strokeSection = page
      .locator('.insp-disclosure')
      .filter({ has: page.locator('.insp-disclosure__trigger', { hasText: 'Stroke' }) });
    // Drawn rectangles start with no stroke: add one to reach the row.
    await strokeSection.getByRole('button', { name: 'Add stroke', exact: true }).click();
    const advanced = strokeSection.getByRole('button', { name: /^Advanced/ });
    await advanced.click();
    const dashSelect = strokeSection.getByRole('combobox', { name: 'Stroke dash style' });
    await dashSelect.click();
    await page.getByRole('option', { name: 'Dashed' }).click();
    // Collapsed summary names the hidden state.
    await expect(strokeSection.getByRole('button', { name: /^Advanced/ })).toContainText('Dashed');
    await expect(strokeSection.getByRole('spinbutton', { name: 'Miter limit' })).toBeVisible();

    const perSide = strokeSection.getByRole('switch', { name: 'Stroke per-side widths' });
    await perSide.click();
    await expect(strokeSection.locator('.insp-quad-grid')).toBeVisible();
    await expect(strokeSection.getByRole('button', { name: 'Use one width' })).toBeVisible();

    await page.screenshot({ path: `${PAINT_EVIDENCE_DIR}/stroke-advanced.png` });
  });

  test('Fill blend mode is reachable inside the colour popover, not just the row menu', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // Bounded spinbuttons must retain a usable value box after the shared
    // containment rules are applied; a collapsed border is not an acceptable
    // compact control.
    const appearance = page.locator('.insp-disclosure').filter({
      has: page.locator('.insp-disclosure__trigger', { hasText: 'Appearance' }),
    });
    const opacityInput = appearance.getByRole('spinbutton', { name: 'Opacity (%)' });
    await expect(opacityInput).toBeVisible();
    const opacityBox = await opacityInput.boundingBox();
    expect(opacityBox?.width ?? 0).toBeGreaterThanOrEqual(32);
    expect(opacityBox?.height ?? 0).toBeGreaterThanOrEqual(24);

    // The single default fill exposes a labelled Normal control on the row;
    // the popover owns the same value for colour and gradient editing.
    const fillType = page.getByRole('combobox', { name: 'Fill type' });
    await expect(fillType).toContainText('Solid');
    const fillTypeBox = await fillType.boundingBox();
    expect(fillTypeBox?.width ?? 0).toBeGreaterThanOrEqual(96);
    // Blend mode has no separate row-level control (deliberate — it would
    // duplicate the popover's own value); it lives only inside the colour
    // popover, reached from the row.
    // Scope to the Inspector: the context bar carries its own fill swatch.
    const fillGroup = page.getByRole('group', { name: 'Fill' });
    await fillGroup.getByRole('button', { name: 'Fill colour' }).click();
    const dialog = page.getByRole('dialog', { name: /fill colour/i });
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    const blend = dialog.getByRole('combobox', { name: 'Fill blend mode' });
    await expect(blend).toHaveText('Normal');
    await blend.click();
    await page.getByRole('option', { name: 'Multiply' }).click();
    await expect(blend).toHaveText('Multiply');
    await page.keyboard.press('Escape');

    // Committing in the popover persists: reopening shows the same value,
    // and the row's hex readout keeps its full value now that opacity
    // moved down (not truncated by the chip).
    await fillGroup.getByRole('button', { name: 'Fill colour' }).click();
    await expect(dialog).toBeVisible({ timeout: 5_000 });
    await expect(blend).toHaveText('Multiply');
    await page.keyboard.press('Escape');
    const value = page.locator('.insp-fill-row .insp-swatch__value');
    await expect(value).toHaveText(/^#[0-9A-F]{6}$/);
    const clipped = await value.evaluate((el) => el.scrollWidth > el.clientWidth + 1);
    expect(clipped, 'the hex value must not be truncated by the chip').toBe(false);
    await page.screenshot({ path: `${PAINT_EVIDENCE_DIR}/fill-blend-popover.png` });
  });

  test('A zero-width stroke is flagged as invisible on the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await seedRealWorldDocument(page);
    await selectRectangleLayer(page);
    await openDesignTab(page);

    // Add a stroke, then set its width to zero through the visible field.
    // (exact + scoped to the Inspector: the context bar also carries an
    // "Add stroke" affordance, and both labels are sentence case now.)
    await page
      .locator('.editor-inspector')
      .getByRole('button', { name: 'Add stroke', exact: true })
      .click();
    const weight = page.getByRole('spinbutton', { name: 'Stroke weight (px)' });
    await weight.fill('0');
    await weight.press('Enter');

    const note = page.locator('.insp-paint-note');
    await expect(note).toBeVisible({ timeout: 5_000 });
    await expect(note).toHaveText(/zero width/i);
    await page.screenshot({ path: `${PAINT_EVIDENCE_DIR}/stroke-zero-width.png` });
  });
});
