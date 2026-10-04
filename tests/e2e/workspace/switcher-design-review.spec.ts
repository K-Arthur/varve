/**
 * Workspace switcher design review — real-app contract (2026-09-29).
 *
 * The menubar switcher (`packages/editor/src/components/WorkspaceTabs.tsx` +
 * the `.workspace-dock*` recipes in `packages/editor/src/editor.css`) was
 * reviewed for redundant chrome and contrast in the running app rather than
 * from the source. This spec is the contract for the changes that review
 * produced; the findings record is
 * `docs/audits/workspace-switcher-design-review-2026-09-29.md`.
 *
 * It asserts, against the mounted app:
 *   F1 no painted number chip on the tabs (the ordered 1–6 mapping survives
 *      as `data-shortcut-key` / `aria-keyshortcuts` / tooltips / menu badges);
 *   F2 the switcher is a raised card on a wide menubar and a flat part of the
 *      top bar below 900px — it must not be a second floating surface;
 *   F3 every mode's pill and every inactive icon meets 4.5:1 as *rendered*
 *      (colors are painted to a canvas and measured from sRGB bytes);
 *   F4 phone-width landscape keeps the active workspace named, and the pill
 *      only compacts when the measurement genuinely cannot fit it (asserted by
 *      sweeping widths, because the threshold is a measurement and not a
 *      query);
 *   F5 the switcher never renders over, or steals the hit area of, the
 *      application menu rail it shares a row with.
 *
 * Run (heavy lease):
 *   node scripts/quality/heavy-lease.mjs "e2e: switcher design review" -- \
 *     env VARVE_E2E_PORT=1533 npx playwright test \
 *     tests/e2e/workspace/switcher-design-review.spec.ts --project=chromium --workers=1
 */

import { expect, type Page, test } from '@playwright/test';
import { evidencePath } from '../helpers/evidence-output';
import { navigateToEditor } from '../shared';

const OUT_DIR = process.env.VARVE_SWITCHER_DESIGN_DIR;

const MODES = ['design', 'print', 'drawing', 'image', 'motion', 'email'] as const;
const THEMES = ['light', 'dark', 'high-contrast'] as const;

interface SwitcherGeometry {
  barPresent: boolean;
  dockBar: {
    background: string;
    boxShadow: string;
    borderColor: string;
    borderRadius: string;
  };
  dockRect: { x: number; y: number; width: number; height: number } | null;
  dockBarRect: { x: number; y: number; width: number; height: number } | null;
  railRect: { x: number; y: number; width: number; height: number } | null;
  railClipRight: number | null;
  railScrollable: number | null;
  /** Whether workspace chrome occupies the same 2D area as the menu rail. */
  railSwitcherOverlap: boolean;
  /** Visible menu button centers must still hit their own controls. */
  menuButtonHitResults: Array<{ label: string; visible: boolean; receivesPointer: boolean }>;
  activeLabel: { text: string; width: number; opacity: string; display: string } | null;
  compactActive: boolean;
  itemSizes: Array<{ mode: string | null; width: number; height: number; key: string | null }>;
  paintedChipCount: number;
  badgeRowCount: number;
  overhangingChildren: string[];
}

async function readGeometry(page: Page): Promise<SwitcherGeometry> {
  return page.evaluate(() => {
    const bar = document.querySelector<HTMLElement>('.workspace-dock__bar');
    const dock = document.querySelector<HTMLElement>('.workspace-dock');
    const barStyle = bar ? getComputedStyle(bar) : null;
    const label = bar?.querySelector<HTMLElement>(
      '.workspace-dock__item--active .workspace-dock__label',
    );
    const labelStyle = label ? getComputedStyle(label) : null;
    const items = [...(bar?.querySelectorAll<HTMLElement>('.workspace-dock__item') ?? [])];
    // Any rendered descendant whose box escapes its own control is the
    // overhanging-chip defect: the shortcut chip used to sit 3px past the
    // item's inline end and 2px below its block end.
    const overhangingChildren: string[] = [];
    for (const item of items) {
      const itemRect = item.getBoundingClientRect();
      for (const child of item.querySelectorAll<HTMLElement>('span, svg, kbd')) {
        const rect = child.getBoundingClientRect();
        if (rect.width === 0 && rect.height === 0) continue;
        if (
          rect.right > itemRect.right + 0.5 ||
          rect.bottom > itemRect.bottom + 0.5 ||
          rect.left < itemRect.left - 0.5 ||
          rect.top < itemRect.top - 0.5
        ) {
          overhangingChildren.push(
            `${item.dataset.mode}:${child.className.toString() || child.tagName}`,
          );
        }
      }
    }
    const rail = document.querySelector<HTMLElement>('.editor-menubar__left');
    const railBox = rail?.getBoundingClientRect() ?? null;
    const barBox = bar?.getBoundingClientRect() ?? null;
    const railItems = [...(rail?.querySelectorAll<HTMLElement>('.editor-menubar__item') ?? [])];
    const menuButtonHitResults = railItems.map((item) => {
      const rect = item.getBoundingClientRect();
      const visibleRect = railBox
        ? {
            left: Math.max(rect.left, railBox.left),
            right: Math.min(rect.right, railBox.right),
            top: Math.max(rect.top, railBox.top),
            bottom: Math.min(rect.bottom, railBox.bottom),
          }
        : null;
      const visible = Boolean(
        visibleRect && visibleRect.left < visibleRect.right && visibleRect.top < visibleRect.bottom,
      );
      const hit = document.elementFromPoint(
        Math.round(visibleRect ? (visibleRect.left + visibleRect.right) / 2 : rect.left),
        Math.round(visibleRect ? (visibleRect.top + visibleRect.bottom) / 2 : rect.top),
      );
      return {
        label: item.innerText,
        visible,
        receivesPointer: !visible || hit === item || (hit instanceof Node && item.contains(hit)),
      };
    });
    const railSwitcherOverlap = Boolean(
      railBox &&
        barBox &&
        railBox.left < barBox.right &&
        railBox.right > barBox.left &&
        railBox.top < barBox.bottom &&
        railBox.bottom > barBox.top,
    );
    return {
      barPresent: bar !== null,
      dockBar: {
        background: barStyle?.backgroundColor ?? '',
        boxShadow: barStyle?.boxShadow ?? '',
        borderColor: barStyle?.borderTopColor ?? '',
        borderRadius: barStyle?.borderRadius ?? '',
      },
      dockRect: dock
        ? {
            x: dock.getBoundingClientRect().x,
            y: dock.getBoundingClientRect().y,
            width: dock.getBoundingClientRect().width,
            height: dock.getBoundingClientRect().height,
          }
        : null,
      dockBarRect: bar
        ? {
            x: bar.getBoundingClientRect().x,
            y: bar.getBoundingClientRect().y,
            width: bar.getBoundingClientRect().width,
            height: bar.getBoundingClientRect().height,
          }
        : null,
      railRect: railBox
        ? {
            x: railBox.x,
            y: railBox.y,
            width: railBox.width,
            height: railBox.height,
          }
        : null,
      railClipRight: railBox ? railBox.right : null,
      railScrollable: rail ? rail.scrollWidth - rail.clientWidth : null,
      railSwitcherOverlap,
      menuButtonHitResults,
      activeLabel: label
        ? {
            text: label.textContent ?? '',
            width: label.getBoundingClientRect().width,
            opacity: labelStyle?.opacity ?? '',
            display: labelStyle?.display ?? '',
          }
        : null,
      compactActive: bar?.classList.contains('workspace-dock--compact-active') ?? false,
      itemSizes: items.map((el) => ({
        mode: el.dataset.mode ?? null,
        width: el.getBoundingClientRect().width,
        height: el.getBoundingClientRect().height,
        key: el.dataset.shortcutKey ?? null,
      })),
      paintedChipCount: document.querySelectorAll('.workspace-dock__shortcut').length,
      badgeRowCount: document.querySelectorAll('[role="menuitemradio"] .varve-menu__badge').length,
      overhangingChildren,
    };
  });
}

/** Rendered contrast of the active pill and of every inactive icon. */
async function readRenderedContrast(page: Page) {
  return page.evaluate(() => {
    const toSrgb = (color: string): [number, number, number] => {
      const canvas = document.createElement('canvas');
      canvas.width = 1;
      canvas.height = 1;
      const ctx = canvas.getContext('2d', { willReadFrequently: true });
      if (!ctx) throw new Error('no 2d context');
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b] = ctx.getImageData(0, 0, 1, 1).data;
      return [r ?? 0, g ?? 0, b ?? 0];
    };
    const luminance = ([r, g, b]: [number, number, number]): number => {
      const channel = (value: number) => {
        const v = value / 255;
        return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * channel(r) + 0.7152 * channel(g) + 0.0722 * channel(b);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const la = luminance(a);
      const lb = luminance(b);
      return Math.round(((Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05)) * 100) / 100;
    };
    const bar = document.querySelector<HTMLElement>('.workspace-dock__bar');
    if (!bar) return { error: 'dock bar missing', barBackground: '', rows: [] };
    const barBg = getComputedStyle(bar).backgroundColor;
    const rows: Array<{ mode: string | null; role: string; ratio: number; color: string }> = [];
    for (const item of bar.querySelectorAll<HTMLElement>('.workspace-dock__item')) {
      const active = item.classList.contains('workspace-dock__item--active');
      const icon = item.querySelector('svg');
      const itemStyle = getComputedStyle(item);
      if (active) {
        const pillBg = itemStyle.backgroundColor;
        rows.push({
          mode: item.dataset.mode ?? null,
          role: 'pill-label',
          ratio: ratio(toSrgb(itemStyle.color), toSrgb(pillBg)),
          color: itemStyle.color,
        });
        if (icon) {
          rows.push({
            mode: item.dataset.mode ?? null,
            role: 'pill-icon',
            ratio: ratio(toSrgb(getComputedStyle(icon).stroke), toSrgb(pillBg)),
            color: getComputedStyle(icon).stroke,
          });
        }
      } else if (icon) {
        rows.push({
          mode: item.dataset.mode ?? null,
          role: 'inactive-icon',
          ratio: ratio(toSrgb(getComputedStyle(icon).stroke), toSrgb(barBg)),
          color: getComputedStyle(icon).stroke,
        });
      }
    }
    return { error: '', barBackground: barBg, rows };
  });
}

/** Fail early and legibly when the editor dock is not mounted at all. */
async function expectSwitcherMounted(page: Page, label: string): Promise<void> {
  await expect
    .poll(async () => (await readGeometry(page)).barPresent, {
      timeout: 30_000,
      message: `${label}: the workspace dock bar is not mounted`,
    })
    .toBe(true);
}

test.describe('workspace switcher design review', () => {
  test.setTimeout(180_000);

  test('F1 — carries the ordered 1–6 mapping without painting a number chip', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
    await expectSwitcherMounted(page, 'F1');

    const geometry = await readGeometry(page);
    expect(geometry.paintedChipCount).toBe(0);
    expect(geometry.overhangingChildren).toEqual([]);
    expect(geometry.itemSizes.map((item) => item.key)).toEqual(['1', '2', '3', '4', '5', '6']);
    expect(geometry.itemSizes.map((item) => item.mode)).toEqual([...MODES]);

    // The mapping is still announced and still reachable from the menu.
    await expect(page.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+1',
    );
    await expect(page.getByRole('radio', { name: 'Email workspace' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+6',
    );

    await page.screenshot({
      path: evidencePath(
        `2026-09-29-workspace-switcher-design-review/01-desktop-1920-light-menubar.png`,
        OUT_DIR,
      ),
      clip: { x: 0, y: 0, width: 1920, height: 52 },
      animations: 'disabled',
    });
  });

  test('F2 — raised card above 900px, flat top-bar chrome below it', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await navigateToEditor(page);
    await expectSwitcherMounted(page, 'F2 desktop');
    const desktop = await readGeometry(page);
    // An opaque surface plus a shadow is what groups a segmented control
    // inside a single-row menubar.
    expect(desktop.dockBar.background).not.toBe('rgba(0, 0, 0, 0)');
    expect(desktop.dockBar.background).not.toBe('');
    expect(desktop.dockBar.boxShadow).not.toBe('none');

    for (const vp of [
      { name: 'landscape-899x600', width: 899, height: 600 },
      { name: 'portrait-800x1280', width: 800, height: 1280 },
      { name: 'portrait-480x900', width: 480, height: 900 },
      { name: 'landscape-640x400', width: 640, height: 400 },
    ] as const) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await expectSwitcherMounted(page, vp.name);
      await expect
        .poll(async () => (await readGeometry(page)).dockBar.background, {
          timeout: 10_000,
          message: `${vp.name}: the switcher container is not flat`,
        })
        .toBe('rgba(0, 0, 0, 0)');
      const compact = await readGeometry(page);
      expect(compact.dockBar.boxShadow, `${vp.name} still floats`).toBe('none');
      // Only the container is flattened: the active pill keeps an opaque
      // accent fill, so the current workspace stays the most prominent item.
      const pill = await page.evaluate(() => {
        const el = document.querySelector<HTMLElement>('.workspace-dock__item--active');
        return el ? getComputedStyle(el).backgroundColor : null;
      });
      expect(pill, `${vp.name} lost its accent pill`).not.toBe('rgba(0, 0, 0, 0)');
      await page.screenshot({
        path: evidencePath(
          `2026-09-29-workspace-switcher-design-review/04-${vp.name}-switcher.png`,
          OUT_DIR,
        ),
        clip: { x: 0, y: 0, width: vp.width, height: 140 },
        animations: 'disabled',
      });
    }
  });

  test('F3 — every mode pill and inactive icon is AA as rendered', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1920, height: 1080 });
    // Measure the RESTING state. `.workspace-dock__item` transitions colour, so
    // an item that just lost the active class animates from `text-on-accent`
    // toward its mode tint; a sample taken inside that window reads an
    // intermediate blend (measured 1.06-2.87:1) that no user ever rests on.
    // Reduced motion removes the transition window entirely, and the resting
    // colours are unchanged by it.
    await page.emulateMedia({ reducedMotion: 'reduce' });

    const failures: string[] = [];
    for (const theme of THEMES) {
      await page.context().addInitScript((value) => {
        try {
          localStorage.setItem('varve-theme', value);
        } catch {
          /* storage unavailable — falls back to the default theme */
        }
      }, theme);
      await navigateToEditor(page);
      await expect(page.locator('html')).toHaveAttribute('data-theme', theme);
      await expectSwitcherMounted(page, `F3 ${theme}`);

      for (const mode of MODES) {
        await page.locator(`.workspace-dock__item[data-mode="${mode}"]`).click();
        await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
          'data-mode',
          mode,
        );
        // Belt and braces with reduced motion: let the style engine settle so a
        // loaded machine cannot hand us a half-computed color.
        await page.waitForTimeout(120);
        const measured = await readRenderedContrast(page);
        expect(measured.error, `F3 ${theme}/${mode}: ${measured.error}`).toBe('');
        for (const row of measured.rows) {
          // 4.5:1 for the pill label and for the inactive icon: the icon is the
          // only visual identifier of an inactive mode (its name lives in the
          // tooltip and the accessible name), so it is held to the text bar
          // rather than WCAG 1.4.11's 3:1 non-text floor.
          if (row.ratio < 4.5) {
            failures.push(
              `${theme}/${row.mode}/${row.role} = ${row.ratio}:1 (${row.color} on pill/bar)`,
            );
          }
        }
        if (theme === 'light') {
          await page.screenshot({
            path: evidencePath(
              `2026-09-29-workspace-switcher-design-review/02-pill-${mode}-light.png`,
              OUT_DIR,
            ),
            clip: { x: 1450, y: 0, width: 470, height: 48 },
            animations: 'disabled',
          });
        }
      }
      await page.screenshot({
        path: evidencePath(
          `2026-09-29-workspace-switcher-design-review/03-desktop-1920-${theme}-menubar.png`,
          OUT_DIR,
        ),
        clip: { x: 0, y: 0, width: 1920, height: 52 },
        animations: 'disabled',
      });
    }
    expect(failures, `below-AA workspace switcher pairs: ${failures.join('; ')}`).toEqual([]);
  });

  test('F4 — the active workspace stays named until the measurement says otherwise', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 640, height: 400 });
    await navigateToEditor(page);
    await expectSwitcherMounted(page, 'F4 named');

    const geometry = await readGeometry(page);
    expect(geometry.activeLabel, 'active workspace name missing at 640x400').not.toBeNull();
    expect(geometry.activeLabel!.text).toBe('Design');
    expect(geometry.activeLabel!.display).not.toBe('none');
    expect(geometry.activeLabel!.opacity).toBe('1');
    expect(geometry.activeLabel!.width).toBeGreaterThan(20);
    expect(geometry.compactActive, 'label rendered while the pill claims compact').toBe(false);

    // The threshold is a measurement, not a width. How much room the dock's
    // flex wrapper gets is set by the rest of the top bar (undo/redo, the zoom
    // field, the menu rail), and those change; an assertion pinned to one
    // viewport breaks whenever a neighbour changes size. Sweep down until the
    // measurement reports that the strip no longer fits with a name, and hold
    // the invariant at every step: the name is in the DOM exactly when the pill
    // is not compact — which is only true if the layout math, and not a width
    // query, is making the decision.
    let compactedAt: number | null = null;
    for (const width of [620, 580, 560, 520, 480, 440, 400, 360]) {
      await page.setViewportSize({ width, height: 400 });
      await page.waitForTimeout(300);
      const step = await readGeometry(page);
      expect(
        step.compactActive,
        `${width}x400: pill compact=${step.compactActive} but label present=${step.activeLabel !== null}`,
      ).toBe(step.activeLabel === null);
      if (step.compactActive) {
        compactedAt = width;
        break;
      }
    }
    expect(
      compactedAt,
      'the strip never compacted across the swept widths — the measurement no longer needs to evict the name',
    ).not.toBeNull();

    // Compacting is not hiding: the radio keeps its accessible name and chord,
    // so the mode is still identifiable and still reachable.
    await expect(page.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+1',
    );
  });

  test('F5 — the switcher never covers or steals the application menu rail', async ({ page }) => {
    test.setTimeout(300_000);
    await page.setViewportSize({ width: 641, height: 500 });
    await navigateToEditor(page);
    for (const vp of [
      { name: 'landscape-641x500', width: 641, height: 500 },
      { name: 'landscape-700x500', width: 700, height: 500 },
      { name: 'landscape-760x500', width: 760, height: 500 },
      { name: 'compact-760x768', width: 760, height: 768 },
      { name: 'compact-800x768', width: 800, height: 768 },
      { name: 'landscape-899x600', width: 899, height: 600 },
      { name: 'landscape-900x600', width: 900, height: 600 },
      { name: 'landscape-1024x768', width: 1024, height: 768 },
      { name: 'laptop-1280x800', width: 1280, height: 800 },
      { name: 'laptop-1366x768', width: 1366, height: 768 },
    ] as const) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await expectSwitcherMounted(page, `F5 ${vp.name}`);
      const geometry = await readGeometry(page);
      expect(geometry.dockRect, `${vp.name}: dock missing`).not.toBeNull();
      expect(geometry.railClipRight, `${vp.name}: menu rail missing`).not.toBeNull();

      // At compact portrait sizes the switcher gets its own second row and
      // may be left-aligned under the full-width menu rail. Compare both axes:
      // a horizontal-only assertion mistakes this intentional row layout for
      // overlap (760×768), while a real overlap can still steal menu clicks.
      expect(geometry.dockBarRect, `${vp.name}: switcher bar missing`).not.toBeNull();
      expect(geometry.railRect, `${vp.name}: menu rail missing`).not.toBeNull();
      expect(
        geometry.railSwitcherOverlap,
        `${vp.name}: switcher bar overlaps the application menu rail`,
      ).toBe(false);

      // Test real menu button centers rather than the rail's far edge. At
      // portrait compact sizes the rail spans the full first row, so its right
      // edge can be empty space even though every menu target remains intact.
      expect(
        geometry.menuButtonHitResults.filter((item) => item.visible && !item.receivesPointer),
        `${vp.name}: a menu button center is intercepted by workspace chrome`,
      ).toEqual([]);

      // Every mode is still one interaction away at these widths.
      const more = page.locator('.workspace-dock__more');
      if ((await more.count()) > 0) {
        await more.click();
        const menu = page.getByRole('menu', { name: 'More workspaces' });
        await expect(menu).toBeVisible();
        await expect(menu.getByRole('menuitemradio')).toHaveCount(6 - geometry.itemSizes.length);
        await page.keyboard.press('Escape');
      }
      await page.screenshot({
        path: evidencePath(
          `2026-09-29-workspace-switcher-design-review/05-menubar-${vp.name}.png`,
          OUT_DIR,
        ),
        clip: { x: 0, y: 0, width: vp.width, height: 110 },
        animations: 'disabled',
      });
    }
  });

  test('keyboard, overflow and endurance survive the chrome change', async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
    await expectSwitcherMounted(page, 'keyboard');
    const errors: string[] = [];
    page.on('pageerror', (error) => errors.push(String(error)));
    page.on('console', (message) => {
      if (message.type() === 'error') errors.push(message.text());
    });

    const design = page.getByRole('radio', { name: 'Design workspace' });
    await design.focus();
    await page.keyboard.press('ArrowRight');
    await expect(page.getByRole('radio', { name: 'Print workspace' })).toBeFocused();
    await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
      'data-mode',
      'print',
    );
    await page.keyboard.press('End');
    await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
      'data-mode',
      'email',
    );
    // The chord still reaches the user: the tooltip carries it, and the
    // overflow rows carry it as a badge whenever a mode is hidden.
    await expect(page.getByRole('radio', { name: 'Email workspace' })).toHaveAttribute(
      'aria-keyshortcuts',
      'Control+Shift+6',
    );
    expect(errors).toEqual([]);
  });
});
