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

function relativePercent(child: SceneNode, axis: 'width' | 'height'): number {
  const value = axis === 'width' ? child.layoutRelativeWidth : child.layoutRelativeHeight;
  return typeof value === 'number' && Number.isFinite(value) ? Math.max(0, value) : 0;
}

function isGrowParticipant(child: SceneNode, axis: 'width' | 'height'): boolean {
  // A legacy grow factor makes an item flexible even when the old unified
  // sizing field says fixed. Relative sizing remains literal and therefore
  // takes precedence over grow.
  return axisSizing(child, axis) !== 'relative' && primaryGrowWeight(child, axis) > 0;
}

/** Legacy nodes had no sizing field and expected min/max to clamp geometry.
 * Explicit Fixed mode is different: its authored bounds remain inactive. */
function constraintsActive(child: SceneNode, axis: 'width' | 'height'): boolean {
  const explicit = axis === 'width' ? child.layoutSizingWidth : child.layoutSizingHeight;
  const unified = child.layoutSizing;
  if (explicit !== undefined) return explicit !== 'fixed';
  if (unified !== undefined) return unified !== 'fixed';
  return true;
}

/** Resolve flexible sizes with freezing/redistribution rather than a one-shot clamp. */
function resolvePrimarySizes(
  children: SceneNode[],
  natural: Size[],
  axis: 'width' | 'height',
  available: number,
  gap: number,
  row: boolean,
): Size[] {
  const values = natural.map((size) => (row ? size.w : size.h));
  const gapTotal = Math.max(0, children.length - 1) * gap;
  const growIndices = children
    .map((child, index) => (isGrowParticipant(child, axis) ? index : -1))
    .filter((index) => index >= 0);
  const growSet = new Set(growIndices);
  const definiteTotal = children.reduce(
    (sum, _child, index) => sum + (growSet.has(index) ? 0 : values[index]!),
    0,
  );
  const relativeIndices = children
    .map((child, index) => (axisSizing(child, axis) === 'relative' ? index : -1))
    .filter((index) => index >= 0);
  const relativeBudget = Math.max(0, available - definiteTotal - gapTotal);
  for (const index of growIndices) {
    values[index] = 0;
  }
  for (const index of relativeIndices) {
    values[index] = clampAxis(
      relativeBudget * (relativePercent(children[index]!, axis) / 100),
      children[index]!,
      axis,
    );
  }

  const fillIndices = growIndices;
  const fixedAndRelative = values.reduce(
    (sum, value, index) => sum + (growSet.has(index) ? 0 : value),
    0,
  );
  let remaining = available - fixedAndRelative - gapTotal;

  // Preserve minimums even when the container cannot fit its contents.
  if (remaining < 0) {
    for (const index of fillIndices) {
      const min = axis === 'width' ? children[index]!.minWidth : children[index]!.minHeight;
      values[index] = typeof min === 'number' ? Math.max(0, min) : 0;
    }
    return values.map((value, index) => {
      const child = children[index]!;
      const resolved = constraintsActive(child, axis) ? clampAxis(value, child, axis) : value;
      return row ? { w: resolved, h: natural[index]!.h } : { w: natural[index]!.w, h: resolved };
    });
  }

  // Freeze items that hit a bound and distribute the residual among the rest.
  const unfrozen = new Set(fillIndices);
  let guard = 0;
  while (unfrozen.size > 0 && remaining >= 0 && guard++ <= children.length + 1) {
    const weightTotal = [...unfrozen].reduce(
      (sum, index) => sum + primaryGrowWeight(children[index]!, axis),
      0,
    );
    if (weightTotal <= 0) break;
    let froze = false;
    for (const index of [...unfrozen]) {
      const child = children[index]!;
      const proposed = remaining * (primaryGrowWeight(child, axis) / weightTotal);
      const clamped = clampAxis(proposed, child, axis);
      values[index] = clamped;
      const min = axis === 'width' ? child.minWidth : child.minHeight;
      const max = axis === 'width' ? child.maxWidth : child.maxHeight;
      if (
        (typeof min === 'number' && proposed < min) ||
        (typeof max === 'number' && proposed > max)
      ) {
        unfrozen.delete(index);
        remaining -= clamped;
        froze = true;
      }
    }
    if (!froze) {
      remaining = 0;
      break;
    }
  }
  if (unfrozen.size > 0 && remaining > 0) {
    const weightTotal = [...unfrozen].reduce(
      (sum, index) => sum + primaryGrowWeight(children[index]!, axis),
      0,
    );
    for (const index of unfrozen) {
      values[index] = clampAxis(
        remaining * (primaryGrowWeight(children[index]!, axis) / weightTotal),
        children[index]!,
        axis,
      );
    }
  }

  return values.map((value, index) => {
    const child = children[index]!;
    const resolved = constraintsActive(child, axis) ? clampAxis(value, child, axis) : value;
    return row ? { w: resolved, h: natural[index]!.h } : { w: natural[index]!.w, h: resolved };
  });
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

  // ── Measure intrinsic sizes and resolve primary-axis constraints ──
  const naturalSizes = children.map(measureNodeSize);
  const sizes = resolvePrimarySizes(children, naturalSizes, primaryAxis, avail, gap, row);
  const contentTotal = sizes.reduce((s, sz) => s + (row ? sz.w : sz.h), 0);
  const gapsTotal = Math.max(0, children.length - 1) * gap;
  const rawRemaining = avail - contentTotal - gapsTotal;

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
        const next = row ? Math.max(0, sz.w - perUnit * sh) : Math.max(0, sz.h - perUnit * sh);
        const constrained = constraintsActive(children[i]!, primaryAxis)
          ? clampAxis(next, children[i]!, primaryAxis)
          : next;
        if (row) sizes[i] = { w: constrained, h: sz.h };
        else sizes[i] = { w: sz.w, h: constrained };
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
  const resultById = new Map<string, LayoutResult>();
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

      if (effectiveAlign === 'stretch') {
        if (row) ch = crossAvail;
        else cw = crossAvail;
      }
      const crossValue = row ? ch : cw;
      const clampedCross = constraintsActive(child, crossAxis)
        ? clampAxis(crossValue, child, crossAxis)
        : crossValue;
      if (row) ch = clampedCross;
      else cw = clampedCross;

      let cx = row ? primaryCursor : crossCursor;
      let cy = row ? crossCursor : primaryCursor;
      if (row && effectiveAlign !== 'start') {
        if (effectiveAlign === 'center') cy = crossCursor + (crossAvail - ch) / 2;
        else if (effectiveAlign === 'end') cy = crossCursor + crossAvail - ch;
      } else if (!row && effectiveAlign !== 'start') {
        if (effectiveAlign === 'center') cx = crossCursor + (crossAvail - cw) / 2;
        else if (effectiveAlign === 'end') cx = crossCursor + crossAvail - cw;
      }

      const result = { id: child.id, x: cx, y: cy, w: cw, h: ch };
      results.push(result);
      resultById.set(child.id, result);
      primaryCursor += (row ? cw : ch) + gap;
    }

    crossCursor += line.totalSize + crossGap;
  }

  // ── Apply justifyContent to primary axis within each line ────
  const justify = style.justifyContent ?? 'start';
  if (justify !== 'start' && lines.length > 0) {
    for (const line of lines) {
      const lineResults = line.indices
        .map((i) => resultById.get(children[i]!.id))
        .filter((r): r is LayoutResult => Boolean(r));
      if (lineResults.length === 0) continue;

      const totalSize = lineResults.reduce((s, r) => s + (row ? r.w : r.h), 0);
      const lineGaps = (lineResults.length - 1) * gap;
      const free = (row ? availW : availH) - totalSize - lineGaps;

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
