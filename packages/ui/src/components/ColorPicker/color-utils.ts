export type Color = readonly [number, number, number, number];

export function hsvToRgb(h: number, s: number, v: number): [number, number, number] {
  const [r, g, b] = hsvToRgbNormalized(h, s, v);
  return [Math.round(r * 255), Math.round(g * 255), Math.round(b * 255)];
}

/**
 * HSV → normalized RGB (0-1 floats, no rounding).
 *
 * The 8-bit variant exists for legacy display callers; editing paths must
 * use this one so a high-precision document never has its channels
 * quantized to 8 bits by the HSV area/slider drafts.
 */
export function hsvToRgbNormalized(h: number, s: number, v: number): [number, number, number] {
  const hh = ((h % 360) + 360) % 360;
  const ss = s / 100;
  const vv = v / 100;
  const c = vv * ss;
  const x = c * (1 - Math.abs(((hh / 60) % 2) - 1));
  const m = vv - c;
  let r1 = 0;
  let g1 = 0;
  let b1 = 0;
  if (hh < 60) {
    r1 = c;
    g1 = x;
    b1 = 0;
  } else if (hh < 120) {
    r1 = x;
    g1 = c;
    b1 = 0;
  } else if (hh < 180) {
    r1 = 0;
    g1 = c;
    b1 = x;
  } else if (hh < 240) {
    r1 = 0;
    g1 = x;
    b1 = c;
  } else if (hh < 300) {
    r1 = x;
    g1 = 0;
    b1 = c;
  } else {
    r1 = c;
    g1 = 0;
    b1 = x;
  }
  return [r1 + m, g1 + m, b1 + m];
}

export function rgbToHsv(r: number, g: number, b: number): [number, number, number] {
  const [h, s, v] = rgbToHsvFloat(r / 255, g / 255, b / 255);
  return [Math.round(h), Math.round(s), Math.round(v)];
}

/**
 * Normalized RGB (0-1) → HSV without rounding. Draft values stay floats so
 * editing continuity (and untouched-channel preservation) does not depend
 * on 8-bit quantization of the display tuple.
 */
export function rgbToHsvFloat(r: number, g: number, b: number): [number, number, number] {
  const max = Math.max(r, g, b);
  const min = Math.min(r, g, b);
  const d = max - min;
  let h = 0;
  if (d !== 0) {
    if (max === r) h = ((g - b) / d + (g < b ? 6 : 0)) * 60;
    else if (max === g) h = ((b - r) / d + 2) * 60;
    else h = ((r - g) / d + 4) * 60;
  }
  const s = max === 0 ? 0 : (d / max) * 100;
  const v = max * 100;
  return [h, s, v];
}

export function hslToRgb(h: number, s: number, l: number): [number, number, number] {
  const hh = (((h % 360) + 360) % 360) / 360;
  const ss = s / 100;
  const ll = l / 100;
  if (ss === 0) {
    const v = Math.round(ll * 255);
    return [v, v, v];
  }
  const hue2rgb = (p: number, q: number, t: number): number => {
    let tt = t;
    if (tt < 0) tt += 1;
    if (tt > 1) tt -= 1;
    if (tt < 1 / 6) return p + (q - p) * 6 * tt;
    if (tt < 1 / 2) return q;
    if (tt < 2 / 3) return p + (q - p) * (2 / 3 - tt) * 6;
    return p;
  };
  const q = ll < 0.5 ? ll * (1 + ss) : ll + ss - ll * ss;
  const p = 2 * ll - q;
  return [
    Math.round(hue2rgb(p, q, hh + 1 / 3) * 255),
    Math.round(hue2rgb(p, q, hh) * 255),
    Math.round(hue2rgb(p, q, hh - 1 / 3) * 255),
  ];
}

export function rgbToHsl(r: number, g: number, b: number): [number, number, number] {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const max = Math.max(rr, gg, bb);
  const min = Math.min(rr, gg, bb);
  const l = (max + min) / 2;
  if (max === min) return [0, 0, Math.round(l * 100)];
  const d = max - min;
  const s = l > 0.5 ? d / (2 - max - min) : d / (max + min);
  let h = 0;
  if (max === rr) h = ((gg - bb) / d + (gg < bb ? 6 : 0)) / 6;
  else if (max === gg) h = ((bb - rr) / d + 2) / 6;
  else h = ((rr - gg) / d + 4) / 6;
  return [Math.round(h * 360), Math.round(s * 100), Math.round(l * 100)];
}

export function rgbToHex(r: number, g: number, b: number): string {
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}`;
}

/**
 * Parse a hex color string, supporting:
 *
 * - `#RGB` / `RGB`        (no alpha — caller keeps current alpha)
 * - `#RGBA` / `RGBA`      (alpha included)
 * - `#RRGGBB` / `RRGGBB`  (no alpha — caller keeps current alpha)
 * - `#RRGGBBAA` / `RRGGBBAA` (alpha included)
 *
 * Case-insensitive; optional leading `#`; surrounding whitespace tolerated.
 * Returns `[r, g, b]` in 0-255 plus `alpha: number | null` — alpha is only
 * present when the input form includes it (4- or 8-digit).
 */
export function hexToRgba(hex: string): [number, number, number, number | null] | null {
  const raw = hex.replace('#', '').trim();
  if (raw.length === 3 || raw.length === 4) {
    const m = /^([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F])([0-9a-fA-F]?)$/.exec(raw);
    if (!m) return null;
    const d = (c: string) => Number.parseInt(c, 16) * 17;
    return [d(m[1]!), d(m[2]!), d(m[3]!), m[4] ? d(m[4]!) : null];
  }
  if (raw.length === 6 || raw.length === 8) {
    const m = /^([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})([0-9a-fA-F]{2})?$/.exec(raw);
    if (!m) return null;
    return [
      Number.parseInt(m[1]!, 16),
      Number.parseInt(m[2]!, 16),
      Number.parseInt(m[3]!, 16),
      m[4] ? Number.parseInt(m[4]!, 16) : null,
    ];
  }
  return null;
}

/** 3- or 6-digit RGB hex only (no alpha) — legacy signature kept for callers. */
export function hexToRgb(hex: string): [number, number, number] | null {
  const parsed = hexToRgba(hex);
  if (!parsed) return null;
  return [parsed[0], parsed[1], parsed[2]];
}

/**
 * Format an RGBA color as hex: `#RRGGBB` when opaque, `#RRGGBBAA` otherwise.
 */
export function rgbToHexA(r: number, g: number, b: number, a: number): string {
  if (a >= 255) return rgbToHex(r, g, b);
  const h = (n: number) => n.toString(16).padStart(2, '0');
  return `#${h(r)}${h(g)}${h(b)}${h(a)}`;
}

export function rgbToHsb(r: number, g: number, b: number): [number, number, number] {
  return rgbToHsv(r, g, b);
}

export function hsbToRgb(h: number, s: number, b: number): [number, number, number] {
  return hsvToRgb(h, s, b);
}
