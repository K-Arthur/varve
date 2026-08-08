import { expect, test } from '@playwright/test';
import { contrastRatio, effectiveBackground, NORMAL_TEXT, parseColor } from './helpers';

/**
 * Theme resolution and no-mixed-theme guarantees.
 *
 * These run in BOTH projects (ghpages base /varve, custom-domain base /),
 * which covers the "pages work beneath /varve and /" requirement.
 */

const THEMES = [
  {
    name: 'light',
    colorScheme: 'light' as const,
    contrast: 'no-preference' as const,
    theme: 'light',
  },
  { name: 'dark', colorScheme: 'dark' as const, contrast: 'no-preference' as const, theme: 'dark' },
  {
    name: 'high-contrast',
    colorScheme: 'light' as const,
    contrast: 'more' as const,
    theme: 'high-contrast',
  },
];

test.describe('theme resolution', () => {
  for (const t of THEMES) {
    test(`${t.name}: html[data-theme] matches the OS preference`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.goto('/');
      await expect
        .poll(() => page.evaluate(() => document.documentElement.getAttribute('data-theme')))
        .toBe(t.theme);
    });
  }

  test('OS theme switch mid-session re-themes the page', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'light' });
    await page.goto('/');
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'light');
    await page.emulateMedia({ colorScheme: 'dark' });
    await expect(page.locator('html')).toHaveAttribute('data-theme', 'dark');
  });

  test('theme script runs before any stylesheet that depends on it (no FOUC)', async ({ page }) => {
    // The inline theme-detection script must precede the CSS in the document,
    // so html[data-theme] is set before theme-dependent styles evaluate.
    // The theme script is located by its marker (window.__varveTheme);
    // indexOf('prefers-color-scheme') would match the theme-color <meta> and
    // the bundled CSS instead, ordering the wrong pair of elements.
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
    // It must be a synchronous, non-deferred inline script (no src=, no defer).
    expect(themeScript!.tag).not.toMatch(/src=|defer/);
    expect(themeScript!.pos).toBeLessThan(cssPos);
    // The canonical attribute is on the root element.
    expect(html).toMatch(/<html[^>]*data-theme="/);
  });

  test('no-JS fallback: prefers-color-scheme media styles are present in the CSS', async ({
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

test.describe('no mixed-theme rendering', () => {
  for (const t of THEMES) {
    test(`${t.name}: page surface and text tokens are internally consistent`, async ({ page }) => {
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.goto('/');
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
      // Light theme: dark text on light surfaces. Dark/HC: light text on dark surfaces.
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
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.goto('/');
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

test.describe('hero visibility (screenshot defects 1-3)', () => {
  for (const t of THEMES) {
    test(`${t.name}: hero heading, copy and CTAs are fully visible below the sticky header`, async ({
      page,
    }) => {
      await page.emulateMedia({
        colorScheme: t.colorScheme,
        contrast: t.contrast,
        reducedMotion: 'reduce',
      });
      await page.goto('/');
      const header = await page.locator('.site-header').boundingBox();
      const hero = await page.locator('.hero').boundingBox();
      expect(header).not.toBeNull();
      expect(hero).not.toBeNull();
      // Hero starts below the header, no overlap.
      expect(hero!.y).toBeGreaterThanOrEqual(header!.y + header!.height - 1);

      const title = page.locator('.hero-title');
      await expect(title).toBeInViewport();
      const titleBox = await title.boundingBox();
      expect(titleBox!.y).toBeGreaterThanOrEqual(header!.y + header!.height);

      const subtitle = page.locator('.hero-subtitle');
      await expect(subtitle).toBeInViewport();
      const ctas = page.locator('.hero-ctas');
      await expect(ctas.getByRole('link', { name: /download the beta/i })).toBeVisible();
      await expect(ctas.getByRole('link', { name: /what is varve/i })).toBeVisible();

      // Full copy present (defect: only "your machine." visible).
      const subtitleText = await subtitle.textContent();
      expect(subtitleText).toContain('local-first design suite');
      expect(subtitleText).toContain('stays on your machine');
    });
  }

  test('feature section heading is readable in every theme', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.goto('/');
      const heading = page.getByRole('heading', {
        name: /more creative work, fewer applications/i,
      });
      await expect(heading).toBeVisible();
      const bg = await effectiveBackground(page, '.features-preview .section-title');
      const color = await page.evaluate(
        () => getComputedStyle(document.querySelector('.features-preview .section-title')!).color,
      );
      expect(bg).not.toBeNull();
      const ratio = contrastRatio(parseColor(color), parseColor(bg!.bg));
      expect(ratio, `heading in ${t.name}: ${ratio.toFixed(2)}:1`).toBeGreaterThanOrEqual(
        NORMAL_TEXT,
      );
    }
  });

  test('every bento card title and description is readable in every theme', async ({ page }) => {
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.goto('/');
      const cards = page.locator('.bento-cell');
      const count = await cards.count();
      expect(count).toBeGreaterThanOrEqual(4);
      for (let i = 0; i < count; i++) {
        const card = cards.nth(i);
        const info = await card.evaluate((el) => {
          const cs = getComputedStyle(el);
          const texts = [...el.querySelectorAll('h3, p')].map((t) => ({
            text: (t.textContent ?? '').trim().slice(0, 40),
            color: getComputedStyle(t).color,
            size: parseFloat(getComputedStyle(t).fontSize),
            weight: getComputedStyle(t).fontWeight,
          }));
          return { cardBg: cs.backgroundColor, texts };
        });
        for (const el of info.texts) {
          const ratio = contrastRatio(parseColor(el.color), parseColor(info.cardBg));
          const large = el.size >= 24 || (el.size >= 18.66 && +el.weight >= 700);
          expect(
            ratio,
            `card "${el.text}" in ${t.name}: ${ratio.toFixed(2)}:1`,
          ).toBeGreaterThanOrEqual(large ? 3 : NORMAL_TEXT);
        }
      }
    }
  });

  test('hero platform line is not dimmed by stacked neutrals', async ({ page }) => {
    await page.emulateMedia({ colorScheme: 'dark' });
    await page.goto('/');
    const el = page.locator('.hero-platforms');
    await expect(el).toBeVisible();
    const fg = await el.evaluate((e) => getComputedStyle(e).color);
    // On the dark hero gradient the effective background is the dark page.
    const bg = await effectiveBackground(page, '.hero-platforms');
    expect(contrastRatio(parseColor(fg), parseColor(bg!.bg))).toBeGreaterThanOrEqual(NORMAL_TEXT);
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
    await expect(page.locator('.nav-links')).toHaveClass(/active/);
    await expect(page.getByRole('link', { name: 'Product' })).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(toggle).toHaveAttribute('aria-expanded', 'false');
    await expect(toggle).toBeFocused();
    await expect(page.locator('.nav-links')).not.toHaveClass(/active/);
  });

  test('menu closes on desktop resize', async ({ page }) => {
    await page.setViewportSize({ width: 375, height: 812 });
    await page.goto('/');
    await page.locator('.mobile-menu-toggle').click();
    await expect(page.locator('.nav-links')).toHaveClass(/active/);
    await page.setViewportSize({ width: 1280, height: 900 });
    await expect(page.locator('.nav-links')).not.toHaveClass(/active/);
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
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.goto('/');
      const link = page.getByRole('link', { name: 'Docs' });
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
    // about/license always has an in-page anchor; download's #choose-platform
    // only exists once a release is published.
    await page.goto('/about/license#user-rights-summary');
    await page.waitForTimeout(700);
    const target = page.locator('#user-rights-summary');
    await expect(target).toBeVisible();
    const top = await target.evaluate((el) => el.getBoundingClientRect().top);
    const headerBottom = await page
      .locator('.site-header')
      .evaluate((el) => el.getBoundingClientRect().bottom);
    expect(top).toBeGreaterThanOrEqual(headerBottom - 4);
  });
});
