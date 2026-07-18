import type { Document, ManagedColor } from '@strata/scene';

export interface DesignFingerprint {
  colors: Array<{ color: ManagedColor; count: number }>;
  spacing: number[];
  fontFamilies: string[];
  fontSizes: number[];
  cornerRadii: number[];
}

const STORAGE_KEY = 'strata:design-fingerprint';

function collectNodeColors(doc: Document): Map<string, { color: ManagedColor; count: number }> {
  const colorMap = new Map<string, { color: ManagedColor; count: number }>();

  for (const node of Object.values(doc.nodes)) {
    const fills = (node as Record<string, unknown>).fills as
      | Array<Record<string, unknown>>
      | undefined;
    if (fills && fills.length > 0) {
      for (const fill of fills) {
        if (fill.visible === false) continue;
        if (fill.type === 'solid' && fill.color) {
          const c = fill.color as ManagedColor;
          if (c.a === 0) continue;
          const key = colorKey(c);
          const existing = colorMap.get(key);
          if (existing) {
            existing.count++;
          } else {
            colorMap.set(key, { color: c, count: 1 });
          }
        }
      }
    } else {
      const fillColor = (node as Record<string, unknown>).fill as ManagedColor | undefined;
      if (fillColor && fillColor.a !== 0) {
        const key = colorKey(fillColor);
        const existing = colorMap.get(key);
        if (existing) {
          existing.count++;
        } else {
          colorMap.set(key, { color: fillColor, count: 1 });
        }
      }
    }
  }

  return colorMap;
}

function colorKey(c: ManagedColor): string {
  if (c.space === 'rgb') return `rgb:${c.r},${c.g},${c.b},${c.a}`;
  if (c.space === 'cmyk') return `cmyk:${c.c},${c.m},${c.y},${c.k},${c.a}`;
  if (c.space === 'gray') return `gray:${c.v},${c.a}`;
  return `spot:${c.name ?? ''},${c.tint}`;
}

export function computeFingerprint(doc: Document): DesignFingerprint {
  const colorMap = collectNodeColors(doc);
  const colors = [...colorMap.values()].sort((a, b) => b.count - a.count).slice(0, 12);

  const spacingValues = new Set<number>();
  const fontFamilies = new Set<string>();
  const fontSizes = new Set<number>();
  const cornerRadii = new Set<number>();

  for (const node of Object.values(doc.nodes)) {
    if (node.kind === 'frame' && node.layoutStyle) {
      spacingValues.add(node.layoutStyle.gap);
    }
    if (node.kind === 'text') {
      if (node.fontFamily) fontFamilies.add(node.fontFamily);
      if (node.fontSize) fontSizes.add(node.fontSize);
    }
    if (
      node.kind === 'shape' &&
      node.shape.kind === 'rect' &&
      typeof (node as Record<string, unknown>).cornerRadius === 'number'
    ) {
      cornerRadii.add((node as Record<string, unknown>).cornerRadius as number);
    }
  }

  const spacing = [...spacingValues].sort((a, b) => a - b).slice(0, 5);

  return {
    colors,
    spacing,
    fontFamilies: [...fontFamilies],
    fontSizes: [...fontSizes].sort((a, b) => a - b),
    cornerRadii: [...cornerRadii].sort((a, b) => a - b),
  };
}

export function saveFingerprint(fp: DesignFingerprint): void {
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(fp));
  } catch {
    // localStorage may be full or unavailable
  }
}

export function loadFingerprint(): DesignFingerprint | null {
  try {
    const raw = localStorage.getItem(STORAGE_KEY);
    if (!raw) return null;
    return JSON.parse(raw) as DesignFingerprint;
  } catch {
    return null;
  }
}
