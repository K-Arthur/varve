/**
 * Shared computed-style contrast and visibility helpers for website E2E.
 *
 * Contrast math mirrors the unit tests in src/test/tokens.test.ts (exact
 * oklch -> sRGB -> WCAG relative luminance) so CI tools agree with each other.
 */
import { expect, type Locator, type Page } from '@playwright/test';

export function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  const l1 = l + 0.3963377774 * a + 0.2158037573 * b;
  const m1 = l - 0.1055613458 * a - 0.0638541728 * b;
  const s1 = l - 0.0894841775 * a - 1.291485548 * b;
  const l3 = l1 ** 3;
  const m3 = m1 ** 3;
  const s3 = s1 ** 3;
  const clamp = (v: number) => Math.min(1, Math.max(0, v));
  return [
    clamp(4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3),
    clamp(-1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3),
    clamp(-0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3),
  ];
}

function linearize(v: number): number {
  return v <= 0.03928 ? v / 12.92 : ((v + 0.055) / 1.055) ** 2.4;
}

export interface ParsedColor {
  kind: 'oklch' | 'rgb' | 'other';
  luminance: number;
  alpha: number;
  raw: string;
}

export function parseColor(raw: string): ParsedColor {
  const oklch = raw.match(/oklch\(\s*([\d.]+)\s+([\d.]+)\s+([\d.]+)(?:\s*\/\s*([\d.]+))?/);
  if (oklch) {
    const [r, g, b] = oklchToSrgb(+oklch[1]!, +oklch[2]!, +oklch[3]!);
    return {
      kind: 'oklch',
      luminance: 0.2126 * linearize(r) + 0.7152 * linearize(g) + 0.0722 * linearize(b),
      alpha: oklch[4] ? +oklch[4] : 1,
      raw,
    };
  }
  const rgb = raw.match(/rgba?\(\s*([\d.]+),\s*([\d.]+),\s*([\d.]+)(?:,\s*([\d.]+))?\)/);
  if (rgb) {
    const toLin = (v: number) => linearize(v / 255);
    return {
      kind: 'rgb',
      luminance: 0.2126 * toLin(+rgb[1]!) + 0.7152 * toLin(+rgb[2]!) + 0.0722 * toLin(+rgb[3]!),
      alpha: rgb[4] ? +rgb[4] : 1,
      raw,
    };
  }
  return { kind: 'other', luminance: 0.5, alpha: 1, raw };
}

export function blendOver(fg: ParsedColor, bg: ParsedColor): ParsedColor {
  if (fg.alpha >= 1 || bg.kind !== fg.kind) return fg;
  return { ...fg, luminance: fg.luminance * fg.alpha + bg.luminance * (1 - fg.alpha), alpha: 1 };
}

export function contrastRatio(a: ParsedColor, b: ParsedColor): number {
  const l1 = a.luminance;
  const l2 = b.luminance;
  const hi = Math.max(l1, l2);
  const lo = Math.min(l1, l2);
  return (hi + 0.05) / (lo + 0.05);
}

/** Effective painted background via ancestor traversal (nearest opaque). */
export function effectiveBackground(page: Page, selector: string) {
  return page.evaluate((sel) => {
    const el = document.querySelector(sel);
    if (!el) return null;
    let cur: Element | null = el;
    while (cur && cur !== document.documentElement) {
      const cs = getComputedStyle(cur);
      const bg = cs.backgroundColor;
      if (bg && bg !== 'rgba(0, 0, 0, 0)' && bg !== 'transparent') {
        return { bg, cls: String(cur.className).slice(0, 60) };
      }
      cur = cur.parentElement;
    }
    return { bg: getComputedStyle(document.body).backgroundColor, cls: 'body' };
  }, selector);
}

export const LARGE_TEXT = 3.0;
export const NORMAL_TEXT = 4.5;
export const GRAPHICS = 3.0;

/**
 * Manifest screenshots now travel through `<picture>` + `srcset`. HTML
 * `width`/`height` stay the PNG source (CLS reservation). `naturalWidth` is
 * the density-corrected slot size, so it tracks the layout box, not the
 * file's pixel width.
 */
export async function expectReservedScreenshot(
  image: Locator,
  {
    width,
    height,
    fileStem,
  }: {
    width: number;
    height: number;
    fileStem?: string;
  },
) {
  await expect(image).toHaveAttribute('width', String(width));
  await expect(image).toHaveAttribute('height', String(height));
  await expect
    .poll(() =>
      image.evaluate((element: HTMLImageElement) => element.complete && element.naturalWidth > 0),
    )
    .toBe(true);
  const state = await image.evaluate((element: HTMLImageElement) => ({
    naturalWidth: element.naturalWidth,
    naturalHeight: element.naturalHeight,
    currentSrc: element.currentSrc,
  }));
  expect(state.naturalWidth, 'image decoded').toBeGreaterThan(0);
  expect(state.naturalWidth / state.naturalHeight).toBeCloseTo(width / height, 2);
  if (fileStem) {
    expect(state.currentSrc, 'currentSrc is the capture or a declared variant').toContain(fileStem);
  }
}
