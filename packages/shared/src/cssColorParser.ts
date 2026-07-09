/**
 * CSS color string parser.
 *
 * Parses common CSS color syntaxes and returns a ManagedColor-compatible
 * object (always RGB space). Designed for the shared package — avoids
 * importing from @strata/scene to prevent circular dependencies.
 *
 * Research basis: CSS Color Module Level 4 (W3C), CSS Color Module Level 3,
 * CSS Color Module Level 5 (oklch/oklab).
 */

// ── Color type shim (mirrors @strata/scene ManagedColor → RgbColor) ────────

/** RGB color matching the ManagedColor shape (0–255 per channel). */
interface CssRgbColor {
  space: 'rgb';
  r: number;
  g: number;
  b: number;
  a: number;
}

// ── Named color map ─────────────────────────────────────────────────────────

const NAMED_COLORS: Record<string, [number, number, number]> = {
  black: [0, 0, 0],
  silver: [192, 192, 192],
  gray: [128, 128, 128],
  white: [255, 255, 255],
  maroon: [128, 0, 0],
  red: [255, 0, 0],
  purple: [128, 0, 128],
  fuchsia: [255, 0, 255],
  green: [0, 128, 0],
  lime: [0, 255, 0],
  olive: [128, 128, 0],
  yellow: [255, 255, 0],
  navy: [0, 0, 128],
  blue: [0, 0, 255],
  teal: [0, 128, 128],
  aqua: [0, 255, 255],
  orange: [255, 165, 0],
  transparent: [0, 0, 0],
  pink: [255, 192, 203],
  coral: [255, 127, 80],
  indigo: [75, 0, 130],
  violet: [238, 130, 238],
  brown: [165, 42, 42],
  cyan: [0, 255, 255],
  magenta: [255, 0, 255],
  tomato: [255, 99, 71],
  gold: [255, 215, 0],
  skyblue: [135, 206, 235],
  salmon: [250, 128, 114],
  slateblue: [106, 90, 205],
  darkgray: [169, 169, 169],
  lightgray: [211, 211, 211],
  darkgrey: [169, 169, 169],
  lightgrey: [211, 211, 211],
};

// ── Hex parser ──────────────────────────────────────────────────────────────

/** Parse a hex color string (#RGB, #RRGGBB, #RGBA, #RRGGBBAA). */
function parseHex(hex: string): CssRgbColor | null {
  const h = hex.replace(/^#/, '');
  if (!/^[0-9a-fA-F]+$/.test(h)) return null;

  let r: number;
  let g: number;
  let b: number;
  let a = 255;

  if (h.length === 3) {
    r = Number.parseInt(h[0]! + h[0]!, 16);
    g = Number.parseInt(h[1]! + h[1]!, 16);
    b = Number.parseInt(h[2]! + h[2]!, 16);
  } else if (h.length === 6) {
    r = Number.parseInt(h.slice(0, 2), 16);
    g = Number.parseInt(h.slice(2, 4), 16);
    b = Number.parseInt(h.slice(4, 6), 16);
  } else if (h.length === 4) {
    r = Number.parseInt(h[0]! + h[0]!, 16);
    g = Number.parseInt(h[1]! + h[1]!, 16);
    b = Number.parseInt(h[2]! + h[2]!, 16);
    a = Number.parseInt(h[3]! + h[3]!, 16);
  } else if (h.length === 8) {
    r = Number.parseInt(h.slice(0, 2), 16);
    g = Number.parseInt(h.slice(2, 4), 16);
    b = Number.parseInt(h.slice(4, 6), 16);
    a = Number.parseInt(h.slice(6, 8), 16);
  } else {
    return null;
  }

  if ([r, g, b, a].some(Number.isNaN)) return null;
  return { space: 'rgb', r, g, b, a };
}

// ── Number / percentage parser ──────────────────────────────────────────────

/** Parse a CSS number or percentage. Returns the 0-255 integer for RGB. */
function parseRgbChannel(raw: string): number {
  const s = raw.trim();
  if (s.endsWith('%')) {
    const p = Number.parseFloat(s);
    return Number.isNaN(p) ? 0 : Math.round((Math.max(0, Math.min(100, p)) / 100) * 255);
  }
  const v = Number.parseFloat(s);
  return Number.isNaN(v) ? 0 : Math.max(0, Math.min(255, Math.round(v)));
}

/** Parse a CSS number or percentage for alpha (0-1). */
function parseAlphaChannel(raw: string): number {
  const s = raw.trim();
  if (s.endsWith('%')) {
    const p = Number.parseFloat(s);
    return Number.isNaN(p) ? 255 : Math.round((Math.max(0, Math.min(100, p)) / 100) * 255);
  }
  const v = Number.parseFloat(s);
  return Number.isNaN(v) ? 255 : Math.max(0, Math.min(255, Math.round(v * 255)));
}

/** Parse a CSS number or percentage for HSL (0-255 range, converted). */
function parseHue(raw: string): number {
  const v = Number.parseFloat(raw.trim());
  return Number.isNaN(v) ? 0 : ((v % 360) + 360) % 360;
}

function parsePercent(raw: string): number {
  const s = raw.trim();
  const v = Number.parseFloat(s);
  return Number.isNaN(v) ? 0 : Math.max(0, Math.min(100, v));
}

/** Parse a float number (for oklch/oklab channels). */
function parseCssFloat(raw: string): number {
  const v = Number.parseFloat(raw.trim());
  return Number.isNaN(v) ? 0 : v;
}

// ── HSL → RGB ───────────────────────────────────────────────────────────────

function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const sNorm = s / 100;
  const lNorm = l / 100;
  const c = (1 - Math.abs(2 * lNorm - 1)) * sNorm;
  const x = c * (1 - Math.abs(((h / 60) % 2) - 1));
  const m = lNorm - c / 2;

  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (h < 60) {
    r1 = c;
    g1 = x;
  } else if (h < 120) {
    r1 = x;
    g1 = c;
  } else if (h < 180) {
    g1 = c;
    b1 = x;
  } else if (h < 240) {
    g1 = x;
    b1 = c;
  } else if (h < 300) {
    r1 = x;
    b1 = c;
  } else {
    r1 = c;
    b1 = x;
  }

  return [Math.round((r1 + m) * 255), Math.round((g1 + m) * 255), Math.round((b1 + m) * 255)];
}

// ── Oklch/Oklab → sRGB (analytical, no ICC) ────────────────────────────────

/** Convert Oklch to linear sRGB using analytical Oklab→linear sRGB matrix. */
function oklchToSrgb(l: number, c: number, h: number): [number, number, number] {
  const hRad = (h * Math.PI) / 180;
  const a = c * Math.cos(hRad);
  const b = c * Math.sin(hRad);
  return oklabToSrgb(l, a, b);
}

/** Convert Oklab [l, a, b] to sRGB [0-255, 0-255, 0-255]. */
function oklabToSrgb(l: number, a: number, b: number): [number, number, number] {
  // Oklab → linear sRGB (inverse of linear sRGB → Oklab)
  const l_ = l + 0.3963377774 * a + 0.2158037573 * b;
  const m_ = l - 0.1055613458 * a - 0.0638541728 * b;
  const s_ = l - 0.0894841775 * a - 1.291485548 * b;

  const l3 = l_ * l_ * l_;
  const m3 = m_ * m_ * m_;
  const s3 = s_ * s_ * s_;

  const rl = +4.0767416621 * l3 - 3.3077115913 * m3 + 0.2309699292 * s3;
  const gl = -1.2684380046 * l3 + 2.6097574011 * m3 - 0.3413193965 * s3;
  const bl = -0.0041960863 * l3 - 0.7034186147 * m3 + 1.707614701 * s3;

  const clamp = (v: number) => Math.max(0, Math.min(1, v));
  return [Math.round(clamp(rl) * 255), Math.round(clamp(gl) * 255), Math.round(clamp(bl) * 255)];
}

// ── Regex helpers ───────────────────────────────────────────────────────────

function matchFn(input: string, name: string): RegExpExecArray | null {
  const re = new RegExp(`^${name}\\s*\\(\\s*([^)]+?)\\s*\\)$`, 'i');
  return re.exec(input.trim());
}

function splitArgs(args: string): string[] {
  const result: string[] = [];
  let current = '';
  let depth = 0;
  let hasComma = false;
  for (const ch of args) {
    if (ch === '(') depth++;
    else if (ch === ')') depth--;
    else if (ch === ',' && depth === 0) {
      result.push(current.trim());
      current = '';
      hasComma = true;
      continue;
    }
    current += ch;
  }
  if (current.trim()) result.push(current.trim());

  // If no commas found (space-separated CSS Color Level 4 syntax), split by space
  if (!hasComma && result.length <= 2) {
    const trimmed = args.trim();
    // Handle optional slash-separated alpha: "0.5 0.2 180 / 0.5"
    const parts = trimmed.split(/\s+/);
    const cleanParts: string[] = [];
    for (let i = 0; i < parts.length; i++) {
      const p = parts[i]!;
      if (p === '/') continue; // skip slash separator between color and alpha
      cleanParts.push(p);
    }
    if (cleanParts.length >= result.length && cleanParts.length <= 5) {
      return cleanParts;
    }
  }

  return result;
}

// ── Main parser ─────────────────────────────────────────────────────────────

/**
 * Parse a CSS color string into a ManagedColor-compatible RGB object.
 *
 * Supports:
 * - Hex: #RGB, #RRGGBB, #RGBA, #RRGGBBAA
 * - Functional: rgb/rgba, hsl/hsla, oklch, oklab
 * - Named colors (basic set of ~30)
 *
 * Returns null for unrecognized or malformed input.
 */
export function cssStringToManagedColor(css: string): CssRgbColor | null {
  const input = css.trim();
  if (!input) return null;

  // Named colors
  const named = NAMED_COLORS[input.toLowerCase()];
  if (named) {
    const a = input.toLowerCase() === 'transparent' ? 0 : 255;
    return { space: 'rgb', r: named[0], g: named[1], b: named[2], a };
  }

  // Hex
  if (input.startsWith('#')) {
    return parseHex(input);
  }

  // rgb() / rgba()
  const rgbMatch = matchFn(input, 'rgba?');
  if (rgbMatch) {
    const parts = splitArgs(rgbMatch[1]!);
    if (parts.length < 3) return null;
    const r = parseRgbChannel(parts[0]!);
    const g = parseRgbChannel(parts[1]!);
    const b = parseRgbChannel(parts[2]!);
    const a = parts[3] !== undefined ? parseAlphaChannel(parts[3]) : 255;
    return { space: 'rgb', r, g, b, a };
  }

  // hsl() / hsla()
  const hslMatch = matchFn(input, 'hsla?');
  if (hslMatch) {
    const parts = splitArgs(hslMatch[1]!);
    if (parts.length < 3) return null;
    const h = parseHue(parts[0]!);
    const s = parsePercent(parts[1]!);
    const l = parsePercent(parts[2]!);
    const a = parts[3] !== undefined ? parseAlphaChannel(parts[3]) : 255;
    const [r, g, b] = hslToRgb(h, s, l);
    return { space: 'rgb', r, g, b, a };
  }

  // oklch()
  const oklchMatch = matchFn(input, 'oklch');
  if (oklchMatch) {
    const parts = splitArgs(oklchMatch[1]!);
    if (parts.length < 3) return null;
    const l = parseCssFloat(parts[0]!);
    const c = parseCssFloat(parts[1]!);
    const h = parseCssFloat(parts[2]!);
    const a = parts[3] !== undefined ? parseAlphaChannel(parts[3]) : 255;
    const [r, g, b] = oklchToSrgb(l, c, h);
    return { space: 'rgb', r, g, b, a };
  }

  // oklab()
  const oklabMatch = matchFn(input, 'oklab');
  if (oklabMatch) {
    const parts = splitArgs(oklabMatch[1]!);
    if (parts.length < 3) return null;
    const l = parseCssFloat(parts[0]!);
    const a = parseCssFloat(parts[1]!);
    const b = parseCssFloat(parts[2]!);
    const alpha = parts[3] !== undefined ? parseAlphaChannel(parts[3]) : 255;
    const [r, g, bv] = oklabToSrgb(l, a, b);
    return { space: 'rgb', r, g, b: bv, a: alpha };
  }

  return null;
}

/**
 * Convert a ManagedColor-compatible RGB object back to a CSS string.
 * Always produces rgba() with explicit alpha.
 */
export function managedColorToCssString(color: CssRgbColor): string {
  const a = color.a / 255;
  if (a === 1) {
    return `#${[color.r, color.g, color.b].map((c) => c.toString(16).padStart(2, '0')).join('')}`;
  }
  const aStr = a === 0 ? '0' : a < 0.01 ? a.toExponential(1) : a.toFixed(3).replace(/0+$/, '');
  return `rgba(${color.r},${color.g},${color.b},${aStr})`;
}
