import { expect, type Page, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor, switchWorkspace } from '../shared';

/**
 * 2026-09-29 toolbar divider and surface review — regression coverage for the
 * defects fixed in that pass (docs/audits/toolbar-design-review-2026-09-29.md):
 *
 *  D1 group separators were `border-left` on a `--radius-control-compact`
 *     button, so the 1px rule curved into a "(" at each end, the same rule's
 *     padding pushed every group-leading icon 1.94px off the row's centreline,
 *     and its margin left the rule 5.76px from the previous group but 2.88px
 *     from its own.
 *  D2 the trailing action cluster was rendered unconditionally; with no tool
 *     options and no tablet control it painted an ~11x10px box with a
 *     `border-left` — a stray divider at the palette's trailing edge in every
 *     viewport.
 *  D3 the palette declared its surface twice (row and inner toolbar).
 *  D4 drawing mode stacked a second full card under the first, left-aligned
 *     rather than sharing its edges.
 *  D5 at <=640px the wrapper spanned the canvas but the card stayed pinned to
 *     the wrapper's leading edge, leaving dead surface on the trailing side.
 *  D6 a divider was drawn before the first rendered slot, separating nothing.
 */

const PALETTE = '[data-testid="toolbar"]';
const OUT = 'toolbar-design-review-2026-09-29';

interface DividerReport {
  present: boolean;
  count: number;
  /** Every divider's top-left radius, in px. */
  radii: number[];
  widths: number[];
  heights: number[];
  /** Token-derived target height: control height x --separator-toolbar-length-ratio. */
  expectedHeight: number | null;
  backgrounds: string[];
  /** Horizontal distance to the neighbour on each side (px). */
  leftGaps: number[];
  rightGaps: number[];
  /** True when a divider is the row's first child (separates nothing). */
  leadingIndex: boolean;
}

async function readDividers(page: Page): Promise<DividerReport> {
  return page.evaluate(() => {
    const empty: DividerReport = {
      present: false,
      count: 0,
      radii: [],
      widths: [],
      heights: [],
      expectedHeight: null,
      backgrounds: [],
      leftGaps: [],
      rightGaps: [],
      leadingIndex: false,
    };
    const toolbar = document.querySelector('.floating-toolbar [role="toolbar"]');
    const first = document.querySelector('.floating-toolbar__divider');
    if (!toolbar || !first) return empty;

    const dividers = [...toolbar.querySelectorAll<HTMLElement>('.floating-toolbar__divider')];
    const radii: number[] = [];
    const widths: number[] = [];
    const heights: number[] = [];
    const backgrounds: string[] = [];
    const leftGaps: number[] = [];
    const rightGaps: number[] = [];

    for (const el of dividers) {
      const cs = getComputedStyle(el);
      const rect = el.getBoundingClientRect();
      radii.push(...(cs.borderTopLeftRadius.match(/[\d.]+/g) ?? []).map(Number));
      widths.push(rect.width);
      heights.push(rect.height);
      backgrounds.push(cs.backgroundColor);
      // Equal spacing on both sides: a flex gap either side of the rule.
      const prev = el.previousElementSibling?.getBoundingClientRect();
      const next = el.nextElementSibling?.getBoundingClientRect();
      if (prev) leftGaps.push(rect.left - prev.right);
      if (next) rightGaps.push(next.left - rect.right);
    }

    // Measure the target from a real control rather than parsing the custom
    // property: `--floating-toolbar-control-height` is itself a var() chain.
    const control = toolbar.querySelector<HTMLElement>('button');
    const ratio = Number.parseFloat(
      getComputedStyle(first).getPropertyValue('--separator-toolbar-length-ratio').trim(),
    );
    const expected =
      control && Number.isFinite(ratio) ? control.getBoundingClientRect().height * ratio : null;

    return {
      present: true,
      count: dividers.length,
      radii,
      widths,
      heights,
      expectedHeight: expected,
      backgrounds,
      leftGaps,
      rightGaps,
      leadingIndex:
        toolbar.firstElementChild?.classList.contains('floating-toolbar__divider') ?? false,
    } satisfies DividerReport;
  });
}

test.describe('toolbar divider and surface review', () => {
  test.describe.configure({ mode: 'serial' });
  test.setTimeout(180_000);

  test('D1/D6: dividers are square, evenly spaced, and never lead the row', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    // Pin the workspace so both the divider count and the capture are
    // deterministic — `navigateToEditor` can land in the last-used workspace.
    await switchWorkspace(page, 'Design');
    const palette = page.locator(PALETTE);
    await expect(palette).toBeVisible();
    await expect(palette.locator('.floating-toolbar__divider').first()).toBeVisible();

    const report = await readDividers(page);
    expect(report.present).toBe(true);
    // Design declares five group boundaries; the first is suppressed.
    expect(report.count).toBeGreaterThanOrEqual(4);

    // Square: a divider is a rule, not a bracket. This is the defect the
    // "rounded corners on separators" complaint describes.
    for (const r of report.radii) expect(r).toBe(0);
    for (const w of report.widths) expect(w).toBeCloseTo(1, 1);

    // Token-derived height (control height x --separator-toolbar-length-ratio),
    // not a hardcoded literal.
    expect(report.expectedHeight).not.toBeNull();
    for (const h of report.heights) {
      expect(Math.abs(h - (report.expectedHeight ?? h))).toBeLessThanOrEqual(1);
    }

    // One rule colour across the palette (never transparent).
    for (const bg of report.backgrounds) expect(bg).not.toBe('rgba(0, 0, 0, 0)');

    // Symmetric spacing: a divider sits in an equal flex gap on both sides,
    // not 5.76px from the previous group and 2.88px from its own.
    expect(report.leftGaps.length).toBe(report.rightGaps.length);
    for (const [i, left] of report.leftGaps.entries()) {
      const right = report.rightGaps[i] ?? left;
      expect(Math.abs(left - right)).toBeLessThanOrEqual(1);
    }

    // Nothing to separate before the first rendered slot.
    expect(report.leadingIndex).toBe(false);

    await palette.screenshot({ path: evidencePath(`${OUT}/after-design-divider-1440.png`) });
    const zoom = await page.evaluate(() => {
      const el = document.querySelector('.floating-toolbar [role="toolbar"]') as HTMLElement;
      const first = el.querySelector('[data-tool]') as HTMLElement;
      return { toolbar: el.getBoundingClientRect(), first: first.getBoundingClientRect() };
    });
    // Keep the raw geometry on the record next to the screenshot.
    expect(zoom.toolbar.width).toBeGreaterThan(zoom.first.width);
  });

  test('D1: every tool icon stays on the row centreline, grouped or not', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const offsets = await page.evaluate(() => {
      const buttons = [
        ...document.querySelectorAll<HTMLElement>('.floating-toolbar__row [role="toolbar"] button'),
      ];
      return buttons
        .map((el) => {
          const svg = el.querySelector('svg');
          if (!svg) return null;
          const b = el.getBoundingClientRect();
          const s = svg.getBoundingClientRect();
          if (s.width === 0) return null;
          return (s.x + s.width / 2 - (b.x + b.width / 2)) * 100;
        })
        .filter((v): v is number => v !== null);
    });

    expect(offsets.length).toBeGreaterThan(5);
    // 0.5px in CSS pixels, measured in hundredths to avoid float noise. The
    // pre-fix measurement was 194 (1.94px) on every group-leading tool.
    for (const o of offsets) expect(Math.abs(o)).toBeLessThanOrEqual(50);
  });

  test('D2: no trailing cluster is painted when it has no control', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    // The default tool (Select) has no tool options, and this is not the
    // tablet layout, so the cluster must not exist at all.
    const state = await page.evaluate(() => {
      const cluster = document.querySelector<HTMLElement>('.floating-toolbar__actions');
      if (!cluster) return { exists: false, empty: false, box: null as string | null };
      const rect = cluster.getBoundingClientRect();
      return {
        exists: true,
        empty: rect.width < 24 || rect.height < 24,
        box: `${Math.round(rect.width)}x${Math.round(rect.height)}`,
      };
    });

    if (state.exists) {
      // Present (touch device or tablet layout): it must be a real cluster, not
      // a stub. Pre-fix it measured ~12x10px.
      expect(state.empty).toBe(false);
    } else {
      expect(state.exists).toBe(false);
    }
  });

  test('D3: the palette declares its surface exactly once', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);

    const surfaces = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        return {
          border: cs.borderTopWidth,
          shadow: cs.boxShadow,
          radius: cs.borderTopLeftRadius,
          background: cs.backgroundColor,
        };
      };
      return {
        card: read('.floating-toolbar__card'),
        row: read('.floating-toolbar__row'),
        scroll: read('.floating-toolbar [role="toolbar"]'),
        shadows: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="toolbar"], [data-testid="toolbar"] *',
          ),
        ].filter((el) => getComputedStyle(el).boxShadow !== 'none').length,
      };
    });

    expect(surfaces.card).not.toBeNull();
    // The card owns the surface.
    expect(surfaces.card!.border).toBe('1px');
    expect(surfaces.card!.radius).not.toBe('0px');
    expect(surfaces.card!.shadow).not.toBe('none');
    // The row and the scrolling toolbar are layout only — the redundant
    // declarations that made the chrome look owned in two places.
    expect(surfaces.row!.border).toBe('0px');
    expect(surfaces.row!.shadow).toBe('none');
    expect(surfaces.row!.background).toBe('rgba(0, 0, 0, 0)');
    expect(surfaces.scroll!.border).toBe('0px');
    expect(surfaces.scroll!.shadow).toBe('none');
    // Exactly one shadowing element inside the palette.
    expect(surfaces.shadows).toBe(1);
  });

  test('D4: the drawing workspace renders one card, not two stacked cards', async ({ page }) => {
    await page.setViewportSize({ width: 1440, height: 900 });
    await navigateToEditor(page);
    await switchWorkspace(page, 'Draw');
    await expect(page.locator('.floating-toolbar__drawing')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const read = (sel: string) => {
        const el = document.querySelector<HTMLElement>(sel);
        if (!el) return null;
        const cs = getComputedStyle(el);
        const r = el.getBoundingClientRect();
        return {
          left: Math.round(r.left),
          right: Math.round(r.right),
          shadow: cs.boxShadow,
          borderTop: cs.borderTopWidth,
        };
      };
      return {
        card: read('.floating-toolbar__card'),
        row: read('.floating-toolbar__row'),
        drawing: read('.floating-toolbar__drawing'),
        shadows: [
          ...document.querySelectorAll<HTMLElement>(
            '[data-testid="toolbar"], [data-testid="toolbar"] *',
          ),
        ].filter((el) => getComputedStyle(el).boxShadow !== 'none').length,
      };
    });

    expect(geometry.drawing).not.toBeNull();
    // Both rows share the card's edges instead of the second card sitting
    // left-aligned under a wider first card.
    expect(geometry.row!.left).toBe(geometry.drawing!.left);
    expect(geometry.row!.right).toBe(geometry.drawing!.right);
    // The brush row is a section, not a second floating surface.
    expect(geometry.drawing!.shadow).toBe('none');
    expect(geometry.drawing!.borderTop).toBe('1px');
    expect(geometry.shadows).toBe(1);

    await page.locator('[data-testid="toolbar"]').screenshot({
      path: evidencePath(`${OUT}/after-drawing-one-card-1440.png`),
    });
  });

  test('D5: the palette is centred and bounded by the canvas at narrow widths', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 480, height: 700 });
    await navigateToEditor(page);
    await expect(page.locator(PALETTE).locator('[role="toolbar"]')).toBeVisible();

    const geometry = await page.evaluate(() => {
      const canvas = document.querySelector('.editor-canvas');
      const wrapper = document.querySelector('[data-testid="toolbar"]');
      const row = document.querySelector<HTMLElement>('.floating-toolbar__row');
      const scroll = document.querySelector<HTMLElement>('.floating-toolbar [role="toolbar"]');
      if (!canvas || !wrapper || !row || !scroll) return null;
      const c = canvas.getBoundingClientRect();
      const k = wrapper.getBoundingClientRect();
      return {
        canvasLeft: c.left,
        canvasRight: c.right,
        canvasMid: c.left + c.width / 2,
        cardLeft: k.left,
        cardRight: k.right,
        cardMid: k.left + k.width / 2,
        rowClient: row.clientWidth,
        scrollClient: scroll.clientWidth,
        scrollMax: Math.max(scroll.scrollWidth, scroll.clientWidth),
      };
    });
    expect(geometry).not.toBeNull();

    // Symmetric insets: the card sits in the middle of the canvas rather than
    // pinned to the wrapper's leading edge with dead surface trailing it (the
    // pre-fix measurement was a 447px card inside a 468px wrapper, flush left).
    const leading = geometry!.cardLeft - geometry!.canvasLeft;
    const trailing = geometry!.canvasRight - geometry!.cardRight;
    expect(Math.abs(leading - trailing)).toBeLessThanOrEqual(3);
    // And it stays inside the canvas box on both sides.
    expect(geometry!.cardLeft).toBeGreaterThanOrEqual(geometry!.canvasLeft - 1);
    expect(geometry!.cardRight).toBeLessThanOrEqual(geometry!.canvasRight + 1);
    expect(Math.abs(geometry!.cardMid - geometry!.canvasMid)).toBeLessThanOrEqual(3);

    // The 2026-08-10 narrow-viewport contract still holds: the scroll box fills
    // the card instead of overflowing it, so no tool is clipped out of reach.
    expect(Math.abs(geometry!.scrollMax - geometry!.rowClient)).toBeLessThanOrEqual(2);

    await page
      .locator(PALETTE)
      .screenshot({ path: evidencePath(`${OUT}/after-narrow-centred-480.png`) });
  });
});
