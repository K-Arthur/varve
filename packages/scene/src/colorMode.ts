import type { ColorConfig, ColorMode, ManagedColor } from './colorManagement';
import type { Document } from './document';
import type { Effect, Fill, GradientStop, SceneNode, Stroke } from './types';

function rgbToCmyk(
  r: number,
  g: number,
  b: number,
): { c: number; m: number; y: number; k: number } {
  const rr = r / 255;
  const gg = g / 255;
  const bb = b / 255;
  const k = 1 - Math.max(rr, gg, bb);
  if (k === 1) return { c: 0, m: 0, y: 0, k: 100 };
  const c = ((1 - rr - k) / (1 - k)) * 100;
  const m = ((1 - gg - k) / (1 - k)) * 100;
  const y = ((1 - bb - k) / (1 - k)) * 100;
  return { c: Math.round(c), m: Math.round(m), y: Math.round(y), k: Math.round(k * 100) };
}

function cmykToRgb(
  c: number,
  m: number,
  y: number,
  k: number,
): { r: number; g: number; b: number } {
  const kk = k / 100;
  const r = 255 * (1 - c / 100) * (1 - kk);
  const g = 255 * (1 - m / 100) * (1 - kk);
  const b = 255 * (1 - y / 100) * (1 - kk);
  return { r: Math.round(r), g: Math.round(g), b: Math.round(b) };
}

function luminance(r: number, g: number, b: number): number {
  return Math.round(0.299 * r + 0.587 * g + 0.114 * b);
}

function convertColor(color: ManagedColor, newMode: ColorMode): ManagedColor {
  if (color.space === 'spot') return color;
  if (newMode === 'rgb') {
    if (color.space === 'rgb') return color;
    if (color.space === 'cmyk') {
      const { r, g, b } = cmykToRgb(color.c, color.m, color.y, color.k);
      return { space: 'rgb', r, g, b, a: color.a };
    }
    if (color.space === 'gray') {
      const v = (color.v / 255) * 255;
      return { space: 'rgb', r: v, g: v, b: v, a: color.a };
    }
  }
  if (newMode === 'cmyk') {
    if (color.space === 'cmyk') return color;
    if (color.space === 'rgb') {
      const { c, m, y, k } = rgbToCmyk(color.r, color.g, color.b);
      return { space: 'cmyk', c, m, y, k, a: color.a };
    }
    if (color.space === 'gray') {
      const v = color.v / 255;
      const k = Math.round((1 - v) * 100);
      return { space: 'cmyk', c: 0, m: 0, y: 0, k, a: color.a };
    }
  }
  if (newMode === 'grayscale') {
    if (color.space === 'gray') return color;
    if (color.space === 'rgb') {
      const v = luminance(color.r, color.g, color.b);
      return { space: 'gray', v, a: color.a };
    }
    if (color.space === 'cmyk') {
      const k = Math.max(color.c, color.m, color.y, color.k);
      return { space: 'gray', v: 255 - Math.round((k / 100) * 255), a: color.a };
    }
  }
  return color;
}

function updateColorConfig(
  config: ColorConfig | undefined,
  newMode: ColorMode,
): ColorConfig | undefined {
  if (!config) return config;
  return { ...config, mode: newMode };
}

function walkAndConvert(node: SceneNode, newMode: ColorMode): SceneNode {
  let updated = { ...node, fill: convertColor(node.fill, newMode) };

  if ('strokes' in updated && updated.strokes) {
    updated = {
      ...updated,
      strokes: updated.strokes.map((s: Stroke) => ({
        ...s,
        color: convertColor(s.color, newMode),
      })),
    } as SceneNode;
  }

  if ('effects' in updated && updated.effects) {
    updated = {
      ...updated,
      effects: updated.effects.map((e: Effect) => {
        if ('color' in e && e.color) {
          return { ...e, color: convertColor(e.color as ManagedColor, newMode) } as Effect;
        }
        return e;
      }),
    } as SceneNode;
  }

  if ('fills' in updated && updated.fills) {
    updated = {
      ...updated,
      fills: updated.fills.map((f: Fill) => ({
        ...f,
        color: f.color ? convertColor(f.color, newMode) : f.color,
        gradient: f.gradient
          ? {
              ...f.gradient,
              stops: f.gradient.stops.map((gs: GradientStop) => ({
                ...gs,
                color: convertColor(gs.color, newMode),
              })),
            }
          : f.gradient,
      })),
    } as SceneNode;
  }

  return updated;
}

export function switchColorMode(doc: Document, newMode: ColorMode): Document {
  if (doc.colorConfig?.mode === newMode) return doc;

  const nodes: Record<string, SceneNode> = {};
  for (const [id, node] of Object.entries(doc.nodes)) {
    nodes[id] = walkAndConvert(node, newMode);
  }

  let swatches = doc.swatches;
  if (swatches) {
    swatches = swatches.map((s) => ({ ...s, color: convertColor(s.color, newMode) }));
  }

  return {
    ...doc,
    nodes,
    swatches,
    colorConfig: updateColorConfig(doc.colorConfig, newMode),
  };
}
