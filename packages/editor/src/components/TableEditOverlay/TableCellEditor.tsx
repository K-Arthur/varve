/**
 * TableCellEditor — inline text editing for a table cell (ADR-0016).
 *
 * An absolutely-positioned textarea over the editing cell; commits through
 * the normal undoable document path. Escape cancels, blur commits.
 */
import { useEffect, useLayoutEffect, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { getTableLayout } from '../../render/tableCompile';
import { cellCoordinateOf } from '../../table/tableNav';

interface Props {
  cellId: string;
  zoom: number;
  worldToScreen: (wx: number, wy: number) => [number, number];
  onDone: () => void;
}

export function TableCellEditor({ cellId, zoom, worldToScreen, onDone }: Props) {
  const editor = useEditor();
  const tableEdit = editor.state.tableEdit;
  const tableNode = tableEdit
    ? (editor.state.document.nodes[tableEdit.tableId] as
        | import('@varve/scene').TableNode
        | undefined)
    : undefined;
  const [text, setText] = useState('');
  const taRef = useRef<HTMLTextAreaElement>(null);
  const committedRef = useRef(false);

  const worldMat = tableEdit ? editor.getWorldTransform(tableEdit.tableId) : null;

  useEffect(() => {
    if (!tableNode) return;
    const cell = tableNode.table.cells[cellId];
    setText(cell?.content.kind === 'text' ? cell.content.text : '');
  }, [tableNode, cellId]);

  useLayoutEffect(() => {
    taRef.current?.focus();
    taRef.current?.select();
  }, []);

  const commit = (): void => {
    if (committedRef.current) return;
    committedRef.current = true;
    editor.updateTableCellText(cellId, text);
    onDone();
  };

  if (!tableNode || !tableEdit || !worldMat) return null;
  const layout = getTableLayout(tableNode, tableNode.table, tableNode.w ?? 480, tableNode.h ?? 240);
  const coord = cellCoordinateOf(tableNode.table, cellId);
  if (!coord) return null;
  const cell = layout.cellLayouts.find((c) => c.rowIdx === coord.row && c.columnIdx === coord.col);
  if (!cell) return null;
  const [sx, sy] = worldToScreen(worldMat[4] + cell.x, worldMat[5] + cell.y);

  return (
    <textarea
      ref={taRef}
      className="table-cell-editor"
      value={text}
      onChange={(e) => setText(e.target.value)}
      onBlur={commit}
      onKeyDown={(e) => {
        e.stopPropagation();
        if (e.key === 'Enter' && !e.shiftKey) {
          e.preventDefault();
          commit();
        } else if (e.key === 'Escape') {
          e.preventDefault();
          committedRef.current = true;
          onDone();
        }
      }}
      aria-label="Cell text"
      style={{
        position: 'absolute',
        left: sx,
        top: sy,
        width: Math.max(20, cell.w * zoom),
        height: Math.max(20, cell.h * zoom),
        padding: `${Math.max(0, (tableNode.table.appearance.cellPadding ?? 8) * zoom)}px`,
        fontSize: `${13 * zoom}px`,
        lineHeight: 1.35,
        fontFamily: 'var(--font-display, sans-serif)',
        fontWeight: cell.isHeader ? 600 : 400,
        color: cell.isHeader
          ? 'var(--color-text-strong, #292d36)'
          : 'var(--color-text-strong, #292d36)',
        background: 'var(--color-surface-raised, rgba(255,255,255,0.92))',
        border: '2px solid var(--color-accent-primary, #39d0c6)',
        borderRadius: 2,
        boxShadow: '0 2px 10px rgba(0,0,0,0.18)',
        resize: 'none',
        overflow: 'hidden',
        whiteSpace: 'pre-wrap',
        zIndex: 30,
        boxSizing: 'border-box',
      }}
    />
  );
}
