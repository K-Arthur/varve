/**
 * TableEditOverlay — cell selection highlights, column-resize handles,
 * frozen-region markers, and keyboard navigation for an active table edit
 * session (ADR-0016).
 *
 * All geometry is computed from the shared deterministic layout cache, so
 * the overlay and the painted table always agree.
 */

import { setCellContent, setColumnSizing, TABLE_LAYOUT_MIN_TRACK } from '@varve/scene';
import { useCallback, useEffect, useMemo, useRef } from 'react';
import { useEditor } from '../../context';
import {
  cellAtPoint,
  getTableLayout,
  columnBoundaries as tableColumnBoundaries,
} from '../../render/tableCompile';
import { cellCoordinateOf, cellsInRange, moveCursor, tabCursor } from '../../table/tableNav';

interface Props {
  zoom: number;
  pan: { x: number; y: number };
  cameraRotation: number;
  worldToScreen: (wx: number, wy: number) => [number, number];
}

const CANVAS_INTERACTIVE_OVERLAY_Z_INDEX = 10;

export function TableEditOverlay({ zoom, pan, cameraRotation, worldToScreen }: Props) {
  const editor = useEditor();
  const tableEdit = editor.state.tableEdit;
  const doc = editor.state.document;
  const tableNode = tableEdit
    ? (doc.nodes[tableEdit.tableId] as import('@varve/scene').TableNode | undefined)
    : undefined;
  const dragRef = useRef<{ columnIdx: number; startX: number; startWidth: number } | null>(null);
  const overlayRef = useRef<HTMLDivElement>(null);

  const layout = useMemo(() => {
    if (!tableNode) return null;
    return getTableLayout(tableNode, tableNode.table, tableNode.w ?? 480, tableNode.h ?? 240);
  }, [tableNode]);

  const worldMat = useMemo(() => {
    if (!tableEdit) return null;
    return editor.getWorldTransform(tableEdit.tableId);
  }, [editor, tableEdit]);

  const patchEdit = useCallback(
    (partial: Partial<NonNullable<typeof tableEdit>>) => {
      if (!tableEdit) return;
      editor.setTableEdit({ ...tableEdit, ...partial });
    },
    [editor, tableEdit],
  );

  const moveSelection = useCallback(
    (dir: 'up' | 'down' | 'left' | 'right' | 'tab', reverse: boolean, extend: boolean) => {
      if (!tableNode || !tableEdit?.activeCellId) return;
      const cursor = cellCoordinateOf(tableNode.table, tableEdit.activeCellId);
      if (!cursor) return;
      const next =
        dir === 'tab'
          ? tabCursor(tableNode.table, cursor, reverse)
          : moveCursor(tableNode.table, cursor, dir);
      const nextCell = cellsInRange(tableNode.table, next, next)[0];
      if (!nextCell) return;
      if (extend) {
        const anchorId = tableEdit.anchorCellId ?? tableEdit.cellIds[0] ?? nextCell;
        const anchor = cellCoordinateOf(tableNode.table, anchorId);
        if (anchor) {
          patchEdit({
            activeCellId: nextCell,
            cellIds: cellsInRange(tableNode.table, anchor, next),
          });
          return;
        }
      }
      patchEdit({ activeCellId: nextCell, cellIds: [nextCell], anchorCellId: nextCell });
    },
    [tableNode, tableEdit, patchEdit],
  );

  const clearSelectionCells = useCallback(() => {
    if (!tableNode || !tableEdit || tableEdit.cellIds.length === 0) return;
    editor.tableOp(tableEdit.tableId, (table) => {
      let next = table;
      for (const cellId of tableEdit.cellIds) {
        if (next.cells[cellId]) next = setCellContent(next, cellId, { kind: 'empty' });
      }
      return next;
    });
  }, [editor, tableNode, tableEdit]);

  useEffect(() => {
    if (!tableEdit || !tableNode) return;
    const onKeyDown = (e: KeyboardEvent): void => {
      const target = e.target as HTMLElement | null;
      if (
        target &&
        (target.tagName === 'INPUT' || target.tagName === 'TEXTAREA' || target.isContentEditable)
      ) {
        return;
      }
      switch (e.key) {
        case 'ArrowUp':
          e.preventDefault();
          moveSelection('up', false, e.shiftKey);
          break;
        case 'ArrowDown':
          e.preventDefault();
          moveSelection('down', false, e.shiftKey);
          break;
        case 'ArrowLeft':
          e.preventDefault();
          moveSelection('left', false, e.shiftKey);
          break;
        case 'ArrowRight':
          e.preventDefault();
          moveSelection('right', false, e.shiftKey);
          break;
        case 'Tab':
          e.preventDefault();
          moveSelection('tab', e.shiftKey, e.shiftKey);
          break;
        case 'Enter': {
          e.preventDefault();
          const firstCell = Object.keys(tableNode.table.cellIndex)[0] ?? null;
          const cellId = tableEdit.activeCellId ?? tableEdit.cellIds[0] ?? firstCell;
          if (cellId) {
            patchEdit({ activeCellId: cellId, editingCellId: cellId });
            editor.announce('Editing cell');
          }
          break;
        }
        case 'Escape':
          e.preventDefault();
          if (tableEdit.editingCellId) {
            patchEdit({ editingCellId: null });
          } else {
            editor.setTableEdit(null);
            editor.announce('Exited table editing');
          }
          break;
        case 'Delete':
        case 'Backspace':
          if (tableEdit.editingCellId) break;
          e.preventDefault();
          clearSelectionCells();
          break;
      }
    };
    // Capture phase: cell navigation must win over the global shortcut
    // system (shift+arrows are selection shortcuts app-wide).
    window.addEventListener('keydown', onKeyDown, true);
    return () => window.removeEventListener('keydown', onKeyDown, true);
  }, [tableEdit, tableNode, moveSelection, clearSelectionCells, patchEdit, editor]);

  // Column resize via pointer drag on handle lines.
  // Transaction coalescing: begin on first move, commit on pointer up →
  // the whole drag is ONE coherent undo entry, matching NumberField scrubbing.
  const onHandlePointerDown = useCallback(
    (e: React.PointerEvent, columnIdx: number) => {
      if (!tableNode || !layout || !tableEdit) return;
      e.preventDefault();
      e.stopPropagation();
      dragRef.current = {
        columnIdx,
        startX: e.clientX,
        startWidth: layout.colWidths[columnIdx] ?? TABLE_LAYOUT_MIN_TRACK,
      };
      const capture = (e.target as HTMLElement).ownerDocument;
      let transactionOpen = false;
      const onMove = (ev: PointerEvent): void => {
        if (!dragRef.current) return;
        const dx = (ev.clientX - dragRef.current.startX) / zoom;
        const nextWidth = Math.max(TABLE_LAYOUT_MIN_TRACK, dragRef.current.startWidth + dx);
        const columnId = tableNode.table.columnOrder[columnIdx];
        if (!columnId) return;
        if (!transactionOpen) {
          editor.beginTransaction();
          transactionOpen = true;
        }
        editor.tableOp(tableEdit.tableId, (table) =>
          setColumnSizing(table, columnId, { kind: 'fixed', value: nextWidth }),
        );
      };
      const onUp = (): void => {
        if (transactionOpen) {
          editor.commitTransaction();
          transactionOpen = false;
        }
        dragRef.current = null;
        capture.removeEventListener('pointermove', onMove);
        capture.removeEventListener('pointerup', onUp);
      };
      capture.addEventListener('pointermove', onMove);
      capture.addEventListener('pointerup', onUp);
    },
    [tableNode, layout, tableEdit, editor, zoom],
  );

  // Cell click: select (double-click handled by SelectTool entering edit mode).
  const onOverlayPointerDown = useCallback(
    (e: React.PointerEvent): void => {
      if (!tableNode || !tableEdit || !worldMat || !layout) return;
      if (dragRef.current) return;
      const rect = (e.currentTarget as HTMLElement).getBoundingClientRect();
      const world = editor.canvasToWorld(e.clientX - rect.left, e.clientY - rect.top);
      const local = { x: world.x - (worldMat[4] ?? 0), y: world.y - (worldMat[5] ?? 0) };
      const hit = cellAtPoint(layout, local.x, local.y);
      if (!hit) return;
      const cellId = tableNode.table.cellIndex[`${hit.rowIdx},${hit.columnIdx}`];
      if (!cellId) return;
      if (e.shiftKey && tableEdit.activeCellId) {
        const anchor = cellCoordinateOf(
          tableNode.table,
          tableEdit.anchorCellId ?? tableEdit.activeCellId,
        ) ?? {
          row: hit.rowIdx,
          col: hit.columnIdx,
        };
        patchEdit({
          cellIds: cellsInRange(tableNode.table, anchor, { row: hit.rowIdx, col: hit.columnIdx }),
        });
      } else {
        patchEdit({
          cellIds: [cellId],
          activeCellId: cellId,
          editingCellId: null,
          anchorCellId: cellId,
        });
      }
    },
    [tableNode, tableEdit, worldMat, layout, patchEdit, zoom, pan, cameraRotation],
  );

  if (!tableNode || !tableEdit || !layout || !worldMat) return null;
  const table = tableNode.table;
  const topLeft = worldToScreen(worldMat[4], worldMat[5]);
  const scale = zoom;
  const cellLayouts = layout.cellLayouts;
  const selectedSet = new Set(tableEdit.cellIds);
  const activeCell = tableEdit.activeCellId;

  const screenOf = (x: number, y: number): [number, number] =>
    worldToScreen(worldMat[4] + x, worldMat[5] + y);

  // Column handles: one per internal boundary (visible columns only).
  const boundaries = tableColumnBoundaries(layout);

  const frozenY =
    table.frozenRows > 0
      ? (layout.rowPositions[Math.min(table.frozenRows, layout.rowPositions.length)] ?? 0)
      : null;
  const frozenX =
    table.frozenColumns > 0
      ? (layout.colPositions[Math.min(table.frozenColumns, layout.colPositions.length)] ?? 0)
      : null;

  return (
    <div
      ref={overlayRef}
      className="table-edit-overlay"
      style={{
        position: 'absolute',
        inset: 0,
        pointerEvents: 'auto',
        zIndex: CANVAS_INTERACTIVE_OVERLAY_Z_INDEX,
        touchAction: 'none',
      }}
      onPointerDown={onOverlayPointerDown}
      role="application"
      aria-label="Table editing"
    >
      <svg
        width="100%"
        height="100%"
        style={{ position: 'absolute', inset: 0, overflow: 'visible' }}
      >
        <title>Table editing overlay</title>
        {cellLayouts.map((cell) => {
          if (!selectedSet.has(cell.id)) return null;
          const [sx, sy] = screenOf(cell.x, cell.y);
          return (
            <rect
              key={cell.id}
              x={sx}
              y={sy}
              width={cell.w * scale}
              height={cell.h * scale}
              fill="rgba(57, 208, 198, 0.16)"
              stroke="var(--color-accent-primary, #39d0c6)"
              strokeWidth={1.5 / scale}
              vectorEffect="non-scaling-stroke"
            />
          );
        })}
        {activeCell &&
          (() => {
            const coord = cellCoordinateOf(table, activeCell);
            if (!coord) return null;
            const cell = cellLayouts.find(
              (c) => c.rowIdx === coord.row && c.columnIdx === coord.col,
            );
            if (!cell) return null;
            const [sx, sy] = screenOf(cell.x, cell.y);
            return (
              <rect
                x={sx}
                y={sy}
                width={cell.w * scale}
                height={cell.h * scale}
                fill="none"
                stroke="var(--color-accent-primary, #39d0c6)"
                strokeWidth={2.5 / scale}
                vectorEffect="non-scaling-stroke"
              />
            );
          })()}
        {frozenY !== null && (
          <line
            x1={topLeft[0]}
            y1={screenOf(0, frozenY)[1]}
            x2={topLeft[0] + (layout.totalW || tableNode.w) * scale}
            y2={screenOf(0, frozenY)[1]}
            stroke="rgba(57, 208, 198, 0.55)"
            strokeWidth={2 / scale}
            strokeDasharray={`${6 / scale} ${4 / scale}`}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {frozenX !== null && (
          <line
            x1={screenOf(frozenX, 0)[0]}
            y1={topLeft[1]}
            x2={screenOf(frozenX, 0)[0]}
            y2={topLeft[1] + (layout.totalH || tableNode.h) * scale}
            stroke="rgba(57, 208, 198, 0.55)"
            strokeWidth={2 / scale}
            strokeDasharray={`${6 / scale} ${4 / scale}`}
            vectorEffect="non-scaling-stroke"
          />
        )}
        {boundaries.map((x, i) => (
          <line
            key={`col-${x}`}
            x1={screenOf(x, 0)[0]}
            y1={topLeft[1]}
            x2={screenOf(x, 0)[0]}
            y2={topLeft[1] + (layout.totalH || tableNode.h) * scale}
            stroke="transparent"
            strokeWidth={Math.max(4, 8 / scale)}
            style={{ cursor: 'col-resize' }}
            vectorEffect="non-scaling-stroke"
            onPointerDown={(e) => onHandlePointerDown(e, i + 1)}
          />
        ))}
      </svg>
    </div>
  );
}
