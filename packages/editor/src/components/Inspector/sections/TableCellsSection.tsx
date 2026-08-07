/**
 * TableCellsSection + TableTracksSection — cell, column, and row controls
 * for an active table edit session (ADR-0016).
 *
 * Cell section: text editing, alignment, padding, merge/split, spans.
 * Tracks section: column width mode + row height mode for the selection.
 */

import type { TableCellDefinition, TableModel } from '@varve/scene';
import { mergeCells, setCellStyle, setColumnSizing, setRowSizing, splitCell } from '@varve/scene';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { cellCoordinateOf } from '../../../table/tableNav';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { InspectorColorPopover } from '../controls/InspectorColorPopover';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl } from '../controls/SegmentedControl';

interface Props {
  tableId: string;
}

function tableCellFor(table: TableModel, cellId: string): TableCellDefinition | undefined {
  return table.cells[cellId];
}

export function TableCellsSection({ tableId }: Props) {
  const editor = useEditor();
  const tableEdit = editor.state.tableEdit;
  const tableNode = tableEdit
    ? (editor.state.document.nodes[tableEdit.tableId] as
        | import('@varve/scene').TableNode
        | undefined)
    : undefined;
  const table = tableNode?.table;

  const selection = tableEdit?.cellIds ?? [];
  const activeCellId = tableEdit?.activeCellId ?? selection[0] ?? null;
  const cells = useMemo(() => {
    if (!table) return [];
    return selection
      .map((id) => table.cells[id])
      .filter((c): c is TableCellDefinition => Boolean(c));
  }, [table, selection]);

  if (!table || !tableNode || cells.length === 0) {
    return (
      <DisclosureSection title="Cells" sectionId="table-cells">
        <div className="insp-empty-message">Select cells in the table to edit them</div>
      </DisclosureSection>
    );
  }

  const op = (fn: (t: TableModel) => TableModel): void => editor.tableOp(tableId, fn);
  const patchCells = (fn: (cell: TableCellDefinition, t: TableModel) => TableModel): void =>
    op((t) => {
      let next = t;
      for (const cell of cells) next = fn(next.cells[cell.id]!, next);
      return next;
    });

  const alignH = cells.every((c) => c.style?.alignH === 'center')
    ? 'center'
    : cells.every((c) => c.style?.alignH === 'right')
      ? 'right'
      : cells.every((c) => (c.style?.alignH ?? 'left') === 'left')
        ? 'left'
        : null;

  const alignV = cells.every((c) => c.style?.alignV === 'top')
    ? 'top'
    : cells.every((c) => c.style?.alignV === 'bottom')
      ? 'bottom'
      : cells.every((c) => (c.style?.alignV ?? 'middle') === 'middle')
        ? 'middle'
        : null;

  const first = cells[0]!;
  const owner = activeCellId ? tableCellFor(table, activeCellId) : first;
  const ownerCoord = activeCellId ? cellCoordinateOf(table, activeCellId) : null;

  const canMerge =
    selection.length > 1 &&
    cells.every((c) => c.rowSpan === 1 && c.columnSpan === 1) &&
    (() => {
      const coords = selection
        .map((id) => cellCoordinateOf(table, id))
        .filter((c): c is { row: number; col: number } => Boolean(c));
      if (coords.length !== selection.length) return false;
      const rows = coords.map((c) => c.row);
      const cols = coords.map((c) => c.col);
      const rowSpan = Math.max(...rows) - Math.min(...rows) + 1;
      const colSpan = Math.max(...cols) - Math.min(...cols) + 1;
      return rowSpan * colSpan === selection.length;
    })();

  const merge = (): void => {
    const coords = selection
      .map((id) => cellCoordinateOf(table, id))
      .filter((c): c is { row: number; col: number } => Boolean(c));
    if (coords.length === 0) return;
    const rows = coords.map((c) => c.row);
    const cols = coords.map((c) => c.col);
    const minRow = Math.min(...rows);
    const minCol = Math.min(...cols);
    const rowSpan = Math.max(...rows) - minRow + 1;
    const colSpan = Math.max(...cols) - minCol + 1;
    op((t) => mergeCells(t, minRow, minCol, rowSpan, colSpan));
  };

  const split = (): void => {
    if (!owner || (owner.rowSpan === 1 && owner.columnSpan === 1)) return;
    op((t) => splitCell(t, owner.id));
  };

  return (
    <DisclosureSection title="Cells" sectionId="table-cells">
      {selection.length === 1 && (
        <FieldRow label="Text">
          <textarea
            className="insp-textarea"
            aria-label="Cell text"
            rows={3}
            defaultValue={owner?.content.kind === 'text' ? owner.content.text : ''}
            onBlur={(e) => {
              const value = e.target.value;
              if (owner && value !== (owner.content.kind === 'text' ? owner.content.text : '')) {
                editor.updateTableCellText(owner.id, value);
              }
            }}
          />
        </FieldRow>
      )}
      {selection.length > 1 && (
        <div className="insp-empty-message">{selection.length} cells selected</div>
      )}
      <FieldRow label="Align">
        <SegmentedControl
          label="Horizontal alignment"
          value={alignH ?? 'left'}
          options={[
            { value: 'left', label: 'Left' },
            { value: 'center', label: 'Center' },
            { value: 'right', label: 'Right' },
          ]}
          onChange={(v) => {
            if (v)
              patchCells((cell, t) =>
                setCellStyle(t, cell.id, { alignH: v as 'left' | 'center' | 'right' }),
              );
          }}
        />
      </FieldRow>
      <FieldRow label="Vertical">
        <SegmentedControl
          label="Vertical alignment"
          value={alignV ?? 'middle'}
          options={[
            { value: 'top', label: 'Top' },
            { value: 'middle', label: 'Middle' },
            { value: 'bottom', label: 'Bottom' },
          ]}
          onChange={(v) => {
            if (v)
              patchCells((cell, t) =>
                setCellStyle(t, cell.id, { alignV: v as 'top' | 'middle' | 'bottom' }),
              );
          }}
        />
      </FieldRow>
      {selection.length === 1 && owner && (
        <FieldRow label="Span">
          <div className="insp-field-row__split">
            <NumberField
              label="Row span"
              value={owner.rowSpan}
              step={1}
              min={1}
              onChange={() => {}}
            />
            <span aria-hidden>|</span>
            <NumberField
              label="Column span"
              value={owner.columnSpan}
              step={1}
              min={1}
              onChange={() => {}}
            />
          </div>
        </FieldRow>
      )}
      {canMerge && (
        <FieldRow label="Merge">
          <button type="button" className="insp-add-btn" onClick={merge}>
            Merge cells
          </button>
        </FieldRow>
      )}
      {owner && (owner.rowSpan > 1 || owner.columnSpan > 1) && (
        <FieldRow label="Split">
          <button type="button" className="insp-add-btn" onClick={split}>
            Split cell
          </button>
        </FieldRow>
      )}
      {selection.length === 1 && owner && (
        <FieldRow label="Cell border">
          <div className="insp-field-row__split">
            <InspectorColorPopover
              label="Cell border colour"
              value={owner.style?.borderColor ?? table.appearance.dividerColor}
              onChange={(c) =>
                patchCells((cell, t) => setCellStyle(t, cell.id, { borderColor: c }))
              }
              documentColorMode={editor.documentColorMode}
            />
            <NumberField
              label="Border width"
              value={owner.style?.borderWidth ?? table.appearance.dividerWidth}
              step={0.5}
              min={0}
              onChange={(v) =>
                patchCells((cell, t) => setCellStyle(t, cell.id, { borderWidth: v }))
              }
            />
          </div>
        </FieldRow>
      )}
      {selection.length === 1 && owner && (
        <FieldRow label="Rich content" wrapLabel>
          {owner.content.kind === 'scene' ? (
            <span className="insp-empty-message">Cell shows node #{owner.content.nodeId}</span>
          ) : (
            <button
              type="button"
              className="insp-add-btn"
              onClick={() => {
                const nodeIds = editor.state.selection.filter(
                  (id) => id !== tableId && editor.state.document.nodes[id],
                );
                if (nodeIds.length === 0) {
                  editor.announce('Select a layer on the canvas to embed it in this cell');
                  return;
                }
                editor.embedSceneContentInCell(tableId, owner.id, nodeIds[0]!);
                editor.announce('Embedded selection as cell content');
              }}
            >
              Use selection as content
            </button>
          )}
        </FieldRow>
      )}
      <div className="insp-empty-message">
        {ownerCoord
          ? `Cell at row ${ownerCoord.row + 1}, column ${ownerCoord.col + 1}`
          : 'Cell selected'}
      </div>
    </DisclosureSection>
  );
}

export function TableTracksSection({ tableId }: Props) {
  const editor = useEditor();
  const tableEdit = editor.state.tableEdit;
  const tableNode = tableEdit
    ? (editor.state.document.nodes[tableEdit.tableId] as
        | import('@varve/scene').TableNode
        | undefined)
    : undefined;
  const table = tableNode?.table;
  if (!table || !tableNode) return null;

  const op = (fn: (t: TableModel) => TableModel): void => editor.tableOp(tableId, fn);

  const active = tableEdit?.activeCellId;
  const coord = active ? cellCoordinateOf(table, active) : null;
  const columnId = coord ? table.columnOrder[coord.col] : undefined;
  const rowId = coord ? table.rowOrder[coord.row] : undefined;
  const column = columnId ? table.columns[columnId] : undefined;
  const row = rowId ? table.rows[rowId] : undefined;

  return (
    <DisclosureSection title="Columns & Rows" sectionId="table-columns">
      <div className="insp-empty-message">
        {column ? `Column ${coord!.col + 1}` : 'No column selected'}
      </div>
      {column && (
        <FieldRow label="Width">
          <SegmentedControl
            label="Width mode"
            value={column.sizing.kind}
            options={[
              { value: 'fixed', label: 'Fixed' },
              { value: 'content', label: 'Content' },
              { value: 'fraction', label: 'Fill' },
              { value: 'percentage', label: '%' },
            ]}
            onChange={(v) => {
              if (!v || !columnId) return;
              const sizing =
                v === 'fixed'
                  ? {
                      kind: 'fixed' as const,
                      value: column.sizing.kind === 'fixed' ? column.sizing.value : 120,
                    }
                  : v === 'content'
                    ? { kind: 'content' as const }
                    : v === 'percentage'
                      ? {
                          kind: 'percentage' as const,
                          value: column.sizing.kind === 'percentage' ? column.sizing.value : 25,
                        }
                      : {
                          kind: 'fraction' as const,
                          value: column.sizing.kind === 'fraction' ? column.sizing.value : 1,
                        };
              op((t) => setColumnSizing(t, columnId, sizing));
            }}
          />
        </FieldRow>
      )}
      {column && column.sizing.kind === 'fixed' && (
        <FieldRow label="Width px">
          <NumberField
            label="Column width"
            value={column.sizing.value}
            step={1}
            min={8}
            onChange={(v) => {
              if (columnId) op((t) => setColumnSizing(t, columnId, { kind: 'fixed', value: v }));
            }}
          />
        </FieldRow>
      )}
      {row && (
        <FieldRow label="Height">
          <SegmentedControl
            label="Height mode"
            value={row.sizing.kind}
            options={[
              { value: 'content', label: 'Content' },
              { value: 'fixed', label: 'Fixed' },
            ]}
            onChange={(v) => {
              if (!v || !rowId) return;
              const sizing =
                v === 'fixed'
                  ? {
                      kind: 'fixed' as const,
                      value: row.sizing.kind === 'fixed' ? row.sizing.value : 40,
                    }
                  : { kind: 'content' as const };
              op((t) => setRowSizing(t, rowId, sizing));
            }}
          />
        </FieldRow>
      )}
      {row && row.sizing.kind === 'fixed' && (
        <FieldRow label="Height px">
          <NumberField
            label="Row height"
            value={row.sizing.value}
            step={1}
            min={8}
            onChange={(v) => {
              if (rowId) op((t) => setRowSizing(t, rowId, { kind: 'fixed', value: v }));
            }}
          />
        </FieldRow>
      )}
      {!column && !row && (
        <div className="insp-empty-message">Select a cell to edit its column or row</div>
      )}
    </DisclosureSection>
  );
}
