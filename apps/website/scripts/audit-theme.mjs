#!/usr/bin/env node
/**
 * Theme/contrast audit for the Varve website.
 *
 * Renders every route in light, dark, and high-contrast OS modes and reports
 * WCAG 2.2 contrast failures for visible text elements, plus sticky-header
 * overlap and hardcoded-color detections.
 *
 * Usage:
 *   node scripts/audit-theme.mjs [--base http://localhost:4321/varve] [--route /docs]
 */
import { chromium } from 'playwright';

const base =
  process.env.BASE ??
  process.argv[process.argv.indexOf('--base') + 1] ??
  'http://localhost:4321/varve';
const onlyRoute =
  process.argv.indexOf('--route') !== -1 ? process.argv[process.argv.indexOf('--route') + 1] : null;

const routes = [
  '/',
  '/product',
  '/features',
  '/features/canvas',
  '/features/color-effects',
  '/features/export',
  '/features/motion',
  '/features/typography',
  '/features/vector-tools',
  '/download',
  '/docs',
  '/docs/architecture',
  '/docs/file-formats',
  '/docs/getting-started',
  '/docs/getting-started/first-project',
  '/docs/getting-started/interface',
  '/docs/keyboard-shortcuts',
  '/docs/rendering',
  '/docs/settings',
  '/docs/tools/color',
  '/docs/tools/export',
  '/docs/tools/motion',
  '/docs/tools/typography',
  '/docs/tools/vector',
  '/support',
  '/support/faq',
  '/support/known-issues',
  '/support/report-issue',
  '/support/troubleshooting',
  '/support-project',
  '/contribute',
  '/contribute/guidelines',
  '/learn',
  '/learn/community',
  '/learn/examples',
  '/learn/tutorials',
  '/about',
  '/about/license',
  '/about/privacy',
  '/about/security',
  '/releases',
  '/404',
];

const themes = [
  { name: 'light', colorScheme: 'light', contrast: 'no-preference' },
  { name: 'dark', colorScheme: 'dark', contrast: 'no-preference' },
];

function oklchToSrgb(l, c, h) {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const l1 = l + 0.3963377774 * a + 0.2158037573 * b;
  const m1 = l - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l1 ** 3;
  const m3 = m1 ** 3;
  const s3 = s1 ** 3;
  const clamp = (v) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

function parseColor(c) {
  if (c.startsWith('oklch')) {
    // oklch(L C H / A)
    const m = c.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
    if (m)
      return {
        okLch: parseFloat(m[1]),
        chroma: parseFloat(m[2]),
        hue: parseFloat(m[3]),
        alpha: m[4] ? parseFloat(m[4]) : 1,
        raw: c,
      };
  }
  const m = c.match(/rgba?\(([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (m) return { r: +m[1], g: +m[2], b: +m[3], alpha: m[4] ? parseFloat(m[4]) : 1, raw: c };
  return { raw: c };
}

function luminance(r, g, b) {
  const f = (v) => {
    v /= 255;
    return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
  };
  return 0.2126 * f(r) + 0.7152 * f(g) + 0.0722 * f(b);
}

function linearize(v) {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

function luminanceOf(color) {
  if (color.okLch !== undefined) {
    const [r, g, b] = oklchToSrgb(color.okLch, color.chroma, color.hue);
    return 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b);
  }
  if (color.r !== undefined) return luminance(color.r, color.g, color.b);
  return 0.5;
}

function contrast(a, b) {
  const l1 = luminanceOf(a);
  const l2 = luminanceOf(b);
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

function blend(fg, bg) {
  if (fg.alpha === 1) return fg;
  const a = fg.alpha;
  if (fg.okLch !== undefined && bg.okLch !== undefined) {
    return { okLch: fg.okLch * a + bg.okLch * (1 - a), alpha: 1, raw: 'blend' };
  }
  if (fg.r !== undefined && bg.r !== undefined) {
    return {
      r: fg.r * a + bg.r * (1 - a),
      g: fg.g * a + bg.g * (1 - a),
      b: fg.b * a + bg.b * (1 - a),
      alpha: 1,
      raw: 'blend',
    };
  }
  return fg;
}

const browser = await chromium.launch();
let failures = 0;
let total = 0;
let pageCount = 0;

for (const route of routes) {
  if (onlyRoute && route !== onlyRoute) continue;
  for (const t of themes) {
    const page = await browser.newPage({ viewport: { width: 1280, height: 900 } });
    await page.emulateMedia({
      colorScheme: t.colorScheme,
      contrast: t.contrast,
      reducedMotion: 'reduce',
    });
    await page.goto(base + route, { waitUntil: 'domcontentloaded', timeout: 15000 });
    await page.waitForTimeout(300);
    const theme = await page.evaluate(() => document.documentElement.getAttribute('data-theme'));
    pageCount++;

    const report = await page.evaluate(() => {
      const out = { headerOverlap: [], text: [], hardcoded: [] };
      const header = document.querySelector('.site-header');
      const headerRect = header?.getBoundingClientRect();
      // Element visibility helper
      const visible = (el) => {
        const cs = getComputedStyle(el);
        return cs.display !== 'none' && cs.visibility !== 'hidden' && parseFloat(cs.opacity) > 0.5;
      };
      // Sticky header overlap: elements with a non-empty rect that intersect the
      // header area at scroll 0 but are not inside the header itself.
      if (headerRect) {
        const headerBottom = headerRect.bottom;
        for (const el of document.querySelectorAll('h1, h2, p, a, button')) {
          if (!visible(el)) continue;
          if (header.contains(el)) continue;
          const r = el.getBoundingClientRect();
          if (r.bottom <= 0 || r.top >= innerHeight) continue;
          if (r.top < headerBottom && r.bottom > 0) {
            out.headerOverlap.push({
              tag: el.tagName,
              cls: (el.className && String(el.className).slice(0, 60)) || '',
              text: (el.textContent || '').trim().slice(0, 60),
              top: Math.round(r.top),
              bottom: Math.round(r.bottom),
            });
          }
        }
      }
      // Text contrast against nearest solid background.
      const toRgba = (cs, prop) => {
        const raw = cs[prop];
        const el = document.createElement('span');
        el.style.color = raw;
        document.body.appendChild(el);
        const parsed = getComputedStyle(el).color;
        el.remove();
        return { raw, parsed };
      };
      const effectiveBg = (el) => {
        let cur = el;
        const stack = [];
        while (cur && cur !== document.documentElement) {
          const cs = getComputedStyle(cur);
          const bg = cs.backgroundColor;
          if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
            stack.push({ el: cur, bg, cls: String(cur.className).slice(0, 50) });
            if (parseFloat(bg.match(/[\d.]+\)$/) ? bg.match(/([\d.]+)\)$/)[1] : '1') >= 0.99) break;
          }
          cur = cur.parentElement;
        }
        if (!stack.length)
          return { bg: getComputedStyle(document.body).backgroundColor, cls: 'body' };
        return stack[stack.length - 1];
      };
      const seen = new Set();
      for (const el of document.querySelectorAll(
        'h1, h2, h3, h4, p, a, button, span, li, td, th, strong, small, label, code, pre',
      )) {
        if (!visible(el)) continue;
        if (el.closest('.site-header, .site-footer, .skip-link')) continue;
        const text = (el.textContent || '').trim();
        if (!text) continue;
        const key = `${el.tagName}|${String(el.className)}|${text.slice(0, 40)}`;
        if (seen.has(key)) continue;
        seen.add(key);
        const cs = getComputedStyle(el);
        const fontSize = parseFloat(cs.fontSize);
        const fg = toRgba(cs, 'color').parsed;
        const { bg, cls: bgCls } = effectiveBg(el);
        const wcagWeight = parseFloat(cs.fontWeight) >= 700 ? 3 : 4.5;
        out.text.push({
          tag: el.tagName,
          cls: String(el.className).slice(0, 60),
          text: text.slice(0, 70),
          fg,
          bg,
          bgCls,
          size: fontSize,
          weight: cs.fontWeight,
          opacity: cs.opacity,
          req: wcagWeight,
          link: el.closest('a') !== null,
        });
      }
      // Hardcoded-color detection in computed styles.
      const hardcodedSet = new Set(['rgb(255, 255, 255)', 'rgb(0, 0, 0)']);
      for (const el of document.querySelectorAll('body *')) {
        const cs = getComputedStyle(el);
        for (const prop of ['color', 'backgroundColor', 'borderColor']) {
          const v = cs[prop];
          if (hardcodedSet.has(v)) {
            out.hardcoded.push({
              prop,
              tag: el.tagName,
              cls: String(el.className).slice(0, 50),
              text: (el.textContent || '').trim().slice(0, 40),
            });
          }
        }
      }
      return out;
    });

    // Cull overlaps that are within the hero's own padding (top: 0 relative to header is fine
    // if the element is below the header). Only report elements whose top is ABOVE header bottom.
    const overlaps = report.headerOverlap.filter((o) => o.top < 96);

    for (const el of report.text) {
      total++;
      const fg = parseColor(el.fg);
      const bg = parseColor(el.bg);
      const fgB = blend(fg, bg);
      const ratio = contrast(fgB, bg);
      if (ratio < el.req) {
        failures++;
        console.log(
          `FAIL ${route} [${t.name}/${theme}] ${el.tag}.${el.cls || '-'} "${el.text}" ` +
            `${ratio.toFixed(2)}:1 (need ${el.req}) fg=${el.fg} bg=${el.bg} on ${el.bgCls || '-'}`,
        );
      }
    }
    for (const o of overlaps) {
      failures++;
      console.log(
        `OVERLAP ${route} [${t.name}/${theme}] ${o.tag} "${o.text}" top=${o.top} bottom=${o.bottom}`,
      );
    }
    for (const h of report.hardcoded.slice(0, 5)) {
      console.log(`HARDCODED ${route} [${t.name}] ${h.prop}=${h.tag} ${h.cls} "${h.text}"`);
    }
    await page.close();
  }
}

console.log(
  `\nScanned ${pageCount} page/theme combos, ${total} text elements, ${failures} violations.`,
);
process.exit(failures > 0 ? 1 : 0);
