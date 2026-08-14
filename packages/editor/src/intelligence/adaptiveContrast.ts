/**
 * Editor-level Adaptive Contrast integration.
 *
 * Bridges the scene model (TextNode, Document) with the engine's
 * adaptive contrast algorithms (backdrop sampling, WCAG resolution,
 * hysteresis). Provides a React hook and utility function for
 * computing and applying adaptive text colors.
 *
 * The editor owns the render pipeline context, so this module
 * orchestrates: get text node bounds → sample backdrop via replay →
 * resolve contrast → patch the node.
 */

import {
  backdropChangedSinceLastResolve,
  resolveAdaptiveTextColor,
  sampleRegionBackdrop,
} from '@varve/engine';
import type { Document, ManagedColor, NodeId, TextNode } from '@varve/scene';
import { denormalizeChannel, managedColorToRgba, normalizeChannel } from '@varve/shared';
import { useEffect, useRef } from 'react';
import { useEditor } from '../context';
import { nodeWorldBounds } from '../scene/world';

export interface AdaptiveContrastOptions {
  /** Padding around the text bounds for sampling (px) */
  padding?: number;
  /** Maximum sample dimension (avoids huge canvases) */
  maxDimension?: number;
  /** Sampling throttle per node (ms) */
  throttleMs?: number;
}

const DEFAULT_OPTIONS: Required<AdaptiveContrastOptions> = {
  padding: 4,
  maxDimension: 1024,
  throttleMs: 100,
};

/**
 * Compute adaptive contrast for a text node and return a document patch
 * if a change is needed.
 *
 * 1. Computes the text node's world-space bounds.
 * 2. Creates an offscreen canvas at the bounds.
 * 3. Replays backdrop content (everything rendered before the text) via
 *    the provided replay function.
 * 4. Averages the sampled backdrop pixels.
 * 5. Resolves a text color meeting the configured WCAG target.
 * 6. Returns a document patch function that updates the node's
 *    adaptiveContrast state, or null if no change is needed.
 *
 * The caller should apply the patch via updateDoc(patch) so the change
 * flows through the proper undo/redo transaction.
 */
export function computeAdaptiveContrast(
  textNodeId: NodeId,
  doc: Document,
  replayBackdrop: (ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D) => void,
  options?: AdaptiveContrastOptions,
): ((d: Document) => Document) | null {
  const textNode = doc.nodes[textNodeId] as TextNode | undefined;
  if (textNode?.kind !== 'text') return null;
  if (!textNode.adaptiveContrast?.enabled) return null;

  const bounds = nodeWorldBounds(doc, textNodeId);
  if (!bounds || bounds.w <= 0 || bounds.h <= 0) return null;

  const opts = { ...DEFAULT_OPTIONS, ...options };
  const lw = Math.min(bounds.w + opts.padding * 2, opts.maxDimension);
  const lh = Math.min(bounds.h + opts.padding * 2, opts.maxDimension);

  const sampled = sampleRegionBackdrop(lw, lh, replayBackdrop);
  if (!sampled) return null;

  const ac = textNode.adaptiveContrast;

  if (ac.resolvedColor) {
    const [rr, rg, rb] = managedColorToRgba(ac.resolvedColor);
    if (!backdropChangedSinceLastResolve(sampled, [rr, rg, rb, 255], ac.hysteresis)) {
      return null;
    }
  }

  const fgRgba = managedColorToRgba(textNode.fill);
  const config = {
    enabled: ac.enabled,
    lightColor: ac.lightColor
      ? (managedColorToRgba(ac.lightColor) as [number, number, number, number])
      : undefined,
    darkColor: ac.darkColor
      ? (managedColorToRgba(ac.darkColor) as [number, number, number, number])
      : undefined,
    policy: ac.policy,
    customRatio: ac.customRatio,
    hysteresis: ac.hysteresis,
  };
  const fontSize = textNode.fontSize;
  const fontWeight = textNode.fontWeight;

  const result = resolveAdaptiveTextColor(fgRgba, sampled, config, fontSize, fontWeight);
  if (!result) return null;

  const now = Date.now();
  // The resolver works in 0-255 display space (its backdrop samples come
  // from an 8-bit canvas), but the result is canonical document state: it
  // must be scaled to the document's bit depth so a uint16/float document
  // never receives an 8-bit-only resolved color.
  const docDepth = doc.colorConfig?.bitDepth ?? 'uint8';
  const rescale = (v: number) => denormalizeChannel(normalizeChannel(v, 'uint8'), docDepth);
  const updatedConfig = {
    ...ac,
    lastResolved: now,
    resolvedColor: {
      space: 'rgb',
      bitDepth: docDepth,
      r: rescale(result.resolved[0]),
      g: rescale(result.resolved[1]),
      b: rescale(result.resolved[2]),
      a: rescale(255),
    } as ManagedColor,
  };

  return (d: Document) => {
    const n = d.nodes[textNodeId] as TextNode | undefined;
    if (n?.kind !== 'text') return d;
    return {
      ...d,
      nodes: {
        ...d.nodes,
        [textNodeId]: { ...n, adaptiveContrast: updatedConfig },
      },
    };
  };
}

/**
 * React hook that manages adaptive contrast evaluation for a set of text nodes.
 *
 * Watches for nodes with adaptiveContrast enabled, samples their backdrops
 * on relevant state changes, and updates resolved colors. Uses requestIdleCallback
 * for non-critical recalculations and throttles per-node sampling.
 */
export function useAdaptiveContrastEvaluation(nodeIds: NodeId[]): void {
  const { state } = useEditor();
  const doc = state.document;
  const lastSampledRef = useRef<Map<NodeId, number>>(new Map());

  const enabledNodes = nodeIds.filter((id) => {
    const node = doc.nodes[id];
    return node?.kind === 'text' && (node as TextNode).adaptiveContrast?.enabled;
  });

  useEffect(() => {
    if (enabledNodes.length === 0) return;

    const controller = new AbortController();

    const scheduleEvaluation = () => {
      if (controller.signal.aborted) return;

      for (const nodeId of enabledNodes) {
        const textNode = doc.nodes[nodeId] as TextNode | undefined;
        if (!textNode?.adaptiveContrast) continue;

        const lastTime = lastSampledRef.current.get(nodeId) ?? 0;
        const now = Date.now();
        if (now - lastTime < DEFAULT_OPTIONS.throttleMs) continue;

        const bounds = nodeWorldBounds(doc, nodeId);
        if (!bounds || bounds.w <= 0 || bounds.h <= 0) continue;

        const ac = textNode.adaptiveContrast;
        if (!ac.enabled) continue;

        const lw = Math.min(bounds.w + DEFAULT_OPTIONS.padding * 2, DEFAULT_OPTIONS.maxDimension);
        const lh = Math.min(bounds.h + DEFAULT_OPTIONS.padding * 2, DEFAULT_OPTIONS.maxDimension);

        requestIdleCallback(
          () => {
            if (controller.signal.aborted) return;

            const abstractReplayFn = (
              ctx: OffscreenCanvasRenderingContext2D | CanvasRenderingContext2D,
            ) => {
              ctx.fillStyle = '#ffffff';
              ctx.fillRect(0, 0, lw, lh);
            };

            const sampled = sampleRegionBackdrop(lw, lh, abstractReplayFn);
            if (!sampled) return;

            const fgRgba = managedColorToRgba(textNode.fill);
            const config = {
              enabled: ac.enabled,
              lightColor: ac.lightColor
                ? (managedColorToRgba(ac.lightColor) as [number, number, number, number])
                : undefined,
              darkColor: ac.darkColor
                ? (managedColorToRgba(ac.darkColor) as [number, number, number, number])
                : undefined,
              policy: ac.policy,
              customRatio: ac.customRatio,
              hysteresis: ac.hysteresis,
            };

            const result = resolveAdaptiveTextColor(
              fgRgba,
              sampled,
              config,
              textNode.fontSize,
              textNode.fontWeight,
            );
            if (result) {
              lastSampledRef.current.set(nodeId, Date.now());
            }
          },
          { timeout: 200 },
        );
      }
    };

    scheduleEvaluation();

    return () => {
      controller.abort();
    };
  }, [enabledNodes, doc]);
}
