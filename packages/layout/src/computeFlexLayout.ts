/**
 * Pure-TS flex layout engine for FrameNode auto-layout.
 *
 * Supports row/column/rowReverse/columnReverse, wrap, gap, padding,
 * alignItems, justifyContent, grow/shrink, per-axis sizing (layoutSizingWidth/
 * layoutSizingHeight, falling back to the legacy unified layoutSizing), and
 * min/max constraints.
 *
 * Research basis: CSS Flexible Box Layout Module Level 1, Figma auto layout.
 */
import type { FrameNode, LayoutSizing, SceneNode } from '@varve/scene';
import { axisSizing, clampAxis, isFlowParticipant, measureNodeSize, type Size } from './measure';

export interface LayoutResult {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function isRow(dir: string): boolean {
  return dir === 'row' || dir === 'rowReverse';
}

function isReverse(dir: string): boolean {
  return dir === 'rowReverse' || dir === 'columnReverse';
}

/** Cross-axis sizing mode, read from the explicit per-axis field only — the
 *  legacy unified `layoutSizing` never implied cross-axis stretch, only
 *  main-axis fill, so old documents keep their original behavior. */
function explicitAxisSizing(n: SceneNode, axis: 'width' | 'height'): LayoutSizing | undefined {
  return axis === 'width' ? n.layoutSizingWidth : n.layoutSizingHeight;
}

/** Primary-axis grow weight: per-axis/legacy fill sizing, or an explicit frame-item grow factor. */
function primaryGrowWeight(child: SceneNode, primaryAxis: 'width' | 'height'): number {
  const fillGrow = axisSizing(child, primaryAxis) === 'fill' ? 1 : 0;
  const styleGrow = (child as { layoutStyle?: { grow?: number } }).layoutStyle?.grow ?? 0;
  return fillGrow || styleGrow;
}

export function computeFlexLayout(frame: FrameNode, allChildren: SceneNode[]): LayoutResult[] {
  const style = frame.layoutStyle;
  if (!style) return [];

  const children = allChildren.filter(isFlowParticipant);
  if (children.length === 0) return [];

  const [pt, pr, pb, pl] = style.padding;
  const gap = style.gap;
  const row = isRow(style.direction);
  const rev = isReverse(style.direction);
  const wrap = style.wrap === true;

  const frameW = frame.w ?? 400;
  const frameH = frame.h ?? 200;
  const availW = Math.max(0, frameW - pl - pr);
  const availH = Math.max(0, frameH - pt - pb);
  const primaryAxis: 'width' | 'height' = row ? 'width' : 'height';
  const crossAxis: 'width' | 'height' = row ? 'height' : 'width';
  const avail = row ? availW : availH;
  const crossAvail = row ? availH : availW;

  // ── Measure intrinsic sizes, clamp primary axis to min/max ──────
  const sizes: Size[] = children.map((c) => {
    const sz = measureNodeSize(c);
    const clamped = clampAxis(row ? sz.w : sz.h, c, primaryAxis);
    return row ? { w: clamped, h: sz.h } : { w: sz.w, h: clamped };
  });

  // ── Zero out primary-axis base size for grow/fill children ──────
  const growWeights = children.map((c) => primaryGrowWeight(c, primaryAxis));
  const growTotal = growWeights.reduce((s, w) => s + w, 0);
  for (let i = 0; i < sizes.length; i++) {
    if (growWeights[i]! > 0) {
      const sz = sizes[i]!;
      sizes[i] = row ? { w: 0, h: sz.h } : { w: sz.w, h: 0 };
    }
  }

  const gapsTotal = Math.max(0, children.length - 1) * gap;
  const contentTotal = sizes.reduce((s, sz) => s + (row ? sz.w : sz.h), 0);
  const rawRemaining = avail - contentTotal - gapsTotal;

  // ── Distribute remaining space to grow/fill children (fill-after-fixed) ──
  if (growTotal > 0 && rawRemaining > 0) {
    for (let i = 0; i < sizes.length; i++) {
      const weight = growWeights[i]!;
      if (weight <= 0) continue;
      const rawShare = rawRemaining * (weight / growTotal);
      const clamped = clampAxis(rawShare, children[i]!, primaryAxis);
      const sz = sizes[i]!;
      sizes[i] = row ? { w: clamped, h: sz.h } : { w: sz.w, h: clamped };
    }
  }

  // ── Shrink when content overflows (legacy per-child shrink factor) ──
  if (rawRemaining < 0) {
    const shrinkTotal = children.reduce(
      (s, n) => s + ((n as { layoutStyle?: { shrink?: number } }).layoutStyle?.shrink ?? 0),
      0,
    );
    if (shrinkTotal > 0) {
      const overflow = -rawRemaining;
      for (let i = 0; i < sizes.length; i++) {
        const sh = (children[i] as { layoutStyle?: { shrink?: number } }).layoutStyle?.shrink ?? 0;
        if (sh <= 0) continue;
        const perUnit = overflow / shrinkTotal;
        const sz = sizes[i]!;
        if (row) sizes[i] = { w: Math.max(0, sz.w - perUnit * sh), h: sz.h };
        else sizes[i] = { w: sz.w, h: Math.max(0, sz.h - perUnit * sh) };
      }
    }
  }

  // ── Layout with wrapping ─────────────────────────────────────
  const lines: Array<{ indices: number[]; totalSize: number }> = [];
  let currentLine: number[] = [];
  let cursor = 0;
  let lineSize = 0;

  const order = rev
    ? [...Array(children.length).keys()].reverse()
    : [...Array(children.length).keys()];

  for (const i of order) {
    const sz = sizes[i]!;
    const itemSize = row ? sz.w : sz.h;

    if (wrap && cursor + itemSize > avail && currentLine.length > 0) {
      lines.push({ indices: currentLine, totalSize: lineSize });
      currentLine = [];
      cursor = 0;
      lineSize = 0;
    }

    currentLine.push(i);
    cursor += itemSize + gap;
    lineSize = Math.max(lineSize, row ? sz.h : sz.w);
  }
  if (currentLine.length > 0) {
    lines.push({ indices: currentLine, totalSize: lineSize });
  }

  // ── Distribute lines along cross-axis, align items per line ─────
  const results: LayoutResult[] = [];
  let crossCursor = row ? pt : pl;
  const crossGap = gap;

  for (const line of lines) {
    let primaryCursor = row ? pl : pt;

    for (const i of line.indices) {
      const sz = sizes[i]!;
      const child = children[i]!;

      let cw = sz.w;
      let ch = sz.h;

      // Per-child cross-axis override: explicit layoutAlign wins; otherwise an
      // explicit cross-axis 'fill' sizing implies stretch; otherwise inherit
      // the parent's alignItems. A child whose cross-axis sizing is 'hug'
      // never stretches — hug is an authoritative "sized by my own content"
      // commitment that would otherwise fight recursively with a hugging
      // frame's own intrinsic measurement (parent stretches it, then its own
      // hug pass shrinks it back).
      const alignOverride = child.layoutAlign ?? 'inherit';
      const crossFill = explicitAxisSizing(child, crossAxis) === 'fill';
      let effectiveAlign =
        alignOverride !== 'inherit'
          ? alignOverride
          : crossFill
            ? 'stretch'
            : (style.alignItems ?? 'start');
      if (effectiveAlign === 'stretch' && axisSizing(child, crossAxis) === 'hug') {
        effectiveAlign = 'start';
      }

      let cx = row ? primaryCursor : crossCursor;
      let cy = row ? crossCursor : primaryCursor;

      if (row && effectiveAlign !== 'start') {
        if (effectiveAlign === 'center') cy = crossCursor + (crossAvail - ch) / 2;
        else if (effectiveAlign === 'end') cy = crossCursor + crossAvail - ch;
        else if (effectiveAlign === 'stretch') ch = crossAvail;
      } else if (!row && effectiveAlign !== 'start') {
        if (effectiveAlign === 'center') cx = crossCursor + (crossAvail - cw) / 2;
        else if (effectiveAlign === 'end') cx = crossCursor + crossAvail - cw;
        else if (effectiveAlign === 'stretch') cw = crossAvail;
      }

      const clampedCross = clampAxis(row ? ch : cw, child, crossAxis);
      if (row) ch = clampedCross;
      else cw = clampedCross;

      results.push({ id: child.id, x: cx, y: cy, w: cw, h: ch });
      primaryCursor += (row ? cw : ch) + gap;
    }

    crossCursor += line.totalSize + crossGap;
  }

  // ── Apply justifyContent to primary axis within each line ────
  const justify = style.justifyContent ?? 'start';
  if (justify !== 'start' && lines.length > 0) {
    for (const line of lines) {
      const lineResults = line.indices.map((i) => results.find((r) => r.id === children[i]?.id)!);
      if (lineResults.length === 0) continue;

      const totalSize = lineResults.reduce((s, r) => s + (row ? r.w : r.h), 0);
      const lineGaps = (lineResults.length - 1) * gap;
      const free = ((row ? availW : availH) - totalSize - lineGaps) | 0;

      if (free <= 0) continue;

      if (justify === 'center' || justify === 'end') {
        const offset = justify === 'center' ? free / 2 : free;
        for (const r of lineResults) {
          if (row) r.x += offset;
          else r.y += offset;
        }
        continue;
      }

      // spaceBetween / spaceAround / spaceEvenly: each item's baseline
      // position (from the sequential pass above) already includes the
      // configured `gap`, so these only add the *extra* free space per
      // boundary crossed — not item width, which is already baked in.
      let perGap: number;
      let extra: number;
      if (justify === 'spaceBetween') {
        perGap = free / Math.max(1, lineResults.length - 1);
        extra = 0;
      } else if (justify === 'spaceAround') {
        perGap = free / lineResults.length;
        extra = perGap / 2;
      } else {
        perGap = free / (lineResults.length + 1);
        extra = perGap;
      }
      for (const r of lineResults) {
        if (row) r.x += extra;
        else r.y += extra;
        extra += perGap;
      }
    }
  }

  return results;
}
