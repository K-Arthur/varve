/**
 * TableSection — table-level controls for the Inspector (ADR-0016).
 *
 * Rows/columns, header + frozen counts, density, zebra, gaps, border mode,
 * and structural commands (insert/delete/merge/split) — each command is one
 * coherent undoable transaction through the editor's tableOp path.
 */

import type { TableNode } from '@varve/scene';
import {
  insertColumn,
  insertRow,
  removeColumns,
  removeRows,
  setAppearance,
  setColumnSizing,
  setFrozenColumns,
  setFrozenRows,
  setHeaderColumns,
  setHeaderRows,
  setZebra,
} from '@varve/scene';
import { useMemo } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl, type SegmentedOption } from '../controls/SegmentedControl';

interface Props {
  node: TableNode;
}

const DENSITY_OPTIONS: SegmentedOption<'compact' | 'comfortable' | 'spacious'>[] = [
  { value: 'compact', label: 'Compact' },
  { value: 'comfortable', label: 'Comfortable' },
  { value: 'spacious', label: 'Spacious' },
];

export function TableSection({ node }: Props) {
  const editor = useEditor();
  const table = node.table;
  const rowCount = table.rowOrder.length;
  const columnCount = table.columnOrder.length;

  const op = (fn: (model: typeof table) => typeof table): void => {
    editor.tableOp(node.id, fn);
  };

  const structure = useMemo(
    () => [
      {
        label: 'Rows',
        singular: 'Row',
        value: rowCount,
        onInsert: (n: number) => op((t) => insertRow(t, t.rowOrder.length, n)),
        onRemove: (n: number) =>
          op((t) =>
            removeRows(
              t,
              Array.from({ length: n }, (_, i) => t.rowOrder.length - 1 - i),
            ),
          ),
      },
      {
        label: 'Columns',
        singular: 'Column',
        value: columnCount,
        onInsert: (n: number) => op((t) => insertColumn(t, t.columnOrder.length, n)),
        onRemove: (n: number) =>
          op((t) =>
            removeColumns(
              t,
              Array.from({ length: n }, (_, i) => t.columnOrder.length - 1 - i),
            ),
          ),
      },
    ],
    [node.id, rowCount, columnCount],
  );

  return (
    <DisclosureSection title="Table" sectionId="table">
      {structure.map((row) => (
        <div key={row.label} className="insp-field">
          <label className="insp-field__label">{row.label}</label>
          <div className="insp-field__control">
            <div className="insp-field-row__split">
              <NumberField
                label={row.label}
                value={row.value}
                step={1}
                min={0}
                onChange={(v) => {
                  const diff = Math.floor(v) - row.value;
                  if (diff > 0) row.onInsert(diff);
                  else if (diff < 0) row.onRemove(-diff);
                }}
              />
              <button
                type="button"
                className="insp-inline-btn"
                aria-label={`Add ${row.singular.toLowerCase()}`}
                onClick={() => row.onInsert(1)}
              >
                +
              </button>
              <button
                type="button"
                className="insp-inline-btn"
                aria-label={`Remove ${row.singular.toLowerCase()}`}
                onClick={() => row.onRemove(1)}
              >
                −
              </button>
            </div>
          </div>
        </div>
      ))}

      <NumberField
        label="Header rows"
        value={table.headerRows}
        step={1}
        min={0}
        max={rowCount}
        onChange={(v) => op((t) => setHeaderRows(t, v))}
      />
      <NumberField
        label="Header columns"
        value={table.headerColumns}
        step={1}
        min={0}
        max={columnCount}
        onChange={(v) => op((t) => setHeaderColumns(t, v))}
      />
      <NumberField
        label="Frozen rows"
        value={table.frozenRows}
        step={1}
        min={0}
        max={rowCount}
        onChange={(v) => op((t) => setFrozenRows(t, v))}
      />
      <NumberField
        label="Frozen columns"
        value={table.frozenColumns}
        step={1}
        min={0}
        max={columnCount}
        onChange={(v) => op((t) => setFrozenColumns(t, v))}
      />
      <FieldRow label="Density">
        <SegmentedControl
          label="Density"
          value={table.appearance.density}
          options={DENSITY_OPTIONS}
          onChange={(v) => op((t) => setAppearance(t, { density: v }))}
        />
      </FieldRow>
      <FieldRow label="Zebra stripes">
        <input
          type="checkbox"
          aria-label="Zebra stripes"
          checked={table.appearance.zebra}
          onChange={(e) => op((t) => setZebra(t, e.target.checked))}
        />
      </FieldRow>
      <NumberField
        label="Row gap"
        value={table.appearance.rowGap}
        step={1}
        min={0}
        onChange={(v) => op((t) => setAppearance(t, { rowGap: v }))}
      />
      <NumberField
        label="Column gap"
        value={table.appearance.columnGap}
        step={1}
        min={0}
        onChange={(v) => op((t) => setAppearance(t, { columnGap: v }))}
      />
      <FieldRow label="Border mode">
        <SegmentedControl
          label="Border mode"
          value={table.appearance.borderCollapse}
          options={[
            { value: 'collapse', label: 'Collapse' },
            { value: 'separate', label: 'Separate' },
          ]}
          onChange={(v) => op((t) => setAppearance(t, { borderCollapse: v }))}
        />
      </FieldRow>
      <NumberField
        label="Border width"
        value={table.appearance.borderWidth}
        step={1}
        min={0}
        onChange={(v) => op((t) => setAppearance(t, { borderWidth: v }))}
      />
      <NumberField
        label="Corner radius"
        value={table.appearance.cornerRadius}
        step={1}
        min={0}
        onChange={(v) => op((t) => setAppearance(t, { cornerRadius: v }))}
      />
      <FieldRow label="Distribute columns">
        <button
          type="button"
          className="insp-inline-btn"
          onClick={() => {
            editor.beginTransaction();
            const per = Math.floor(node.w / columnCount);
            op((t) => {
              let next = t;
              for (const columnId of t.columnOrder) {
                next = setColumnSizing(next, columnId, { kind: 'fixed', value: per });
              }
              return next;
            });
            editor.commitTransaction();
          }}
        >
          Equal widths
        </button>
      </FieldRow>
    </DisclosureSection>
  );
}
