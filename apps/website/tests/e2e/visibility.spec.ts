import { expect, test } from '@playwright/test';
import { contrastRatio, parseColor } from './helpers';

/**
 * Route-wide computed-style visibility audit.
 *
 * For every route x theme, every visible text element is checked with the
 * effective painted background (ancestor traversal) against WCAG 2.2 AA.
 * This is the production version of scripts/audit-theme.mjs: it must stay at
 * zero violations.
 */

const ROUTES = [
  '/',
  '/product',
  '/features',
  '/features/motion',
  '/features/export',
  '/download',
  '/docs',
  '/docs/tools/motion',
  '/docs/tools/typography',
  '/docs/getting-started',
  '/docs/keyboard-shortcuts',
  '/support',
  '/support/faq',
  '/support/troubleshooting',
  '/support/report-issue',
  '/contribute',
  '/contribute/guidelines',
  '/about',
  '/about/license',
  '/about/privacy',
  '/about/security',
  '/releases',
  '/learn',
  '/learn/tutorials',
  '/support-project',
  '/404',
];

const THEMES = [
  { name: 'light', colorScheme: 'light' as const, contrast: 'no-preference' as const },
  { name: 'dark', colorScheme: 'dark' as const, contrast: 'no-preference' as const },
];

const VISIBLE_TEXT = 'h1, h2, h3, h4, p, a, button, span, li, td, th, strong, small, label, code';

test.describe('computed-style contrast across routes', () => {
  for (const route of ROUTES) {
    for (const t of THEMES) {
      test(`${route} [${t.name}] every visible text element meets AA`, async ({ page }) => {
        await page.emulateMedia({
          colorScheme: t.colorScheme,
          contrast: t.contrast,
          reducedMotion: 'reduce',
        });
        await page.goto(route, { waitUntil: 'domcontentloaded' });
        const failures = await page.evaluate((selector) => {
          const out: string[] = [];
          const alphaOf = (bg: string) => {
            const m = bg.match(/\/\s*([\d.]+)\s*\)?$/);
            return m ? parseFloat(m[1]!) : 1;
          };
          const effectiveBg = (el: Element) => {
            let cur: Element | null = el;
            const stack: Array<{ bg: string; cls: string }> = [];
            while (cur && cur !== document.documentElement) {
              const bg = getComputedStyle(cur).backgroundColor;
              if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
                stack.push({ bg, cls: String(cur.className).slice(0, 50) });
                if (alphaOf(bg) >= 0.99) break;
              }
              cur = cur.parentElement;
            }
            if (!stack.length)
              return { bg: getComputedStyle(document.body).backgroundColor, cls: 'body' };
            return (
              stack[stack.length - 1] ?? {
                bg: getComputedStyle(document.body).backgroundColor,
                cls: 'body',
              }
            );
          };
          const visible = (el: Element) => {
            const cs = getComputedStyle(el);
            return (
              cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5
            );
          };
          const seen = new Set<string>();
          for (const el of document.querySelectorAll(selector)) {
            if (!visible(el)) continue;
            const text = (el.textContent ?? '').trim();
            if (!text) continue;
            const key = `${el.tagName}|${el.className}|${text.slice(0, 40)}`;
            if (seen.has(key)) continue;
            seen.add(key);
            const cs = getComputedStyle(el);
            const size = parseFloat(cs.fontSize);
            const weight = parseFloat(cs.fontWeight);
            const { bg, cls } = effectiveBg(el);
            out.push(
              JSON.stringify({
                tag: el.tagName,
                cls: String(el.className).slice(0, 50),
                text: text.slice(0, 60),
                fg: cs.color,
                bg,
                bgCls: cls,
                size,
                large: size >= 24 || (size >= 18.66 && weight >= 700),
              }),
            );
          }
          return out;
        }, VISIBLE_TEXT);

        for (const raw of failures) {
          const el: {
            tag: string;
            cls: string;
            text: string;
            fg: string;
            bg: string;
            bgCls: string;
            large: boolean;
            page: string;
          } = JSON.parse(raw);
          const fg = parseColor(el.fg);
          const bg = parseColor(el.bg);
          // Resolve semi-transparent foreground over the background.
          const eff =
            fg.alpha < 1
              ? {
                  ...fg,
                  luminance: fg.luminance * fg.alpha + bg.luminance * (1 - fg.alpha),
                  alpha: 1,
                }
              : fg;
          const ratio = contrastRatio(eff, bg);
          const threshold = el.large ? 3 : 4.5;
          expect(
            ratio,
            `${route} [${t.name}] ${el.tag}.${el.cls || ''} "${el.text}" ${ratio.toFixed(2)}:1 (need ${threshold}) fg=${el.fg} bg=${el.bg} on ${el.bgCls}`,
          ).toBeGreaterThanOrEqual(threshold);
        }
      });
    }
  }
});

test.describe('structural visibility hazards', () => {
  test('no text is hidden by opacity, clipping or zero size on the homepage', async ({ page }) => {
    await page.goto('/');
    const hazards = await page.evaluate(() => {
      // Elements inside a display:none subtree (e.g. inactive tab panels)
      // compute a zero rect but are intentionally hidden; skip those.
      const insideHiddenSubtree = (el: Element) => {
        let cur: Element | null = el;
        while (cur) {
          if (getComputedStyle(cur).display === 'none') return true;
          cur = cur.parentElement;
        }
        return false;
      };
      const out: string[] = [];
      for (const el of document.querySelectorAll('h1, h2, h3, p, a, button')) {
        const cs = getComputedStyle(el);
        const text = (el.textContent ?? '').trim();
        if (!text) continue;
        if (insideHiddenSubtree(el)) continue;
        const r = el.getBoundingClientRect();
        if (r.width === 0 && r.height === 0 && cs.display !== 'none')
          out.push(`zero-size: ${el.tagName} "${text.slice(0, 40)}"`);
        if (parseFloat(cs.opacity) < 0.5)
          out.push(`faded: ${el.tagName} "${text.slice(0, 40)}" opacity=${cs.opacity}`);
        if (cs.clipPath === 'inset(100% 0px 0px)' || cs.clipPath === 'inset(0px 0px 100%)')
          out.push(`clipped: ${el.tagName} "${text.slice(0, 40)}"`);
      }
      return out;
    });
    expect(hazards).toEqual([]);
  });

  test('no horizontal overflow at 640px (200% zoom proxy) or 320px', async ({ page }) => {
    for (const width of [640, 320]) {
      await page.setViewportSize({ width, height: 900 });
      await page.goto('/docs');
      const overflow = await page.evaluate(() => ({
        bodyScrollWidth: document.body.scrollWidth,
        bodyClientWidth: document.body.clientWidth,
        docScrollWidth: document.documentElement.scrollWidth,
      }));
      expect(overflow.bodyScrollWidth, `640/320 overflow at ${width}px`).toBeLessThanOrEqual(
        overflow.bodyClientWidth + 1,
      );
      expect(overflow.docScrollWidth).toBeLessThanOrEqual(overflow.bodyClientWidth + 1);
    }
  });

  test('code blocks keep dark surfaces with light text in every theme', async ({ page }) => {
    await page.goto('/download');
    for (const t of THEMES) {
      await page.emulateMedia({ colorScheme: t.colorScheme, contrast: t.contrast });
      await page.reload();
      const info = await page.evaluate(() => {
        const el = document.querySelector('.code-block, pre');
        if (!el) return null;
        const cs = getComputedStyle(el);
        return { bg: cs.backgroundColor, fg: cs.color };
      });
      if (info) {
        const bg = parseColor(info.bg);
        const fg = parseColor(info.fg);
        expect(fg.luminance).toBeGreaterThan(bg.luminance);
        expect(contrastRatio(fg, bg)).toBeGreaterThanOrEqual(4.5);
      }
    }
  });

  test('no unresolved custom-property tokens in computed styles', async ({ page }) => {
    await page.goto('/features');
    const unresolved = await page.evaluate(() => {
      const bad: string[] = [];
      for (const el of document.querySelectorAll('h1, h2, h3, p, a, div, span')) {
        const props = ['color', 'backgroundColor', 'borderColor'] as const;
        for (const prop of props) {
          const v = getComputedStyle(el)[prop];
          if (v.includes('var(')) bad.push(`${el.tagName}.${el.className} ${prop}=${v}`);
        }
      }
      return bad;
    });
    expect(unresolved).toEqual([]);
  });
});
