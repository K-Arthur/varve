/**
 * Pure-TS CSS Grid layout engine for FrameNode auto-layout.
 *
 * Supports explicit grids (gridTemplateColumns, gridTemplateRows with px/fr/auto),
 * implicit grids (gridAutoFlow: row/column), gap, padding, and explicit
 * gridPlacement (column/row start/end) on children.
 *
 * Research basis: CSS Grid Layout Module Level 1, Figma auto-layout grid.
 */
import type { Document, LayoutStyle, NodeId, SceneNode } from '@varve/scene';
import { axisSizing, isFlowParticipant, measureNodeSize } from './measure';
import { resizeNodeGeometry } from './resizeGeometry';

export interface GridItem {
  id: NodeId;
  x: number;
  y: number;
  w: number;
  h: number;
}

type TrackSize = { kind: 'px'; value: number } | { kind: 'fr'; value: number } | { kind: 'auto' };

function parseTrackTemplate(template: string): TrackSize[] {
  if (!template || template.trim() === '') return [];
  const parts: string[] = [];
  const tokenPattern = /repeat\(\s*(\d+)\s*,\s*([^()]+?)\s*\)|[^\s]+/g;
  for (const match of template.matchAll(tokenPattern)) {
    const count = Number.parseInt(match[1] ?? '', 10);
    if (Number.isFinite(count) && match[2]) {
      const repeated = match[2].trim().split(/\s+/);
      for (let i = 0; i < count; i++) parts.push(...repeated);
    } else if (match[0]) {
      parts.push(match[0]);
    }
  }
  return parts.map((part) => {
    if (part.endsWith('px')) {
      return { kind: 'px', value: parseFloat(part) };
    }
    if (part.endsWith('fr')) {
      return { kind: 'fr', value: parseFloat(part) };
    }
    if (part === 'auto') {
      return { kind: 'auto' };
    }
    const val = parseFloat(part);
    return Number.isNaN(val) ? { kind: 'auto' } : { kind: 'px', value: val };
  });
}

/**
 * Parse a grid track definition like "100px 1fr auto 2fr".
 * Returns pixel values with fr units resolved proportionally and -1 for auto.
 */
export function parseGridTracks(template: string, availableSize: number, gap: number): number[] {
  const tracks = parseTrackTemplate(template);
  if (tracks.length === 0) return [];

  const gapTotal = Math.max(0, tracks.length - 1) * gap;
  const fixedTotal = tracks.reduce((sum, t) => (t.kind === 'px' ? sum + t.value : sum), 0);
  const frTotal = tracks.reduce((sum, t) => (t.kind === 'fr' ? sum + t.value : sum), 0);
  const remaining = Math.max(0, availableSize - fixedTotal - gapTotal);
  const perFr = frTotal > 0 ? remaining / frTotal : 0;

  return tracks.map((t) => {
    switch (t.kind) {
      case 'px':
        return t.value;
      case 'fr':
        return perFr * t.value;
      case 'auto':
        return -1;
      default:
        return 0;
    }
  });
}

function childSize(n: SceneNode, includeBorders = false): { w: number; h: number } {
  return measureNodeSize(n, includeBorders);
}

function resolveAutoTracks(
  tracks: number[],
  children: SceneNode[],
  cellMapping: number[],
  isColumn: boolean,
  includeBorders: boolean,
): number[] {
  return tracks.map((size, idx) => {
    if (size !== -1) return size;

    const childIndices = cellMapping
      .map((cellIdx, childIdx) => (cellIdx === idx ? childIdx : -1))
      .filter((c) => c >= 0);

    if (childIndices.length === 0) return 0;

    let maxSize = 0;
    for (const ci of childIndices) {
      if (children[ci]) {
        const sz = childSize(children[ci], includeBorders);
        maxSize = Math.max(maxSize, isColumn ? sz.h : sz.w);
      }
    }
    return maxSize || 100;
  });
}

interface CellAssignment {
  childIndex: number;
  col: number;
  row: number;
  colSpan: number;
  rowSpan: number;
}

/**
 * Compute CSS Grid layout for a container's children.
 */
export function computeGridLayout(
  doc: Document,
  _parentId: NodeId,
  parentW: number,
  parentH: number,
  layoutStyle: LayoutStyle,
  children: NodeId[],
): GridItem[] {
  if (children.length === 0) return [];

  const [pt, pr, pb, pl] = layoutStyle.padding;
  const columnGap = layoutStyle.columnGap ?? layoutStyle.gap;
  const rowGap = layoutStyle.rowGap ?? layoutStyle.gap;
  const availW = Math.max(0, parentW - pl - pr);
  const availH = Math.max(0, parentH - pt - pb);
  const gridAutoFlow = layoutStyle.gridAutoFlow ?? 'row';

  const cols = parseGridTracks(layoutStyle.gridTemplateColumns ?? '', availW, columnGap);
  const rows = parseGridTracks(layoutStyle.gridTemplateRows ?? '', availH, rowGap);

  const explicitCols = cols.length > 0 ? cols : [-1];
  const explicitRows = rows.length > 0 ? rows : [availH];

  const childNodes = children
    .map((cid) => doc.nodes[cid])
    .filter((n): n is SceneNode => n !== undefined && isFlowParticipant(n));

  const explicitPlacements: Array<{
    childIndex: number;
    colStart: number;
    colEnd: number;
    rowStart: number;
    rowEnd: number;
  }> = [];
  const autoFlowIndices: number[] = [];

  for (let i = 0; i < childNodes.length; i++) {
    const child = childNodes[i];
    if (!child) continue;
    const g = child.gridPlacement;
    if (g && (g.gridColumnStart != null || g.gridRowStart != null)) {
      explicitPlacements.push({
        childIndex: i,
        colStart: g.gridColumnStart ?? 1,
        colEnd: g.gridColumnEnd ?? (g.gridColumnStart ?? 1) + 1,
        rowStart: g.gridRowStart ?? 1,
        rowEnd: g.gridRowEnd ?? (g.gridRowStart ?? 1) + 1,
      });
    } else {
      autoFlowIndices.push(i);
    }
  }

  // Build grid placement matrix
  const usedCells = new Set<string>();
  const assignments: CellAssignment[] = [];

  for (const ep of explicitPlacements) {
    const cs = ep.colStart - 1;
    const ce = ep.colEnd - 1;
    const rs = ep.rowStart - 1;
    const re = ep.rowEnd - 1;
    const colSpan = Math.max(1, ce - cs);
    const rowSpan = Math.max(1, re - rs);
    for (let c = cs; c < cs + colSpan; c++) {
      for (let r = rs; r < rs + rowSpan; r++) {
        usedCells.add(`${c},${r}`);
      }
    }
    assignments.push({ childIndex: ep.childIndex, col: cs, row: rs, colSpan, rowSpan });
  }

  // Auto-flow remaining items
  if (gridAutoFlow === 'column' || gridAutoFlow === 'columnDense') {
    let col = 0;
    let row = 0;
    for (const idx of autoFlowIndices) {
      if (gridAutoFlow === 'columnDense') {
        let found = false;
        for (let c = 0; !found; c++) {
          for (let r = 0; r <= Math.max(row, explicitRows.length - 1); r++) {
            if (!usedCells.has(`${c},${r}`)) {
              col = c;
              row = r;
              found = true;
              break;
            }
          }
        }
      } else {
        while (usedCells.has(`${col},${row}`)) {
          row++;
          if (row >= Math.max(explicitRows.length, 1)) {
            row = 0;
            col++;
          }
        }
      }
      usedCells.add(`${col},${row}`);
      assignments.push({ childIndex: idx, col, row, colSpan: 1, rowSpan: 1 });
      row++;
      if (row >= Math.max(explicitRows.length, 1)) {
        row = 0;
        col++;
      }
    }
  } else {
    let col = 0;
    let row = 0;
    for (const idx of autoFlowIndices) {
      if (gridAutoFlow === 'rowDense') {
        let found = false;
        for (let r = 0; !found; r++) {
          for (let c = 0; c <= Math.max(col, explicitCols.length - 1); c++) {
            if (!usedCells.has(`${c},${r}`)) {
              col = c;
              row = r;
              found = true;
              break;
            }
          }
        }
      } else {
        while (usedCells.has(`${col},${row}`)) {
          col++;
          if (col >= explicitCols.length) {
            col = 0;
            row++;
          }
        }
      }
      usedCells.add(`${col},${row}`);
      assignments.push({ childIndex: idx, col, row, colSpan: 1, rowSpan: 1 });
      col++;
      if (col >= explicitCols.length) {
        col = 0;
        row++;
      }
    }
  }

  let maxCol = explicitCols.length;
  let maxRow = explicitRows.length;
  for (const a of assignments) {
    maxCol = Math.max(maxCol, a.col + a.colSpan);
    maxRow = Math.max(maxRow, a.row + a.rowSpan);
  }

  const resolvedCols: number[] = [];
  for (let c = 0; c < maxCol; c++) {
    if (c < explicitCols.length) {
      resolvedCols.push(explicitCols[c] ?? 100);
    } else {
      resolvedCols.push(explicitCols[explicitCols.length - 1] ?? 100);
    }
  }

  const resolvedRows: number[] = [];
  for (let r = 0; r < maxRow; r++) {
    if (r < explicitRows.length) {
      resolvedRows.push(explicitRows[r] ?? 100);
    } else {
      resolvedRows.push(explicitRows[explicitRows.length - 1] ?? 100);
    }
  }

  const columnMap: number[] = [];
  const rowMap: number[] = [];
  for (const a of assignments) {
    columnMap[a.childIndex] = a.col;
    rowMap[a.childIndex] = a.row;
  }
  const resolvedColSizes = resolveAutoTracks(
    resolvedCols,
    childNodes,
    columnMap,
    false,
    layoutStyle.includeBordersInLayout === true,
  );
  const resolvedRowSizes = resolveAutoTracks(
    resolvedRows,
    childNodes,
    rowMap,
    true,
    layoutStyle.includeBordersInLayout === true,
  );

  const colPositions: number[] = [pl];
  for (let c = 0; c < resolvedColSizes.length; c++) {
    const prev = colPositions[c] ?? 0;
    colPositions.push(prev + (resolvedColSizes[c] ?? 0) + columnGap);
  }

  const rowPositions: number[] = [pt];
  for (let r = 0; r < resolvedRowSizes.length; r++) {
    const prev = rowPositions[r] ?? 0;
    rowPositions.push(prev + (resolvedRowSizes[r] ?? 0) + rowGap);
  }

  const results: GridItem[] = [];
  for (const a of assignments) {
    const childId = childNodes[a.childIndex]?.id;
    if (!childId) continue;
    const cw =
      resolvedColSizes.slice(a.col, a.col + a.colSpan).reduce((s, v) => s + v + columnGap, 0) -
      columnGap;
    const rh =
      resolvedRowSizes.slice(a.row, a.row + a.rowSpan).reduce((s, v) => s + v + rowGap, 0) - rowGap;
    results.push({
      id: childId,
      x: colPositions[a.col] ?? 0,
      y: rowPositions[a.row] ?? 0,
      w: Math.max(0, cw),
      h: Math.max(0, rh),
    });
  }

  return results;
}

/**
 * Apply computed grid layout to document children.
 */
export function applyGridLayout(doc: Document, parentId: NodeId): Document {
  if (!parentId) return doc;
  const parent = doc.nodes[parentId];
  if (parent?.kind !== 'frame') return doc;
  if (!parent.layoutStyle) return doc;
  if (parent.layoutStyle.mode !== 'grid') return doc;

  const childIds = parent.children;
  if (childIds.length === 0) return doc;

  const results = computeGridLayout(
    doc,
    parentId,
    parent.w,
    parent.h,
    parent.layoutStyle,
    childIds,
  );
  if (results.length === 0) return doc;

  const nodes = { ...doc.nodes };
  for (const r of results) {
    const child = nodes[r.id];
    if (child) {
      const current = measureNodeSize(child);
      const wantW = axisSizing(child, 'width') === 'fixed' ? current.w : r.w;
      const wantH = axisSizing(child, 'height') === 'fixed' ? current.h : r.h;
      let updated = child;
      if (Math.abs(current.w - wantW) > 0.001 || Math.abs(current.h - wantH) > 0.001) {
        updated = resizeNodeGeometry(updated, wantW, wantH);
      }
      const transform = child.transform;
      nodes[r.id] = {
        ...updated,
        transform: [transform[0], transform[1], transform[2], transform[3], r.x, r.y] as const,
      };
    }
  }
  return { ...doc, nodes };
}
