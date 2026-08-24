/**
 * TableSection — table-level controls for the Inspector (ADR-0016).
 *
 * Rows/columns, header + frozen counts, density, zebra, gaps, border mode,
 * and structural commands (insert/delete/merge/split) — each command is one
 * coherent undoable transaction through the editor's tableOp path.
 */

import type { TableNode, TableResponsiveRule } from '@varve/scene';
import {
  addResponsiveRule,
  insertColumn,
  insertRow,
  removeColumns,
  removeResponsiveRule,
  removeRows,
  setAppearance,
  setColumnSizing,
  setFrozenColumns,
  setFrozenRows,
  setHeaderColumns,
  setHeaderRows,
  setRowSizing,
  setZebra,
} from '@varve/scene';
import { useMemo, useState } from 'react';
import { useEditor } from '../../../context';
import { DisclosureSection } from '../controls/DisclosureSection';
import { FieldRow } from '../controls/FieldRow';
import { NumberField } from '../controls/NumberField';
import { SegmentedControl, type SegmentedOption } from '../controls/SegmentedControl';
import { TableAppearanceSection } from './TableAppearanceSection';

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
      <FieldRow label="Distribute columns" wrapLabel>
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
      <FieldRow label="Distribute rows" wrapLabel>
        <button
          type="button"
          className="insp-inline-btn"
          onClick={() => {
            editor.beginTransaction();
            const per = Math.max(16, Math.floor(node.h / Math.max(1, rowCount)));
            op((t) => {
              let next = t;
              for (const rowId of t.rowOrder) {
                next = setRowSizing(next, rowId, { kind: 'fixed', value: per });
              }
              return next;
            });
            editor.commitTransaction();
          }}
        >
          Equal heights
        </button>
      </FieldRow>
      <ResponsiveRulesSection table={table} onOp={op} />
      <TableAppearanceSection
        tableId={node.id}
        table={table}
        onSetAppearance={op}
        onSetBinding={(property, binding) => editor.setSelectedBinding(property, binding)}
      />
    </DisclosureSection>
  );
}

/**
 * ResponsiveRulesSection — manage breakpoint rules (ADR-0016 §8).
 *
 * Each rule overrides density or hides columns below a max width.
 * Rules are evaluated in order by the layout engine; the first matching
 * rule wins (see activeResponsiveRule).
 */
function ResponsiveRulesSection({
  table,
  onOp,
}: {
  table: import('@varve/scene').TableModel;
  onOp: (
    fn: (model: import('@varve/scene').TableModel) => import('@varve/scene').TableModel,
  ) => void;
}) {
  const rules = table.responsive.rules;
  const [showAdd, setShowAdd] = useState(false);
  const [minWidth, setMinWidth] = useState(0);
  const [maxWidth, setMaxWidth] = useState(600);
  const [density, setDensity] = useState<import('@varve/scene').TableDensity | ''>('');

  const add = (): void => {
    const rule: TableResponsiveRule = {
      id: `rule-${Date.now().toString(36)}-${Math.floor(Math.random() * 1e4).toString(36)}`,
      condition: {
        ...(minWidth > 0 ? { minWidth } : {}),
        ...(maxWidth > 0 ? { maxWidth } : {}),
      },
      ...(density ? { density } : {}),
    };
    onOp((t) => addResponsiveRule(t, rule));
    setShowAdd(false);
    setMinWidth(0);
    setMaxWidth(600);
    setDensity('');
  };

  const remove = (ruleId: string): void => {
    onOp((t) => removeResponsiveRule(t, ruleId));
  };

  return (
    <div className="insp-field">
      <div className="insp-field__label insp-field__label--wrap">Responsive rules</div>
      <div className="insp-field__control">
        {rules.length === 0 && (
          <div className="insp-empty-message">
            No breakpoint rules — table fills available width.
          </div>
        )}
        {rules.map((rule) => (
          <div key={rule.id} className="insp-field-row__split" style={{ marginBottom: 4 }}>
            <span className="insp-inline-btn" style={{ cursor: 'default', fontWeight: 600 }}>
              {rule.condition.minWidth !== undefined ? `≥ ${rule.condition.minWidth}px` : ''}
              {rule.condition.minWidth !== undefined && rule.condition.maxWidth !== undefined
                ? ' – '
                : ''}
              {rule.condition.maxWidth !== undefined ? `≤ ${rule.condition.maxWidth}px` : ''}
              {rule.density ? ` · ${rule.density}` : ''}
              {rule.hiddenColumnIds?.length ? ` · hides ${rule.hiddenColumnIds.length} col(s)` : ''}
            </span>
            <button
              type="button"
              className="insp-inline-btn"
              aria-label={`Remove responsive rule ${rule.id}`}
              onClick={() => remove(rule.id)}
            >
              <svg
                width="0.8em"
                height="0.8em"
                viewBox="0 0 16 16"
                fill="none"
                stroke="currentColor"
                strokeWidth="2"
                role="img"
                aria-hidden="true"
              >
                <path d="M4 4l8 8M12 4l-8 8" />
              </svg>
            </button>
          </div>
        ))}
        {!showAdd && (
          <button
            type="button"
            className="insp-inline-btn"
            style={{ marginTop: 4 }}
            onClick={() => setShowAdd(true)}
          >
            + Add breakpoint
          </button>
        )}
        {showAdd && (
          <div
            style={{
              display: 'flex',
              flexDirection: 'column',
              gap: 'var(--space-2)',
              marginTop: 4,
            }}
          >
            <div className="insp-field-row__split">
              <NumberField
                label="Min width"
                value={minWidth}
                step={10}
                min={0}
                onChange={setMinWidth}
              />
              <NumberField
                label="Max width"
                value={maxWidth}
                step={10}
                min={0}
                onChange={setMaxWidth}
              />
            </div>
            <SegmentedControl
              label="Rule density"
              value={density || 'comfortable'}
              options={[
                { value: '', label: 'None' },
                { value: 'compact', label: 'Compact' },
                { value: 'spacious', label: 'Spacious' },
              ]}
              onChange={(v) => setDensity(v as import('@varve/scene').TableDensity | '')}
            />
            <div className="insp-field-row__split">
              <button type="button" className="insp-add-btn" onClick={add}>
                Add rule
              </button>
              <button type="button" className="insp-inline-btn" onClick={() => setShowAdd(false)}>
                Cancel
              </button>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}
