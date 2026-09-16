/**
 * Workspace switcher contract — real-app verification (2026-09-15 review).
 *
 * Runs against the real editor, creates a real document, and drives the real
 * dock: rendered-color contrast for every mode in every theme, radiogroup
 * ownership, overflow reachability and mode switching, APG radio keyboard
 * traversal, the no-JS-magnification hover contract, and the one-document
 * invariant across an eight-mode sweep.
 *
 * Evidence screenshots are written to
 * docs/screenshots/2026-09-15-workspace-switcher-review/after/.
 *
 * Run:
 *   VARVE_E2E_PORT=1441 npx playwright test tests/e2e/workspace/switcher-review.spec.ts --project=chromium
 */
import { mkdirSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { expect, type Page, test } from '@playwright/test';
import { navigateToEditor } from '../shared';

const OUT_ROOT = join(process.cwd(), 'docs/screenshots/2026-09-15-workspace-switcher-review/after');

const MODES = [
  ['design', 'Design'],
  ['drawing', 'Draw'],
  ['image', 'Photo'],
  ['print', 'Print'],
  ['motion', 'Motion'],
  ['codegen', 'Codegen'],
  ['email', 'Email'],
  ['logo', 'Logo'],
] as const;

const THEMES = ['light', 'dark', 'high-contrast'] as const;

declare global {
  interface Window {
    __switcherContrast: () => {
      pillContrast: number;
      labelTruncated: boolean;
      inactive: { mode: string | null; contrastVsBar: number }[];
      barBg: string;
      pillBg: string;
      labelFg: string;
    };
  }
}

/**
 * Installs a page-side contrast probe. Colors are resolved by painting the
 * computed value onto a canvas (the same sRGB path a user sees) and WCAG
 * relative luminance is computed from those bytes — not from the authored
 * token values.
 */
async function installContrastProbe(page: Page) {
  await page.evaluate(() => {
    const parse = (color: string): [number, number, number, number] => {
      const c = document.createElement('canvas');
      c.width = 1;
      c.height = 1;
      const ctx = c.getContext('2d');
      if (!ctx) return [0, 0, 0, 1];
      ctx.fillStyle = color;
      ctx.fillRect(0, 0, 1, 1);
      const [r, g, b, a] = ctx.getImageData(0, 0, 1, 1).data;
      return [r ?? 0, g ?? 0, b ?? 0, (a ?? 255) / 255];
    };
    const blend = (
      fg: [number, number, number, number],
      bg: [number, number, number],
    ): [number, number, number] => {
      if (fg[3] === 0) return bg;
      return [
        Math.round(fg[0] * fg[3] + bg[0] * (1 - fg[3])),
        Math.round(fg[1] * fg[3] + bg[1] * (1 - fg[3])),
        Math.round(fg[2] * fg[3] + bg[2] * (1 - fg[3])),
      ];
    };
    const lum = ([r, g, b]: [number, number, number]): number => {
      const f = (v: number) => {
        const s = v / 255;
        return s <= 0.04045 ? s / 12.92 : ((s + 0.055) / 1.055) ** 2.4;
      };
      return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
    };
    const ratio = (a: [number, number, number], b: [number, number, number]) => {
      const la = lum(a);
      const lb = lum(b);
      return (Math.max(la, lb) + 0.05) / (Math.min(la, lb) + 0.05);
    };

    window.__switcherContrast = () => {
      const bar = document.querySelector('.workspace-dock__bar') as HTMLElement;
      const barRgb = parse(getComputedStyle(bar).backgroundColor);
      const barBg = blend(barRgb, [255, 255, 255]);
      const active = document.querySelector('.workspace-dock__item--active') as HTMLElement;
      const activeCs = getComputedStyle(active);
      const pillBg = blend(parse(activeCs.backgroundColor), barBg);
      const labelEl = active.querySelector('.workspace-dock__label') as HTMLElement | null;
      const labelFg = blend(parse(getComputedStyle(labelEl ?? active).color), pillBg);
      const inactive = [...document.querySelectorAll('.workspace-dock__item')]
        .filter((el) => !el.classList.contains('workspace-dock__item--active'))
        .map((el) => {
          const cs = getComputedStyle(el as HTMLElement);
          const own = blend(parse(cs.backgroundColor), barBg);
          const icon = blend(parse(cs.color), own);
          return {
            mode: (el as HTMLElement).dataset.mode ?? null,
            contrastVsBar: ratio(icon, barBg),
          };
        });
      return {
        pillContrast: ratio(labelFg, pillBg),
        labelTruncated: labelEl ? labelEl.scrollWidth > labelEl.clientWidth + 1 : false,
        inactive,
        barBg: `rgb(${barBg.join(',')})`,
        pillBg: `rgb(${pillBg.join(',')})`,
        labelFg: `rgb(${labelFg.join(',')})`,
      };
    };
  });
}

async function setTheme(page: Page, theme: (typeof THEMES)[number]) {
  await page.evaluate((t) => {
    document.documentElement.dataset.theme = t;
  }, theme);
  await page.waitForTimeout(120);
}

async function workspaceGroup(page: Page) {
  return page.getByRole('radiogroup', { name: 'Workspace' });
}

test.describe.configure({ mode: 'serial' });

test.describe('Workspace switcher contract', () => {
  test.beforeEach(async ({ page }) => {
    await page.setViewportSize({ width: 1920, height: 1080 });
    await navigateToEditor(page);
  });

  test('rendered label contrast passes AA for every mode in every theme', async ({ page }) => {
    const group = await workspaceGroup(page);
    const failures: string[] = [];
    for (const theme of THEMES) {
      await setTheme(page, theme);
      for (const [mode, label] of MODES) {
        await group.getByRole('radio', { name: `${label} workspace` }).click();
        await page.waitForTimeout(120);
        await installContrastProbe(page);
        const m = await page.evaluate(() => window.__switcherContrast());
        if (m.pillContrast < 4.5) {
          failures.push(
            `${theme}/${mode}: pill label contrast ${m.pillContrast.toFixed(2)}:1 ` +
              `(label ${m.labelFg} on ${m.pillBg})`,
          );
        }
        if (m.labelTruncated) failures.push(`${theme}/${mode}: pill label truncated`);
        for (const item of m.inactive) {
          if (item.contrastVsBar < 3) {
            failures.push(
              `${theme}/${mode} -> inactive ${item.mode}: icon contrast ${item.contrastVsBar.toFixed(2)}:1`,
            );
          }
        }
      }
    }
    expect(failures, `Contrast failures:\n${failures.join('\n')}`).toEqual([]);
  });

  test('the radiogroup owns only radios and the overflow trigger is outside it', async ({
    page,
  }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);
    const group = await workspaceGroup(page);
    const children = await group.evaluate((el) =>
      [...el.children].map((c) => c.getAttribute('role') ?? c.tagName.toLowerCase()),
    );
    expect(children.every((role) => role === 'radio')).toBe(true);

    const more = page.getByRole('button', { name: /more workspaces/i });
    await expect(more).toBeVisible();
    const outside = await more.evaluate((el) => !el.closest('[role="radiogroup"]'));
    expect(outside).toBe(true);
    await expect(more).toHaveAttribute('aria-label', /More workspaces \(\d+ hidden\)/);
  });

  test('overflow menu reaches every hidden mode and switches for real', async ({ page }) => {
    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);
    const group = await workspaceGroup(page);
    const visibleLabels = await group.evaluate((el) =>
      [...el.querySelectorAll('[role="radio"]')].map((r) => r.getAttribute('aria-label')),
    );
    const hidden = MODES.filter(([, label]) => !visibleLabels.includes(`${label} workspace`));
    expect(hidden.length).toBeGreaterThan(0);

    const more = page.getByRole('button', { name: /more workspaces/i });
    await more.click();
    const menu = page.getByRole('menu', { name: 'More workspaces' });
    await expect(menu).toBeVisible();
    for (const [, label] of hidden) {
      await expect(menu.getByRole('menuitemradio', { name: label })).toBeVisible();
    }
    // Switching from the menu must change the real editor state, and the
    // activated mode must become the visible checked tab.
    const [targetMode, targetLabel] = hidden[0]!;
    await menu.getByRole('menuitemradio', { name: targetLabel }).click();
    await page.waitForTimeout(300);
    await expect(group.getByRole('radio', { name: `${targetLabel} workspace` })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await expect(page.locator(`.workspace-dock__item--active`)).toHaveAttribute(
      'data-mode',
      targetMode,
    );
  });

  test('keyboard traversal follows the APG radio contract', async ({ page }) => {
    const group = await workspaceGroup(page);
    await group.getByRole('radio', { name: 'Design workspace' }).focus();
    await page.keyboard.press('ArrowRight');
    await expect(group.getByRole('radio', { name: 'Draw workspace' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('ArrowLeft');
    await expect(group.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('End');
    await expect(group.getByRole('radio', { name: 'Logo workspace' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    await page.keyboard.press('Home');
    await expect(group.getByRole('radio', { name: 'Design workspace' })).toHaveAttribute(
      'aria-checked',
      'true',
    );
    // Exactly one tab stop in the group (roving tabindex).
    const tabbable = await group.evaluate(
      (el) => [...el.querySelectorAll('[role="radio"][tabindex="0"]')].length,
    );
    expect(tabbable).toBe(1);
  });

  test('hover feedback does not move or resize any hit target', async ({ page }) => {
    const bar = page.locator('.workspace-dock__bar');
    const box = await bar.boundingBox();
    expect(box).not.toBeNull();

    // offsetWidth of the icon wrapper is the layout size: transforms do not
    // affect it, so it is exactly what the old per-frame `svg.style.width`
    // writes would have changed.
    const layoutSizesBefore = await page.evaluate(() =>
      [...document.querySelectorAll('.workspace-dock__item .workspace-dock__icon')].map(
        (el) => (el as HTMLElement).offsetWidth,
      ),
    );
    const targetPositionsBefore = await page.evaluate(() =>
      [...document.querySelectorAll('.workspace-dock__item')].map((el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.width)];
      }),
    );
    // Pointer moves across several tabs, then rests on one.
    for (const frac of [0.2, 0.4, 0.6, 0.5]) {
      await page.mouse.move(box!.x + box!.width * frac, box!.y + box!.height / 2);
      await page.waitForTimeout(80);
    }
    await page.waitForTimeout(400);
    const layoutSizesAfter = await page.evaluate(() =>
      [...document.querySelectorAll('.workspace-dock__item .workspace-dock__icon')].map(
        (el) => (el as HTMLElement).offsetWidth,
      ),
    );
    const targetPositionsAfter = await page.evaluate(() =>
      [...document.querySelectorAll('.workspace-dock__item')].map((el) => {
        const r = el.getBoundingClientRect();
        return [Math.round(r.x), Math.round(r.width)];
      }),
    );
    expect(layoutSizesAfter).toEqual(layoutSizesBefore);
    expect(targetPositionsAfter).toEqual(targetPositionsBefore);

    // The cue itself is present: exactly the pointed item scales, in place.
    const hoverState = await page.evaluate(() => {
      const states = [...document.querySelectorAll('.workspace-dock__item')].map((item) => ({
        hovered: item.matches(':hover'),
        transform: getComputedStyle(item.querySelector('.workspace-dock__icon')!).transform,
      }));
      return {
        hovered: states.filter((s) => s.hovered).length,
        scaled: states.filter((s) => s.transform !== 'none').length,
      };
    });
    expect(hoverState.hovered).toBe(1);
    expect(hoverState.scaled).toBe(1);
  });

  test('switching every workspace keeps the document and logs no errors', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));
    page.on('console', (msg) => {
      if (msg.type() === 'error') errors.push(msg.text());
    });
    const group = await workspaceGroup(page);
    for (const [, label] of MODES) {
      await group.getByRole('radio', { name: `${label} workspace` }).click();
      await page.waitForTimeout(80);
    }
    await expect(page.locator('.workspace-dock__item--active')).toHaveAttribute(
      'data-mode',
      'logo',
    );
    await expect(page.locator('.editor-menubar__doc-name-text')).toHaveText('Untitled 1');
    await expect(page.locator('.editor-canvas')).toBeVisible();
    const relevant = errors.filter((e) => !/ResizeObserver loop|favicon/i.test(e));
    expect(relevant).toEqual([]);
  });

  test('enlarged text grows the switcher instead of clipping it', async ({ page }) => {
    // Mechanism: the token scale is rem-based, so raising the root font size
    // exercises exactly the relative sizing users change through their
    // browser/OS font-size preference. This is NOT browser zoom (which scales
    // px too) — that mechanism is recorded as untested in the review doc.
    const group = await workspaceGroup(page);
    await group.getByRole('radio', { name: 'Codegen workspace' }).click();
    await page.waitForTimeout(150);
    const before = await page.evaluate(() => {
      const pill = document.querySelector('.workspace-dock__item--active') as HTMLElement;
      const label = pill.querySelector('.workspace-dock__label') as HTMLElement;
      return {
        pillHeight: Math.round(pill.getBoundingClientRect().height),
        labelHeight: Math.round(label.getBoundingClientRect().height),
      };
    });

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '32px';
    });
    await page.waitForTimeout(400);

    const after = await page.evaluate(() => {
      const pill = document.querySelector('.workspace-dock__item--active') as HTMLElement;
      const label = pill.querySelector('.workspace-dock__label') as HTMLElement;
      const more = document.querySelector('.workspace-dock__more') as HTMLElement | null;
      return {
        pillHeight: Math.round(pill.getBoundingClientRect().height),
        labelHeight: Math.round(label.getBoundingClientRect().height),
        labelClippedVertically: label.scrollHeight > label.clientHeight + 1,
        labelClippedHorizontally: label.scrollWidth > label.clientWidth + 1,
        labelText: label.textContent,
        moreVisible: more ? more.offsetWidth > 0 : false,
      };
    });

    // The text must still be the full name, unclipped, and the pill must have
    // grown with it rather than cropping it.
    expect(after.labelText).toBe('Codegen');
    expect(after.labelClippedVertically).toBe(false);
    expect(after.labelClippedHorizontally).toBe(false);
    expect(after.pillHeight).toBeGreaterThanOrEqual(after.labelHeight);
    expect(after.pillHeight).toBeGreaterThanOrEqual(before.pillHeight);

    // Every mode is still reachable after the text-size change: the visible
    // radios plus the overflow menu must cover all eight.
    const visible = await group.evaluate((el) => el.querySelectorAll('[role="radio"]').length);
    if (after.moreVisible) {
      await page.getByRole('button', { name: /more workspaces/i }).click();
      const menu = page.getByRole('menu', { name: 'More workspaces' });
      await expect(menu).toBeVisible();
      const inMenu = await menu.getByRole('menuitemradio').count();
      expect(visible + inMenu).toBe(MODES.length);
      // The overflow menu must not wrap the Codegen label any more.
      await expect(menu.getByRole('menuitemradio', { name: 'Codegen' })).toBeVisible();
      await page.keyboard.press('Escape');
    } else {
      expect(visible).toBe(MODES.length);
    }

    await page.evaluate(() => {
      document.documentElement.style.fontSize = '';
    });
  });

  test('forced colors and a 480px viewport keep the switcher usable', async ({ page }) => {
    const errors: string[] = [];
    page.on('pageerror', (e) => errors.push(String(e)));

    await page.setViewportSize({ width: 480, height: 700 });
    await page.waitForTimeout(400);
    const group = await workspaceGroup(page);
    await expect(page.locator('.workspace-dock__item--active')).toBeVisible();
    const more = page.getByRole('button', { name: /more workspaces/i });
    await expect(more).toBeVisible();
    await more.click();
    const menu = page.getByRole('menu', { name: 'More workspaces' });
    await expect(menu).toBeVisible();
    const visibleCount = await group.evaluate((el) => el.querySelectorAll('[role="radio"]').length);
    const menuCount = await menu.getByRole('menuitemradio').count();
    expect(visibleCount + menuCount).toBe(MODES.length);
    await page.keyboard.press('Escape');

    // Forced colors: hue is gone, so selection must survive as a boundary
    // plus the visible name, not as an accent fill.
    await page.emulateMedia({ forcedColors: 'active' });
    await page.waitForTimeout(250);
    const forced = await page.evaluate(() => {
      const active = document.querySelector('.workspace-dock__item--active') as HTMLElement;
      const cs = getComputedStyle(active);
      return {
        borderTopWidth: Number.parseFloat(cs.borderTopWidth),
        borderStyle: cs.borderTopStyle,
        // At 480px the pill compacts, so the name lives in the accessible
        // name rather than a visible label.
        checkedName: document
          .querySelector('[role="radio"][aria-checked="true"]')
          ?.getAttribute('aria-label'),
      };
    });
    expect(forced.checkedName).toBe('Design workspace');
    expect(forced.borderStyle).not.toBe('none');
    expect(forced.borderTopWidth).toBeGreaterThanOrEqual(1);
    await page.screenshot({ path: join(OUT_ROOT, 'forced-colors-480.png') });
    await page.emulateMedia({ forcedColors: 'none' });
    expect(errors).toEqual([]);
  });

  test('captures review evidence', async ({ page }) => {
    mkdirSync(OUT_ROOT, { recursive: true });
    const dock = page.locator('.workspace-dock');
    for (const theme of THEMES) {
      await setTheme(page, theme);
      await dock.screenshot({ path: join(OUT_ROOT, `dock-1920-${theme}.png`) });
      await page.screenshot({
        path: join(OUT_ROOT, `menubar-1920-${theme}.png`),
        clip: { x: 0, y: 0, width: 1920, height: 60 },
      });
    }
    await setTheme(page, 'light');
    const group = await workspaceGroup(page);
    await group.getByRole('radio', { name: 'Codegen workspace' }).click();
    await page.waitForTimeout(200);
    await dock.screenshot({ path: join(OUT_ROOT, 'dock-1920-codegen.png') });

    await page.setViewportSize({ width: 1024, height: 768 });
    await page.waitForTimeout(400);
    await group.getByRole('radio', { name: 'Design workspace' }).click();
    await page.waitForTimeout(200);
    await dock.screenshot({ path: join(OUT_ROOT, 'dock-1024-light.png') });
    const more = page.getByRole('button', { name: /more workspaces/i });
    await more.click();
    await page.waitForTimeout(250);
    await page.screenshot({ path: join(OUT_ROOT, 'overflow-menu-1024-light.png') });

    const snapshot = await page.locator('.workspace-dock').ariaSnapshot();
    writeFileSync(join(OUT_ROOT, 'aria-snapshot.txt'), `${snapshot}\n`);
    await expect(page.getByRole('menu', { name: 'More workspaces' })).toBeVisible();
  });
});
