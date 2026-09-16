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
});
