/**
 * Pure-TS flex layout engine for FrameNode auto-layout.
 *
 * Supports row/column/rowReverse/columnReverse, wrap, gap, padding,
 * alignItems, justifyContent, grow/shrink, and layoutSizing (hug/fill).
 *
 * Research basis: CSS Flexible Box Layout Module Level 1, Figma auto layout.
 */
import type { FrameNode, SceneNode } from '@varve/scene';
import { DEFAULT_ARTWORK_FONT_FAMILY, measureText } from '@varve/shared';

export interface LayoutResult {
  id: string;
  x: number;
  y: number;
  w: number;
  h: number;
}

function childSize(n: SceneNode): { w: number; h: number } {
  if (n.kind === 'shape') {
    const s = n.shape;
    if (s.kind === 'rect') return { w: s.w, h: s.h };
    if (s.kind === 'ellipse') return { w: s.rx * 2, h: s.ry * 2 };
    if (s.kind === 'circle') return { w: s.r * 2, h: s.r * 2 };
    if (s.kind === 'path') {
      const xs = s.points.map((p) => p.x);
      const ys = s.points.map((p) => p.y);
      if (xs.length === 0) return { w: 0, h: 0 };
      return { w: Math.max(...xs) - Math.min(...xs), h: Math.max(...ys) - Math.min(...ys) };
    }
  }
  if (n.kind === 'frame') return { w: n.w, h: n.h };
  if (n.kind === 'text') {
    const fs = n.fontSize ?? 16;
    const measured = measureText(n.text ?? '', {
      fontSize: fs,
      fontFamily: n.fontFamily ?? DEFAULT_ARTWORK_FONT_FAMILY,
      fontWeight: n.fontWeight ?? 400,
      fontStyle: n.fontStyle ?? 'normal',
      letterSpacing: n.letterSpacing ?? 0,
      lineHeight: n.lineHeight ?? 1.4,
    });
    return { w: Math.max(measured.width, 20), h: measured.height };
  }
  return { w: 0, h: 0 };
}

function isRow(dir: string): boolean {
  return dir === 'row' || dir === 'rowReverse';
}

function isReverse(dir: string): boolean {
  return dir === 'rowReverse' || dir === 'columnReverse';
}

export function computeFlexLayout(frame: FrameNode, children: SceneNode[]): LayoutResult[] {
  const style = frame.layoutStyle;
  if (!style || children.length === 0) return [];

  const [pt, pr, pb, pl] = style.padding;
  const gap = style.gap;
  const row = isRow(style.direction);
  const rev = isReverse(style.direction);

  const frameW = frame.w ?? 400;
  const frameH = frame.h ?? 200;
  const availW = Math.max(0, frameW - pl - pr);
  const availH = Math.max(0, frameH - pt - pb);

  // ── Compute intrinsic child sizes ────────────────────────────
  const sizes = children.map(childSize);

  // ── Apply grow/shrink to primary axis ────────────────────────
  const growTotal = children.reduce((s, n) => {
    const fillGrow = n.layoutSizing === 'fill' ? 1 : 0;
    const styleGrow = (n as { layoutStyle?: { grow?: number } }).layoutStyle?.grow ?? 0;
    return s + (fillGrow || styleGrow);
  }, 0);
  let remainingPrimary: number;
  if (row) {
    const totalContentW =
      sizes.reduce((s, sz) => s + sz.w, 0) + Math.max(0, children.length - 1) * gap;
    remainingPrimary = Math.max(0, availW - totalContentW);
  } else {
    const totalContentH =
      sizes.reduce((s, sz) => s + sz.h, 0) + Math.max(0, children.length - 1) * gap;
    remainingPrimary = Math.max(0, availH - totalContentH);
  }

  if (growTotal > 0 && remainingPrimary > 0) {
    const perUnit = remainingPrimary / growTotal;
    for (let i = 0; i < sizes.length; i++) {
      const fillGrow = children[i]?.layoutSizing === 'fill' ? 1 : 0;
      const styleGrow = (children[i] as { layoutStyle?: { grow?: number } }).layoutStyle?.grow ?? 0;
      const grow = fillGrow || styleGrow;
      const curSize = sizes[i];
      if (grow > 0 && curSize) {
        if (row) sizes[i] = { w: curSize.w + perUnit * grow, h: curSize.h };
        else sizes[i] = { w: curSize.w, h: curSize.h + perUnit * grow };
      }
    }
  }

  // ── Apply shrink when content overflows ──────────────────────
  if (remainingPrimary < 0) {
    const shrinkTotal = children.reduce(
      (s, n) => s + ((n as { layoutStyle?: { shrink?: number } }).layoutStyle?.shrink ?? 0),
      0,
    );
    if (shrinkTotal > 0) {
      const overflow = -remainingPrimary;
      const perUnit = overflow / shrinkTotal;
      for (let i = 0; i < sizes.length; i++) {
        const sh = (children[i] as { layoutStyle?: { shrink?: number } }).layoutStyle?.shrink ?? 0;
        const shrinkSize = sizes[i];
        if (sh > 0 && shrinkSize) {
          if (row) sizes[i] = { w: Math.max(0, shrinkSize.w - perUnit * sh), h: shrinkSize.h };
          else sizes[i] = { w: shrinkSize.w, h: Math.max(0, shrinkSize.h - perUnit * sh) };
        }
      }
    }
  }

  // ── Layout with wrapping ─────────────────────────────────────
  const lines: Array<{ indices: number[]; totalSize: number }> = [];
  let currentLine: number[] = [];
  let cursor = 0;
  let lineSize = 0;

  // Order for reverse directions
  const order = rev
    ? [...Array(children.length).keys()].reverse()
    : [...Array(children.length).keys()];

  for (const i of order) {
    const sz = sizes[i]!;
    const itemSize = row ? sz.w : sz.h;
    const avail = row ? availW : availH;

    if (cursor + itemSize > avail && currentLine.length > 0) {
      // Wrap to next line
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

  // ── Distribute lines along cross-axis ────────────────────────
  const results: LayoutResult[] = [];
  let crossCursor = row ? pt : pl;
  const crossGap = gap;

  for (const line of lines) {
    let primaryCursor = row ? pl : pt;
    const lineSize = line.totalSize;

    // Align items within the line
    for (const i of line.indices) {
      const sz = sizes[i]!;
      const child = children[i]!;

      // Apply layoutSizing: fill stretches to line size
      let cw = sz.w;
      let ch = sz.h;
      if (child.layoutSizing === 'fill') {
        if (row) cw = availW / line.indices.length;
        else ch = availH / line.indices.length;
      }

      // Cross-axis alignment uses the frame's available space (not line size).
      // This matches Figma's auto-layout behavior where items center within
      // the frame's cross-axis, not just within the line's packed extent.
      let cx = row ? primaryCursor : crossCursor;
      let cy = row ? crossCursor : primaryCursor;

      const align = style.alignItems ?? 'start';
      const crossAvail = row ? availH : availW;
      if (row && align !== 'start') {
        if (align === 'center') cy = crossCursor + (crossAvail - ch) / 2;
        else if (align === 'end') cy = crossCursor + crossAvail - ch;
        else if (align === 'stretch') ch = crossAvail;
      } else if (!row && align !== 'start') {
        if (align === 'center') cx = crossCursor + (crossAvail - cw) / 2;
        else if (align === 'end') cx = crossCursor + crossAvail - cw;
        else if (align === 'stretch') cw = crossAvail;
      }

      results.push({ id: child.id, x: cx, y: cy, w: cw, h: ch });
      primaryCursor += (row ? cw : ch) + gap;
    }

    crossCursor += lineSize + crossGap;
  }

  // ── Apply justifyContent to primary axis within each line ────
  const justify = style.justifyContent ?? 'start';
  if (justify !== 'start' && lines.length > 0) {
    for (const line of lines) {
      const lineResults = line.indices.map((i) => results.find((r) => r.id === children[i]?.id)!);
      if (lineResults.length === 0) continue;

      const totalSize = lineResults.reduce((s, r) => s + (row ? r.w : r.h), 0);
      const gaps = (lineResults.length - 1) * gap;
      const free = ((row ? availW : availH) - totalSize - gaps) | 0;

      if (free <= 0) continue;

      let offset = 0;
      const perGap =
        justify === 'spaceBetween'
          ? free / Math.max(1, lineResults.length - 1)
          : free / Math.max(1, lineResults.length);
      const halfGap = perGap / 2;

      for (let j = 0; j < lineResults.length; j++) {
        const r = lineResults[j]!;
        if (justify === 'center') {
          offset = free / 2;
        } else if (justify === 'end') {
          offset = free;
        } else if (justify === 'spaceAround') {
          offset = halfGap;
        }
        // For spaceBetween, first gets no offset, last gets no offset
        if (row) r.x += offset;
        else r.y += offset;
        if (justify === 'spaceAround') offset += (row ? r.w : r.h) + perGap;
        else if (justify === 'spaceBetween') offset += (row ? r.w : r.h) + perGap;
        else if (justify === 'center' || justify === 'end') break; // applied once at line level
      }
    }
  }

  return results;
}
