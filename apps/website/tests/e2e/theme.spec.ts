import { expect, test } from '@playwright/test';
import { contrastRatio, effectiveBackground, NORMAL_TEXT, parseColor } from './helpers';

/**
 * Theme resolution, persistence, migration and switcher behaviour.
 *
 * The site exposes exactly two themes (light/dark). First-time visitors
 * follow the OS; the first explicit click persists the choice. Legacy
 * localStorage values ("system", "high-contrast", invalid) resolve to the
 * OS and never render as a theme. Native forced-colors remains supported
 * independently of the selectable themes.
 *
 * These run in BOTH projects (ghpages base /varve, custom-domain base /).
 */

const THEMES = [
  { name: 'light', colorScheme: 'light' as const, theme: 'light' },
  { name: 'dark', colorScheme: 'dark' as const, theme: 'dark' },
];

/** Fresh context: no persisted preference. */
async function freshPage(page: import('@playwright/test').Page) {
  await page.goto('/');
  await page.evaluate(() => {
    history.scrollRestoration = 'manual';
    window.scrollTo(0, 0);
    localStorage.removeItem('varve-theme');
  });
  await page.reload();
}

test.describe('theme resolution', () => {
  for (const t of THEMES) {
    test(`${t.name}: html[data-theme] follows the OS preference without a persisted choice`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await freshPage(page);
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(t.theme);
    });
  }

  test('OS theme switch mid-session re-themes the page while no choice is persisted', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await freshPage(page);
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('no theme is ever set to a legacy or high-contrast value', async ({ page }) => {
    for (const legacy of ['system', 'high-contrast', 'light-mode', '', '42']) {
      await page.emulateMedia({ colorScheme: 'light' });
      await page.goto('/');
      await page.evaluate((v) => localStorage.setItem('varve-theme', v), legacy);
      await page.reload();
      const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
      expect(theme, `legacy value "${legacy}"`).toMatch(/^(light|dark)$/);
    }
  });

  test('theme script runs before any stylesheet that depends on it (no FOUC)', async ({ page }) => {
    await page.goto('/');
    const html = await page.content();
    const cssPos = html.indexOf('rel="stylesheet"');
    const scriptTags = [...html.matchAll(/<script\b[^>]*>/g)].map((m) => ({
      pos: m.index ?? 0,
      tag: m[0],
    }));
    const themeScript = scriptTags.find((s) =>
      html.slice(s.pos, s.pos + 2000).includes('window.__varveTheme'),
    );
    expect(themeScript, 'the inline theme script must exist').toBeTruthy();
    expect(themeScript!.tag).not.toMatch(/src=|defer/);
    expect(themeScript!.pos).toBeLessThan(cssPos);
    expect(html).toMatch(/<html[^>]*data-theme="/);
  });

  test('no-JS fallback: prefers-color-scheme and forced-colors media styles are present', async ({
    page,
  }) => {
    await page.goto('/');
    const media = await page.evaluate(() => {
      const found: string[] = [];
      for (const sheet of document.styleSheets) {
        try {
          for (const rule of sheet.cssRules) {
            if (rule instanceof CSSMediaRule) found.push(rule.conditionText);
          }
        } catch {}
      }
      return found;
    });
    expect(media.join(' ')).toContain('prefers-color-scheme: dark');
    expect(media.join(' ')).toContain('forced-colors');
  });
});

test.describe('theme switcher', () => {
  test('buttons reflect the current theme with aria-pressed and an active style', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await freshPage(page);
    // The redesign renders a ThemeToggle in the desktop header AND in the
    // mobile panel; the mobile copy is hidden until the panel opens. Scope to
    // the visible desktop toggle so the assertion matches one control.
    const state = await page.evaluate(() => ({
      theme: document.documentElement.getAttribute('data-theme'),
      pressed: [...document.querySelectorAll('.nav-actions .theme-option')].map((b) => ({
        choice: b.getAttribute('data-theme-choice'),
        pressed: b.getAttribute('aria-pressed'),
        active: b.classList.contains('active'),
      })),
    }));
    expect(state.theme).toBe('dark');
    expect(state.pressed).toEqual([
      { choice: 'light', pressed: 'false', active: false },
      { choice: 'dark', pressed: 'true', active: true },
    ]);
    // The active state must be visibly distinct (not icon-only).
    const dark = page.locator('.nav-actions .theme-option[data-theme-choice="dark"]');
    const light = page.locator('.nav-actions .theme-option[data-theme-choice="light"]');
    const darkBg = await dark.evaluate((el) => getComputedStyle(el).backgroundColor);
    const lightBg = await light.evaluate((el) => getComputedStyle(el).backgroundColor);
    expect(darkBg).not.toBe(lightBg);
  });

  test('clicking a theme persists it, applies it, and survives reload', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await freshPage(page);
    await page.locator('.nav-actions .theme-option[data-theme-choice="light"]').click();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    const stored = await page.evaluate(() => localStorage.getItem('varve-theme'));
    expect(stored).toBe('light');
    const pressed = await page
      .locator('.nav-actions .theme-option[data-theme-choice="light"]')
      .getAttribute('aria-pressed');
    expect(pressed).toBe('true');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
  });

  test('persisted light overrides OS dark and vice versa', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('varve-theme', 'light'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'light' });
    await page.evaluate(() => localStorage.setItem('varve-theme', 'dark'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('legacy "system" migrates to the OS and converts on the first click', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('varve-theme', 'system'));
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    // The stale value stays until the user chooses (no surprise rewrites)...
    expect(await page.evaluate(() => localStorage.getItem('varve-theme'))).toBe('system');
    // ...and the first click converts it into an explicit persisted choice.
    await page.locator('.nav-actions .theme-option[data-theme-choice="dark"]').click();
    expect(await page.evaluate(() => localStorage.getItem('varve-theme'))).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('legacy "high-contrast" never renders and is replaced by the next choice', async ({
    page,
  }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await page.evaluate(() => localStorage.setItem('varve-theme', 'high-contrast'));
    await page.reload();
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    expect(theme).toBe('light');
    await page.locator('.nav-actions .theme-option[data-theme-choice="dark"]').click();
    expect(await page.evaluate(() => localStorage.getItem('varve-theme'))).toBe('dark');
    await page.reload();
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('switcher works with keyboard activation', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await freshPage(page);
    const darkBtn = page.locator('.nav-actions .theme-option[data-theme-choice="dark"]');
    await darkBtn.focus();
    await page.keyboard.press('Enter');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });
});

test.describe('forced-colors compatibility', () => {
  test('forced-colors resolves surfaces to system colors in both themes', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({
        colorScheme: t.colorScheme,
        forcedColors: 'active',
        reducedMotion: 'reduce',
      });
      await freshPage(page);
      const state = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        // Probe what the browser resolves the forced-colors system keywords
        // to in this emulation (the palette differs per color scheme).
        const canvasProbe = document.createElement('div');
        canvasProbe.style.background = 'Canvas';
        const linkProbe = document.createElement('a');
        document.body.append(canvasProbe, linkProbe);
        const canvasColor = getComputedStyle(canvasProbe).backgroundColor;
        const linkText = getComputedStyle(linkProbe).color;
        canvasProbe.remove();
        linkProbe.remove();
        return {
          dataTheme: document.documentElement.getAttribute('data-theme'),
          bodyBg: cs.backgroundColor,
          footerBg: getComputedStyle(document.querySelector('.site-footer')!).backgroundColor,
          footerLink: getComputedStyle(document.querySelector('.footer-section a')!).color,
          canvasColor,
          linkText,
        };
      });
      expect(state.dataTheme).toBe(t.theme);
      // In forced-colors the tokens must resolve to the system colors —
      // not the app theme colors (dark navy / light gray)...
      expect(state.bodyBg).toBe(state.canvasColor);
      expect(state.footerBg).toBe(state.canvasColor);
      // ...and links resolve to the OS link color.
      expect(state.footerLink).toBe(state.linkText);
    }
  });
});

test.describe('no mixed-theme rendering', () => {
  for (const t of THEMES) {
    test(`${t.name}: page surface and text tokens are internally consistent`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await freshPage(page);
      const state = await page.evaluate(() => {
        const cs = getComputedStyle(document.body);
        return {
          bg: cs.backgroundColor,
          text: cs.color,
          headerBg: getComputedStyle(document.querySelector('.site-header')!).backgroundColor,
          headerText: getComputedStyle(document.querySelector('.site-logo')!).color,
        };
      });
      const bg = parseColor(state.bg);
      const text = parseColor(state.text);
      const headerBg = parseColor(state.headerBg);
      const headerText = parseColor(state.headerText);
      if (t.theme === 'light') {
        expect(bg.luminance).toBeGreaterThan(0.8);
        expect(text.luminance).toBeLessThan(0.15);
        expect(headerBg.luminance).toBeGreaterThan(0.8);
        expect(headerText.luminance).toBeLessThan(0.15);
      } else {
        expect(bg.luminance).toBeLessThan(0.15);
        expect(text.luminance).toBeGreaterThan(0.6);
        expect(headerBg.luminance).toBeLessThan(0.15);
        expect(headerText.luminance).toBeGreaterThan(0.6);
      }
      expect(contrastRatio(text, bg)).toBeGreaterThanOrEqual(NORMAL_TEXT);
      expect(contrastRatio(headerText, headerBg)).toBeGreaterThanOrEqual(NORMAL_TEXT);
    });
  }

  test('footer stays readable in both themes', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await freshPage(page);
      const info = await page.evaluate(() => {
        const footer = document.querySelector('.site-footer')!;
        const cs = getComputedStyle(footer);
        const link = document.querySelector('.footer-section a')!;
        return {
          bg: cs.backgroundColor,
          link: getComputedStyle(link).color,
          heading: getComputedStyle(document.querySelector('.footer-section h3')!).color,
        };
      });
      const bg = parseColor(info.bg);
      expect(contrastRatio(parseColor(info.link), bg)).toBeGreaterThanOrEqual(NORMAL_TEXT);
      expect(contrastRatio(parseColor(info.heading), bg)).toBeGreaterThanOrEqual(NORMAL_TEXT);
    }
  });
});

test.describe('hero visibility', () => {
  for (const t of THEMES) {
    test(`${t.name}: hero heading, copy and CTAs are fully visible below the sticky header`, async ({
      page,
    }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme, reducedMotion: 'reduce' });
      await freshPage(page);
      const header = await page.locator('.site-header').boundingBox();
      const hero = await page.locator('.hero').boundingBox();
      expect(header).not.toBeNull();
      expect(hero).not.toBeNull();
      expect(hero!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);

      const title = page.locator('.hero-title');
      await expect(title).toBeInViewport();
      const titleBox = await title.boundingBox();
      expect(titleBox!.y).toBeGreaterThanOrEqual(header!.y + header!.height);

      const subtitle = page.locator('.hero-subtitle');
      await expect(subtitle).toBeInViewport();
      const ctas = page.locator('.hero-ctas');
      await expect(ctas.getByRole('link', { name: /download/i }).first()).toBeVisible();
      await expect(ctas.getByRole('link', { name: /What is Varve/i })).toBeVisible();

      const subtitleText = await subtitle.textContent();
      expect(subtitleText).toContain('Vector, layout, typography');
      expect(subtitleText).toContain('Your work stays on your machine');
    });
  }

  test('hero animated phrase keeps accessible static text', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await freshPage(page);
    const heading = page.getByRole('heading', { level: 1 });
    await expect(heading).toContainText('Varve');
    await expect(heading).toContainText('design across disciplines.');
    await expect(heading).toContainText('One canvas.');
    // The rotating decoration must be hidden from AT.
    const rotorAriaHidden = await page.locator('.hero-phrase-rotor').getAttribute('aria-hidden');
    expect(rotorAriaHidden).toBe('true');
  });

  test('discipline section copy is readable in every theme', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await freshPage(page);
      const heading = page.getByRole('heading', { name: 'Six disciplines. One document.' });
      await expect(heading).toBeVisible();
      const bg = await effectiveBackground(page, '.disciplines .disciplines-title');
      const color = await page.evaluate(
        () => getComputedStyle(document.querySelector('.disciplines .disciplines-title')!).color,
      );
      expect(bg).not.toBeNull();
      const ratio = contrastRatio(parseColor(color), parseColor(bg!.bg));
      expect(ratio, `heading in ${t.name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        NORMAL_TEXT,
      );
    }
  });

  test('every discipline panel title and body is readable in every theme', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await freshPage(page);
      const panels = page.locator('[data-discipline-panel]');
      const count = await panels.count();
      expect(count).toBeGreaterThanOrEqual(6);
      for (let i = 0; i < count; i++) {
        const panel = panels.nth(i);
        const info = await panel.evaluate((el) => {
          const bg = getComputedStyle(el.closest('.disciplines-body')!).backgroundColor;
          const texts = [...el.querySelectorAll('h3, p, li, a')].map((t2) => ({
            text: (t2.textContent ?? '').trim().slice(0, 40),
            color: getComputedStyle(t2).color,
            size: parseFloat(getComputedStyle(t2).fontSize),
            weight: getComputedStyle(t2).fontWeight,
          }));
          return { bg, texts };
        });
        for (const el of info.texts) {
          const ratio = contrastRatio(parseColor(el.color), parseColor(info.bg));
          const large = el.size >= 24 || (el.size >= 18.66 && +el.weight >= 700);
          expect(
            ratio,
            `panel "${el.text}" in ${t.name}: ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(large ? 3 : NORMAL_TEXT);
        }
      }
    }
  });

  test('hero platform line is not dimmed by stacked neutrals', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await freshPage(page);
    const el = page.locator('.hero-platforms');
    await expect(el).toBeVisible();
    const fg = await el.evaluate((e) => getComputedStyle(e).color);
    const bg = await effectiveBackground(page, '.hero-platforms');
    expect(contrastRatio(parseColor(fg), parseColor(bg!.bg))).toBeGreaterThanOrEqual(NORMAL_TEXT);
  });

  test('product showcase renders real screenshots with captions and alt text', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light', reducedMotion: 'reduce' });
    await freshPage(page);
    const imgs = page.locator('.showcase img');
    const count = await imgs.count();
    expect(count).toBeGreaterThanOrEqual(2);
    for (let i = 0; i < count; i++) {
      const img = imgs.nth(i);
      await expect(img).toBeVisible();
      await expect(img).not.toHaveJSProperty('complete', false);
      const alt = await img.getAttribute('alt');
      expect(alt, `image ${i} alt`).toBeTruthy();
      expect(alt!.length).toBeGreaterThan(10);
      // The showcase mixes a full 1440x900 application frame with narrower
      // cropped details, so a fixed pixel floor is the wrong check. Assert
      // instead that the file decoded *and* that its intrinsic size matches
      // the width/height the markup reserved from the manifest — which
      // catches a failed decode and a layout-shifting mismatch alike.
      const size = await img.evaluate((el) => {
        const image = el as HTMLImageElement;
        return {
          naturalWidth: image.naturalWidth,
          naturalHeight: image.naturalHeight,
          attrWidth: Number(image.getAttribute('width')),
          attrHeight: Number(image.getAttribute('height')),
        };
      });
      expect(size.naturalWidth, `image ${i} must decode`).toBeGreaterThan(0);
      expect(size.naturalWidth, `image ${i} intrinsic width`).toBe(size.attrWidth);
      expect(size.naturalHeight, `image ${i} intrinsic height`).toBe(size.attrHeight);
    }
    const placeholders = await page.locator('.showcase-placeholder').count();
    expect(placeholders).toBe(0);
  });
});

test.describe('mobile navigation', () => {
  test('menu opens with aria-expanded, Escape closes and restores focus', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    const toggle = page.locator('.mobile-menu-toggle');
    await expect(toggle).toBeVisible();
    await toggle.click();
    await expect(toggle).toHaveAttribute('aria-expanded', 'true');
    await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'false');
    await expect(page.getByRole('link', { name: 'Product', exact: true })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    // Wait for the panel to finish hiding first; the focus return is
    // synchronous with closeMenu, so asserting it after the panel state
    // settles cannot race the close animation under parallel load.
    await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'true');
    await expect(toggle).toBeFocused();
  });

  test('menu closes on desktop resize', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.locator('.mobile-menu-toggle').click();
    await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'false');
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.mobile-nav-panel')).toHaveAttribute('aria-hidden', 'true');
  });

  test('mobile menu offers a Download entry', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.locator('.mobile-menu-toggle').click();
    await expect(
      page
        .locator('.mobile-nav-panel')
        .getByRole('link', { name: /download/i })
        .first(),
    ).toBeVisible();
    await expect(
      page
        .locator('.mobile-nav-panel')
        .getByRole('link', { name: /download/i })
        .first(),
    ).toHaveAttribute('href', /\/download/);
  });
});

test.describe('focus and keyboard', () => {
  test('skip link becomes visible on focus and jumps past the header', async ({ page }) => {
    await page.goto('/docs');
    await page.keyboard.press('Tab');
    const skip = page.locator('.skip-link');
    await expect(skip).toBeVisible();
    const visible = await skip.evaluate((el) => {
      const cs = getComputedStyle(el);
      const r = el.getBoundingClientRect();
      return { top: r.top, opacity: cs.opacity, display: cs.display };
    });
    expect(visible.display).not.toBe('none');
    expect(parseFloat(visible.opacity)).toBeGreaterThan(0.5);
    expect(visible.top).toBeGreaterThanOrEqual(0);
    await skip.press('Enter');
    await expect(page.locator('#main-content')).toBeFocused();
    const mainTop = await page
      .locator('#main-content')
      .evaluate((el) => el.getBoundingClientRect().top);
    const headerBottom = await page
      .locator('.site-header')
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(mainTop).toBeGreaterThanOrEqual(headerBottom - 2);
  });

  test('nav links show a visible focus ring in both themes', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme });
      await freshPage(page);
      const link = page.getByRole('link', { name: 'Docs', exact: true });
      await link.focus();
      const outline = await link.evaluate((el) => {
        const cs = getComputedStyle(el);
        return { style: cs.outlineStyle, width: cs.outlineWidth, color: cs.outlineColor };
      });
      expect(outline.style).not.toBe('none');
      expect(parseFloat(outline.width)).toBeGreaterThanOrEqual(2);
    }
  });
});

test.describe('anchor navigation under the sticky header', () => {
  test('hash target clears the sticky header', async ({ page }) => {
    // Neutralize smooth scrolling before the navigation: html has
    // `scroll-behavior: smooth`, whose animation duration is not bounded and
    // is slower under parallel load — a fixed sleep is a race. With instant
    // scrolling the hash jump lands exactly at the scroll-padding offset, so
    // the assertion measures the layout contract, not scroll timing.
    await page.addStyleTag({ content: 'html { scroll-behavior: auto !important; }' });
    await page.goto('/about/license#user-rights-summary');
    await page.waitForTimeout(300);
    const target = page.locator('#user-rights-summary');
    await expect(target).toBeVisible();
    const top = await target.evaluate((el) => el.getBoundingClientRect().top);
    const headerBottom = await page
      .locator('.site-header')
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(top).toBeGreaterThanOrEqual(headerBottom - 4);
  });
});
