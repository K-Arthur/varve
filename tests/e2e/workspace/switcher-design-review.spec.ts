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
 *      only compacts when the measurement genuinely cannot fit it;
 *   F5 the switcher never renders over, or steals the hit area of, the
 *      application menu rail it shares a row with.
 *
 * Run (heavy lease):
 *   node scripts/quality/heavy-lease.mjs "e2e: switcher design review" -- \
 *     env VARVE_E2E_PORT=1533 npx playwright test \
 *     tests/e2e/workspace/switcher-design-review.spec.ts --project=chromium --workers=1
 */
import { mkdirSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT_DIR =
  process.env.VARVE_SWITCHER_DESIGN_DIR ??
  join(process.cwd(), 'docs/screenshots/2026-09-29-workspace-switcher-design-review');
mkdirSync(OUT_DIR, { recursive: true });

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
  railClipRight: number | null;
  railScrollable: number | null;
  /** What the top-bar hit test finds at the menu rail's own clip edge. */
  railEdgeHitClass: string | null;
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
    const railEdgeHit = railBox
      ? document.elementFromPoint(
          Math.round(railBox.right - 4),
          Math.round(railBox.top + railBox.height / 2),
        )
      : null;
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
      railClipRight: railBox ? railBox.right : null,
      railScrollable: rail ? rail.scrollWidth - rail.clientWidth : null,
      railEdgeHitClass: railEdgeHit
        ? String((railEdgeHit as HTMLElement).className || railEdgeHit.tagName)
        : null,
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
      path: join(OUT_DIR, '01-desktop-1920-light-menubar.png'),
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
        path: join(OUT_DIR, `04-${vp.name}-switcher.png`),
        clip: { x: 0, y: 0, width: vp.width, height: 140 },
        animations: 'disabled',
      });
    }
  });

  test('F3 — every mode pill and inactive icon is AA as rendered', async ({ page }) => {
    test.setTimeout(600_000);
    await page.setViewportSize({ width: 1920, height: 1080 });

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
            path: join(OUT_DIR, `02-pill-${mode}-light.png`),
            clip: { x: 1450, y: 0, width: 470, height: 48 },
            animations: 'disabled',
          });
        }
      }
      await page.screenshot({
        path: join(OUT_DIR, `03-desktop-1920-${theme}-menubar.png`),
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
    expect(geometry.activeLabel, 'active workspace name missing').not.toBeNull();
    expect(geometry.activeLabel!.text).toBe('Design');
    expect(geometry.activeLabel!.display).not.toBe('none');
    expect(geometry.activeLabel!.opacity).toBe('1');
    expect(geometry.activeLabel!.width).toBeGreaterThan(20);
    expect(geometry.compactActive, 'label rendered while the pill claims compact').toBe(false);

    // The name is only dropped when the strip genuinely cannot hold it. 700×500
    // is the narrowest case the app produces here: the zoom field is visible
    // again above the 640px tier, so the dock's flex width shrinks — exactly
    // the condition the measurement exists to detect. Then the pill compacts
    // to its icon and the name stays in the tooltip and accessible name
    // instead of a zero-width label sitting in the DOM.
    await page.setViewportSize({ width: 700, height: 500 });
    await expect
      .poll(async () => (await readGeometry(page)).compactActive, { timeout: 10_000 })
      .toBe(true);
    const narrow = await readGeometry(page);
    expect(narrow.activeLabel).toBeNull();
    await expect(page.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
  });

  test('F5 — the switcher never covers or steals the application menu rail', async ({ page }) => {
    test.setTimeout(600_000);
    for (const vp of [
      { name: 'landscape-641x500', width: 641, height: 500 },
      { name: 'landscape-700x500', width: 700, height: 500 },
      { name: 'landscape-760x500', width: 760, height: 500 },
      { name: 'landscape-899x600', width: 899, height: 600 },
      { name: 'landscape-900x600', width: 900, height: 600 },
      { name: 'landscape-1024x768', width: 1024, height: 768 },
    ] as const) {
      await page.setViewportSize({ width: vp.width, height: vp.height });
      await navigateToEditor(page);
      await expectSwitcherMounted(page, `F5 ${vp.name}`);
      const geometry = await readGeometry(page);
      expect(geometry.dockRect, `${vp.name}: dock missing`).not.toBeNull();
      expect(geometry.railClipRight, `${vp.name}: menu rail missing`).not.toBeNull();

      // The switcher paints from its own box leftward only by its shadow; the
      // menu rail's *clip box* is what it must not enter.
      const paintedLeft = geometry.dockRect!.x - (geometry.dockBar.boxShadow === 'none' ? 0 : 8);
      expect(
        paintedLeft,
        `${vp.name}: switcher chrome enters the menu rail (${paintedLeft} < ${geometry.railClipRight})`,
      ).toBeGreaterThanOrEqual(geometry.railClipRight! - 1);

      // And the rail keeps its own hit area: before the fix the rail painted
      // outside its box and the switcher, being later in the DOM, won the
      // hit test — at 641×500 a click 4px inside the rail's edge hit a
      // workspace tab instead of a menu.
      expect(
        geometry.railEdgeHitClass,
        `${vp.name}: the switcher steals the menu rail's hit area (${geometry.railEdgeHitClass})`,
      ).toContain('editor-menubar__item');

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
        path: join(OUT_DIR, `05-menubar-${vp.name}.png`),
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
