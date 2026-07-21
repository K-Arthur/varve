import type { Document, Fill, ManagedColor, NodeId } from '@strata/scene';
import { addSwatch, resolveNodeFills } from '@strata/scene';
import {
  contrastRatio,
  linearSrgbToOklab,
  managedColorToRgba,
  relativeLuminance,
  srgbToLinear,
} from '@strata/shared';

export type MappingMode = 'nearest' | 'preserve-lightness' | 'preserve-contrast' | 'fill-slot-only';

export interface FillMapping {
  nodeId: NodeId;
  fillIndex: number;
  originalColor: ManagedColor;
  mappedColor: ManagedColor;
  deltaE: number;
  contrastPreserved: boolean | null;
  warning?: string;
}

export interface MappingResult {
  mappings: FillMapping[];
  affectedNodes: NodeId[];
  affectedStyles: string[];
  affectedTokens: string[];
  wouldChangeSharedStyle: boolean;
  sharedStyleDetails: Array<{ styleId: string; styleName: string; nodeCount: number }>;
  contrastRegressions: FillMapping[];
}

function colorDistance(
  a: [number, number, number, number],
  b: [number, number, number, number],
): number {
  const rgbA: [number, number, number] = [a[0], a[1], a[2]];
  const rgbB: [number, number, number] = [b[0], b[1], b[2]];
  const linearA: [number, number, number] = [
    srgbToLinear(rgbA[0]),
    srgbToLinear(rgbA[1]),
    srgbToLinear(rgbA[2]),
  ];
  const linearB: [number, number, number] = [
    srgbToLinear(rgbB[0]),
    srgbToLinear(rgbB[1]),
    srgbToLinear(rgbB[2]),
  ];
  const labA = linearSrgbToOklab(linearA);
  const labB = linearSrgbToOklab(linearB);
  const dL = labA[0] - labB[0];
  const da = labA[1] - labB[1];
  const db = labA[2] - labB[2];
  return Math.sqrt(dL * dL + da * da + db * db);
}

interface PaletteTarget {
  color: ManagedColor;
  name: string;
}

function managedColorKey(c: ManagedColor): string {
  if (c.space !== 'rgb') return `${c.space}:${JSON.stringify(c)}`;
  return `rgb:${c.r},${c.g},${c.b},${c.a}`;
}

function findNearest(
  color: ManagedColor,
  palette: PaletteTarget[],
  mode: MappingMode,
  bgColor?: ManagedColor | null,
): { color: ManagedColor; deltaE: number; name?: string } {
  const [r, g, b] = managedColorToRgba(color);
  const fgLum = relativeLuminance(r, g, b);

  let best = palette[0]!;
  let bestDist = Infinity;

  for (const target of palette) {
    let dist: number;
    const targetRgba = managedColorToRgba(target.color);
    switch (mode) {
      case 'preserve-lightness': {
        const d = colorDistance(managedColorToRgba(color), targetRgba);
        const [tr, tg, tb] = targetRgba;
        const tgtLum = relativeLuminance(tr, tg, tb);
        const lumPenalty = Math.abs(fgLum - tgtLum) * 10;
        dist = d + lumPenalty;
        break;
      }
      case 'preserve-contrast': {
        const d = colorDistance(managedColorToRgba(color), targetRgba);
        if (bgColor) {
          const [br, bg, bb] = managedColorToRgba(bgColor);
          const bgLum = relativeLuminance(br, bg, bb);
          const origContrast = contrastRatio(fgLum, bgLum);
          const [tr, tg, tb] = targetRgba;
          const newContrast = contrastRatio(relativeLuminance(tr, tg, tb), bgLum);
          const contrastPenalty = Math.max(0, origContrast - newContrast) * 5;
          dist = d + contrastPenalty;
        } else {
          dist = d;
        }
        break;
      }
      default:
        dist = colorDistance(managedColorToRgba(color), targetRgba);
    }

    if (dist < bestDist) {
      bestDist = dist;
      best = target;
    }
  }

  return { color: best.color, deltaE: bestDist, name: best.name };
}

export function fillHasImageOrPattern(fill: Fill): boolean {
  return fill.type === 'image' || fill.type === 'pattern';
}

export function fillIsRemappable(fill: Fill): boolean {
  if (fill.visible === false) return false;
  if (fillHasImageOrPattern(fill)) return false;
  return true;
}

function findStylesUsingColor(
  doc: Document,
  color: ManagedColor,
  styleIdToCheck: string,
): { styleId: string; styleName: string; nodeCount: number } | null {
  if (!doc.styles) return null;
  const style = doc.styles[styleIdToCheck];
  if (!style) return null;
  const styleAny = style as unknown as Record<string, unknown>;
  const styleColor = styleAny.color as ManagedColor | undefined;
  if (styleColor && colorDistance(managedColorToRgba(styleColor), managedColorToRgba(color)) < 1) {
    let nodeCount = 0;
    for (const node of Object.values(doc.nodes)) {
      if (!node) continue;
      const nodeAny = node as unknown as Record<string, unknown>;
      if (nodeAny.styleId === styleIdToCheck) nodeCount++;
    }
    return {
      styleId: styleIdToCheck,
      styleName: (style as unknown as Record<string, string>).name ?? styleIdToCheck,
      nodeCount,
    };
  }
  return null;
}

export function mapFillsToPalette(
  doc: Document,
  nodeIds: NodeId[],
  palette: PaletteTarget[],
  mode: MappingMode = 'nearest',
  options?: {
    bgColor?: ManagedColor | null;
    fillIndices?: number[];
    threshold?: number;
  },
): MappingResult {
  const threshold = options?.threshold ?? 0;
  const mappings: FillMapping[] = [];
  const contrastRegressions: FillMapping[] = [];
  const affectedNodeIds = new Set<NodeId>();
  const sharedStyleDetails: MappingResult['sharedStyleDetails'] = [];

  for (const nodeId of nodeIds) {
    const node = doc.nodes[nodeId];
    if (!node || node.locked) continue;

    const fills = resolveNodeFills(node);

    for (let fi = 0; fi < fills.length; fi++) {
      if (options?.fillIndices && !options.fillIndices.includes(fi)) continue;

      const fill = fills[fi]!;
      if (!fillIsRemappable(fill)) continue;

      if (fill.type === 'solid' && fill.color) {
        const mapping = mapSingleColor(
          nodeId,
          fi,
          fill.color,
          palette,
          mode,
          options?.bgColor,
          threshold,
        );
        if (mapping) {
          mappings.push(mapping);
          affectedNodeIds.add(nodeId);
          if (mapping.contrastPreserved === false) {
            contrastRegressions.push(mapping);
          }
        }
      }

      if (fill.type === 'gradient' && fill.gradient?.stops) {
        for (let si = 0; si < fill.gradient.stops.length; si++) {
          const stop = fill.gradient.stops[si]!;
          const mapping = mapSingleColor(
            nodeId,
            fi,
            stop.color,
            palette,
            mode,
            options?.bgColor,
            threshold,
          );
          if (mapping) {
            mappings.push({
              ...mapping,
              warning: `Gradient stop ${si + 1} at position ${stop.position ?? si / (fill.gradient.stops.length - 1 || 1)}`,
            });
            affectedNodeIds.add(nodeId);
          }
        }
      }
    }

    const nodeAny = node as unknown as Record<string, unknown>;
    const nodeStyleId = nodeAny.styleId as string | undefined;
    if (nodeStyleId && doc.styles?.[nodeStyleId]) {
      const styleInfo = findStylesUsingColor(doc, getFillColor(fills), nodeStyleId);
      if (styleInfo) {
        sharedStyleDetails.push(styleInfo);
      }
    }
  }

  return {
    mappings,
    affectedNodes: [...affectedNodeIds],
    affectedStyles: sharedStyleDetails.map((s) => s.styleId),
    affectedTokens: [],
    wouldChangeSharedStyle: sharedStyleDetails.some((s) => s.nodeCount > 1),
    sharedStyleDetails,
    contrastRegressions,
  };
}

function getFillColor(fills: Fill[]): ManagedColor {
  const solid = fills.find((f) => f.visible !== false && f.type === 'solid');
  if (solid?.color) return solid.color;
  const gradient = fills.find((f) => f.visible !== false && f.type === 'gradient');
  if (gradient?.gradient?.stops?.length) return gradient.gradient.stops[0]!.color;
  return { space: 'rgb', r: 0, g: 0, b: 0, a: 255 };
}

function mapSingleColor(
  nodeId: NodeId,
  fillIndex: number,
  color: ManagedColor,
  palette: PaletteTarget[],
  mode: MappingMode,
  bgColor?: ManagedColor | null,
  threshold?: number,
): FillMapping | null {
  if (color.space !== 'rgb') return null;

  const nearest = findNearest(color, palette, mode, bgColor);
  if (nearest.deltaE === 0) return null;

  if (threshold && nearest.deltaE <= threshold) return null;

  if (managedColorKey(color) === managedColorKey(nearest.color)) return null;

  let contrastPreserved: boolean | null = null;
  if (bgColor) {
    const [or, og, ob] = managedColorToRgba(color);
    const [nr, ng, nb] = managedColorToRgba(nearest.color);
    const [br, bgc, bb] = managedColorToRgba(bgColor);
    const origLum = relativeLuminance(or, og, ob);
    const newLum = relativeLuminance(nr, ng, nb);
    const bgLum = relativeLuminance(br, bgc, bb);
    const origRatio = contrastRatio(origLum, bgLum);
    const newRatio = contrastRatio(newLum, bgLum);
    contrastPreserved = newRatio >= origRatio - 0.5;
  }

  return {
    nodeId,
    fillIndex,
    originalColor: color,
    mappedColor: nearest.color,
    deltaE: nearest.deltaE,
    contrastPreserved,
    warning: contrastPreserved === false ? 'Contrast may be reduced' : undefined,
  };
}

export function applyMappings(doc: Document, mappings: FillMapping[]): Document {
  let current = doc;

  for (const mapping of mappings) {
    const node = current.nodes[mapping.nodeId];
    if (!node) continue;

    const fills = resolveNodeFills(node);
    const fillToUpdate = fills[mapping.fillIndex];
    if (!fillToUpdate) continue;

    let newFill: Fill | null = null;

    if (fillToUpdate.type === 'solid') {
      newFill = { ...fillToUpdate, color: mapping.mappedColor };
    } else if (fillToUpdate.type === 'gradient' && fillToUpdate.gradient?.stops) {
      const stops = fillToUpdate.gradient.stops.map((stop) => {
        if (
          colorDistance(managedColorToRgba(stop.color), managedColorToRgba(mapping.originalColor)) <
          1
        ) {
          return { ...stop, color: mapping.mappedColor };
        }
        return stop;
      });
      newFill = { ...fillToUpdate, gradient: { ...fillToUpdate.gradient, stops } };
    }

    if (!newFill) continue;

    const newFills = [...fills];
    newFills[mapping.fillIndex] = newFill;

    current = {
      ...current,
      nodes: {
        ...current.nodes,
        [mapping.nodeId]: { ...node, fills: newFills } as unknown as typeof node,
      },
    };
  }

  return current;
}

export function createSwatchesFromPalette(doc: Document, palette: PaletteTarget[]): Document {
  let current = doc;
  for (const entry of palette) {
    current = addSwatch(current, entry.name, entry.color);
  }
  return current;
}

export function checkContrastRegression(
  fg: ManagedColor,
  bg: ManagedColor | null,
  mappedFg: ManagedColor,
): { ratio: number; newRatio: number; regressed: boolean } {
  if (!bg) return { ratio: 0, newRatio: 0, regressed: false };

  const [fr, fg_, fb] = managedColorToRgba(fg);
  const [mr, mg, mb] = managedColorToRgba(mappedFg);
  const [br, bgc, bb] = managedColorToRgba(bg);
  const origLum = relativeLuminance(fr, fg_, fb);
  const newLum = relativeLuminance(mr, mg, mb);
  const bgLum = relativeLuminance(br, bgc, bb);
  const ratio = contrastRatio(origLum, bgLum);
  const newRatio = contrastRatio(newLum, bgLum);

  return { ratio, newRatio, regressed: newRatio < ratio - 0.5 };
}
