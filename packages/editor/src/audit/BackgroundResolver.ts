/**
 * BackgroundResolver — three-stage composited-background resolver.
 *
 * Architecture
 * ────────────
 * Background resolution for contrast audit is surprisingly hard because a
 * text node's "background" is not a single property — it is the composite
 * of every layer painted behind it, from the document canvas color up
 * through ancestor frames/groups with their fills, effects, and blend modes.
 *
 * Rather than a single monolithic algorithm, this resolver uses a staged
 * approach that trades cost against precision:
 *
 *   Stage 1 — Scene-model resolution (fast, synchronous)
 *   Walk the ancestor chain from the target node to the root. If every
 *   ancestor from the text node up has a solid fill, the composited
 *   background can be computed by simple alpha-over blending. This covers
 *   the common case of text inside a solid frame on a solid page.
 *   Returns with confidence 'high' when fully opaque solid fills are found,
 *   and 'medium' when alpha transparency is involved.
 *
 *   Stage 2 — Alpha-composite resolution (medium cost)
 *   Handle non-solid fills (gradients, images) by evaluating their known
 *   contribution to the background. For gradients, the average color or
 *   the color beneath the text bounds can be estimated. For image fills,
 *   this stage notes ambiguity and falls through to stage 3.
 *
 *   Stage 3 — Pixel-sampled resolution (expensive, async-ready)
 *   Delegate to the renderer to produce a pixel sample of the background
 *   behind the node's bounds. This is the ground-truth fallback for cases
 *   where the scene model alone cannot determine the background (e.g.,
 *   image fills, complex blend modes, effects, masks). The renderer
 *   callback is injected at construction time and is expected to return
 *   a single averaged RGB sample. If no renderer is configured, returns
 *   'unresolvable' with an ambiguity reason.
 *
 * Caching
 * ──────
 * Results are cached per (nodeId, sceneRevision) so that the contrast
 * overlay can call resolve() on every render frame without redoing work.
 * Call invalidate(sceneRevision) when the document changes to flush
 * stale entries.
 *
 * Usage
 * ─────
 *   const resolver = new BackgroundResolver({ renderer: myRenderer });
 *   const result = resolver.resolve(doc, textNodeId);
 *   if (result.confidence === 'high') {
 *     // use result.color for contrast check
 *   }
 */

import type { Document, ManagedColor, NodeId, SceneNode } from '@strata/scene';
import { buildParentIndexMap, isContainer } from '@strata/scene';
import type { Rect } from '@strata/shared';

export type Confidence = 'high' | 'medium' | 'low' | 'unknown';

export interface BackgroundResult {
  color: [number, number, number] | null;
  confidence: Confidence;
  method: 'scene-model' | 'alpha-composite' | 'pixel-sampled' | 'unresolvable';
  ambiguityReason?: string;
}

export interface BackgroundRenderer {
  samplePixel(nodeId: NodeId, bounds: Rect): [number, number, number] | null;
}

export interface BackgroundResolverOptions {
  renderer?: BackgroundRenderer;
}

interface CacheEntry {
  result: BackgroundResult;
  revision: number;
}

function managedColorToTriple(color: ManagedColor): [number, number, number] | null {
  if (color.space === 'rgb') {
    return [color.r / 255, color.g / 255, color.b / 255];
  }
  if (color.space === 'gray') {
    const v = color.v / 255;
    return [v, v, v];
  }
  return null;
}

function firstSolidFillColor(node: SceneNode): ManagedColor | null {
  const fills = node.fills;
  if (!fills || fills.length === 0) {
    return node.fill;
  }
  for (const f of fills) {
    if (!f.visible) continue;
    if (f.type === 'solid' && f.color) {
      return f.color;
    }
  }
  return null;
}

function hasNonSolidFill(node: SceneNode): boolean {
  const fills = node.fills;
  if (!fills || fills.length === 0) return false;
  return fills.some((f) => f.visible && f.type !== 'solid');
}

function hasImageFill(node: SceneNode): boolean {
  const fills = node.fills;
  if (!fills || fills.length === 0) return false;
  return fills.some((f) => f.visible && f.type === 'image');
}

function hasGradientFill(node: SceneNode): boolean {
  const fills = node.fills;
  if (!fills || fills.length === 0) return false;
  return fills.some((f) => f.visible && f.type === 'gradient');
}

export class BackgroundResolver {
  private cache = new Map<string, CacheEntry>();
  private currentRevision = 0;
  private options?: BackgroundResolverOptions;

  constructor(options?: BackgroundResolverOptions) {
    this.options = options;
  }

  resolveSceneModel(doc: Document, nodeId: NodeId): BackgroundResult {
    const parentIndex = buildParentIndexMap(doc);
    const ancestors: NodeId[] = [];
    let current: NodeId | undefined = nodeId;

    while (current) {
      ancestors.push(current);
      const parent = parentIndex.get(current);
      current = parent;
    }

    const composited: [number, number, number] = [1, 1, 1];
    let hasAnyFill = false;
    let ambiguityReason: string | undefined;

    for (let i = ancestors.length - 1; i >= 0; i--) {
      const id = ancestors[i];
      const node = doc.nodes[id];
      if (!node) continue;

      if (isContainer(node)) {
        const fillColor = firstSolidFillColor(node);
        if (fillColor) {
          hasAnyFill = true;
          const triple = managedColorToTriple(fillColor);
          if (triple) {
            const alpha = fillColor.space === 'rgb' ? fillColor.a / 255 : fillColor.a / 255;
            if (alpha < 1) {
              ambiguityReason = 'ancestor fill has alpha transparency';
            }
            for (let j = 0; j < 3; j++) {
              composited[j] = composited[j] * (1 - alpha) + triple[j] * alpha;
            }
          }
        }

        if (hasNonSolidFill(node)) {
          if (hasImageFill(node)) {
            ambiguityReason = 'ancestor has image fill — scene model cannot resolve';
            return {
              color: null,
              confidence: 'unknown',
              method: 'unresolvable',
              ambiguityReason,
            };
          }
          if (hasGradientFill(node)) {
            ambiguityReason = 'ancestor has gradient fill — approximate color may be inaccurate';
          }
        }
        continue;
      }

      const fillColor = firstSolidFillColor(node);
      if (fillColor) {
        const triple = managedColorToTriple(fillColor);
        if (triple) {
          const alpha = fillColor.space === 'rgb' ? fillColor.a / 255 : fillColor.a / 255;
          for (let j = 0; j < 3; j++) {
            composited[j] = composited[j] * (1 - alpha) + triple[j] * alpha;
          }
        }
      }
    }

    if (!hasAnyFill) {
      return {
        color: composited,
        confidence: 'low',
        method: 'scene-model',
        ambiguityReason: 'no ancestor fills found — using default white',
      };
    }

    const confidence: Confidence = ambiguityReason ? 'medium' : 'high';
    return {
      color: composited,
      confidence,
      method: 'scene-model',
      ambiguityReason,
    };
  }

  resolveAlphaComposite(doc: Document, nodeId: NodeId): BackgroundResult {
    const parentIndex = buildParentIndexMap(doc);
    const ancestors: NodeId[] = [];
    let current: NodeId | undefined = nodeId;

    while (current) {
      ancestors.push(current);
      const parent = parentIndex.get(current);
      current = parent;
    }

    const composited: [number, number, number] = [1, 1, 1];
    let hasGradient = false;
    let hasAlpha = false;

    for (let i = ancestors.length - 1; i >= 0; i--) {
      const id = ancestors[i];
      const node = doc.nodes[id];
      if (!node) continue;

      const fills = node.fills;
      if (!fills || fills.length === 0) {
        const fc = node.fill;
        const triple = managedColorToTriple(fc);
        if (triple && fc.space === 'rgb' && fc.a < 255) {
          hasAlpha = true;
        }
        if (triple) {
          const alpha = fc.space === 'rgb' ? fc.a / 255 : fc.a / 255;
          for (let j = 0; j < 3; j++) {
            composited[j] = composited[j] * (1 - alpha) + triple[j] * alpha;
          }
        }
        continue;
      }

      for (const f of fills) {
        if (!f.visible) continue;

        if (f.type === 'solid' && f.color) {
          const triple = managedColorToTriple(f.color);
          if (triple) {
            const alpha = ((f.color.space === 'rgb' ? f.color.a : f.color.a) / 255) * f.opacity;
            if (alpha < 1) hasAlpha = true;
            for (let j = 0; j < 3; j++) {
              composited[j] = composited[j] * (1 - alpha) + triple[j] * alpha;
            }
          }
        } else if (f.type === 'gradient') {
          hasGradient = true;
          const stops = f.gradient?.stops;
          if (stops && stops.length > 0) {
            const avg: [number, number, number] = [0, 0, 0];
            for (const stop of stops) {
              const triple = managedColorToTriple(stop.color);
              if (triple) {
                avg[0] += triple[0] / stops.length;
                avg[1] += triple[1] / stops.length;
                avg[2] += triple[2] / stops.length;
              }
            }
            const alpha = f.opacity;
            if (alpha < 1) hasAlpha = true;
            for (let j = 0; j < 3; j++) {
              composited[j] = composited[j] * (1 - alpha) + avg[j] * alpha;
            }
          }
        } else if (f.type === 'image') {
          return {
            color: null,
            confidence: 'unknown',
            method: 'unresolvable',
            ambiguityReason: 'image fill detected — requires pixel sampling',
          };
        }
      }
    }

    let confidence: Confidence = 'high';
    const reasons: string[] = [];
    if (hasAlpha) reasons.push('alpha transparency composited');
    if (hasGradient) reasons.push('gradient approximated as average stop color');
    if (reasons.length > 0) confidence = 'medium';

    return {
      color: composited,
      confidence,
      method: 'alpha-composite',
      ambiguityReason: reasons.length > 0 ? reasons.join('; ') : undefined,
    };
  }

  resolvePixelSampled(nodeId: NodeId): BackgroundResult {
    if (!this.options?.renderer) {
      return {
        color: null,
        confidence: 'unknown',
        method: 'unresolvable',
        ambiguityReason: 'pixel-sampled resolution requires a renderer callback — none configured',
      };
    }

    const bounds: Rect = { x: 0, y: 0, w: 0, h: 0 };
    const sample = this.options.renderer.samplePixel(nodeId, bounds);
    if (!sample) {
      return {
        color: null,
        confidence: 'unknown',
        method: 'unresolvable',
        ambiguityReason: 'renderer returned null sample',
      };
    }

    return {
      color: sample,
      confidence: 'high',
      method: 'pixel-sampled',
    };
  }

  resolve(doc: Document, nodeId: NodeId): BackgroundResult {
    const cacheKey = `${nodeId}@${this.currentRevision}`;
    const cached = this.cache.get(cacheKey);
    if (cached && cached.revision === this.currentRevision) {
      return cached.result;
    }

    const stage1 = this.resolveSceneModel(doc, nodeId);
    if (stage1.confidence === 'high' || stage1.confidence === 'medium') {
      this.cache.set(cacheKey, { result: stage1, revision: this.currentRevision });
      return stage1;
    }

    const stage2 = this.resolveAlphaComposite(doc, nodeId);
    if (stage2.method !== 'unresolvable') {
      this.cache.set(cacheKey, { result: stage2, revision: this.currentRevision });
      return stage2;
    }

    const stage3 = this.resolvePixelSampled(nodeId);
    this.cache.set(cacheKey, { result: stage3, revision: this.currentRevision });
    return stage3;
  }

  invalidate(sceneRevision: number): void {
    this.currentRevision = sceneRevision;
    if (this.cache.size > 0) {
      for (const [key, entry] of this.cache) {
        if (entry.revision !== sceneRevision) {
          this.cache.delete(key);
        }
      }
    }
  }
}
