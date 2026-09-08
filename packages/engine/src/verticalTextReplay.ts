/**
 * Canvas replay for vertical text.
 *
 * Kept outside replay.ts because replay.ts is a deliberately complexity-capped
 * hot path. This module consumes the canonical snapshot and only owns the
 * vertical paint policy; horizontal replay remains unchanged.
 */

import { managedColorToRgba } from '@varve/shared';
import type { ReplayTarget } from './replayTypes';
import type { TextLayoutSnapshot } from './textLayoutSnapshot';
import type { CharacterFormat, EngineColor, RenderItem, RichText } from './types';

type TextPrimitive = Extract<RenderItem['primitive'], { kind: 'text' }>;

function rgba(c: EngineColor | readonly [number, number, number, number]): string {
  if (Array.isArray(c) || 'length' in c) {
    return `rgba(${c[0]}, ${c[1]}, ${c[2]}, ${c[3] / 255})`;
  }
  const [r, g, b, a] = managedColorToRgba(c);
  return `rgba(${r}, ${g}, ${b}, ${a / 255})`;
}

function richTextFormatAt(richText: RichText, offset: number): CharacterFormat {
  let cursor = 0;
  for (const paragraph of richText.paragraphs) {
    for (const run of paragraph.runs) {
      if (offset >= cursor && offset < cursor + run.text.length) return run.format ?? {};
      cursor += run.text.length;
    }
    cursor += 1;
  }
  return {};
}

function effectiveWeight(p: { fontWeight: number; variableAxes?: Record<string, number> }): number {
  const axis = p.variableAxes?.wght;
  const weight = typeof axis === 'number' && Number.isFinite(axis) ? axis : p.fontWeight;
  return Math.max(1, Math.min(1000, weight));
}

function verticalBoxOffset(
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): { x: number; y: number } {
  const x =
    p.textAlign === 'center'
      ? (p.w - snapshot.width) / 2
      : p.textAlign === 'right'
        ? p.w - snapshot.width
        : 0;
  const y =
    p.textAlignVertical === 'middle'
      ? (p.h - snapshot.height) / 2
      : p.textAlignVertical === 'bottom'
        ? p.h - snapshot.height
        : 0;
  return { x, y };
}

function paintCluster(
  target: ReplayTarget,
  cluster: string,
  x: number,
  y: number,
  orientation: 'upright' | 'sideways',
  combined = false,
): void {
  target.save();
  target.translate(x, y);
  if (orientation === 'sideways') target.rotate(Math.PI / 2);
  if (combined) target.scale(0.72, 0.72);
  target.fillText(cluster, 0, 0);
  target.restore();
}

export function paintVerticalCanonicalRichText(
  target: ReplayTarget,
  p: TextPrimitive,
  richText: RichText,
  snapshot: TextLayoutSnapshot,
): void {
  const offset = verticalBoxOffset(p, snapshot);
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  const painted = new Set<string>();
  for (const line of snapshot.lines) {
    for (const run of line.runs) {
      for (const glyph of run.glyphs) {
        const key = `${line.paragraphIndex}:${glyph.clusterUtf16}`;
        if (painted.has(key)) continue;
        painted.add(key);
        const cluster = snapshot.text.slice(glyph.clusterUtf16, glyph.sourceEnd);
        if (cluster.length === 0 || cluster.includes('\n')) continue;
        const format = richTextFormatAt(richText, glyph.clusterUtf16);
        const style = (format.fontStyle ?? run.sourceRun.fontStyle) === 'italic' ? 'italic ' : '';
        const weight = format.fontWeight ?? run.sourceRun.fontWeight;
        const size = format.fontSize ?? run.sourceRun.fontSize;
        const family = format.fontFamily ?? run.sourceRun.fontFamily;
        target.font = `${style}${Math.max(1, Math.min(1000, weight))} ${size}px "${family}"`;
        if (format.color) target.fillStyle = rgba(format.color);
        paintCluster(
          target,
          cluster,
          p.x + offset.x + glyph.x + glyph.xOffset,
          p.y + offset.y + glyph.y + glyph.yOffset,
          glyph.orientation ?? 'sideways',
          format.textCombineUpright === true,
        );
        target.fillStyle = originalFillStyle;
      }
    }
  }
}

export function paintVerticalCanonicalText(
  target: ReplayTarget,
  p: TextPrimitive,
  snapshot: TextLayoutSnapshot,
): void {
  const offset = verticalBoxOffset(p, snapshot);
  const originalFillStyle = target.fillStyle;
  target.textAlign = 'center';
  target.textBaseline = 'middle';
  const painted = new Set<string>();
  for (const line of snapshot.lines) {
    for (const run of line.runs) {
      const style = run.sourceRun.fontStyle === 'italic' ? 'italic ' : '';
      const weight =
        p.variableAxes?.wght != null
          ? effectiveWeight(p)
          : Math.max(1, Math.min(1000, run.sourceRun.fontWeight));
      target.font = `${style}${weight} ${run.sourceRun.fontSize}px "${run.sourceRun.fontFamily}"`;
      for (const glyph of run.glyphs) {
        const key = `${line.paragraphIndex}:${glyph.clusterUtf16}`;
        if (painted.has(key)) continue;
        painted.add(key);
        const cluster = snapshot.text.slice(glyph.clusterUtf16, glyph.sourceEnd);
        if (cluster.length === 0 || cluster.includes('\n')) continue;
        paintCluster(
          target,
          cluster,
          p.x + offset.x + glyph.x + glyph.xOffset,
          p.y + offset.y + glyph.y + glyph.yOffset,
          glyph.orientation ?? 'sideways',
        );
      }
    }
    if (p.textDecoration === 'underline' || p.textDecoration === 'line-through') {
      const x = p.x + offset.x + (line.x ?? 0) + line.width * 0.76;
      const y =
        p.y +
        offset.y +
        line.top +
        (p.textDecoration === 'underline' ? line.width * 0.08 : line.width * 0.5);
      target.beginPath();
      target.moveTo(x, y);
      target.lineTo(x, y + line.height);
      target.strokeStyle = target.fillStyle;
      target.lineWidth = 1;
      target.stroke();
    }
  }
  target.fillStyle = originalFillStyle;
}
