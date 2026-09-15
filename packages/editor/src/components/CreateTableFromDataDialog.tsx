/**
 * CreateTableFromDataDialog — paste TSV/CSV/Markdown, preview, commit as a
 * native table (ADR-0016 §17/§19). One undoable insertion; empty cells and
 * ragged rows are preserved; a first-row header toggle maps to headerRoles.
 *
 * Built on @varve/ui's Dialog: native showModal() owns the top layer, the
 * inert background, focus containment/restoration, Escape, and the nested
 * overlay guard for the format Select; the paste workflow owns only its own
 * content.
 */

import { parseDelimitedText, parseMarkdownTable } from '@varve/import';
import { makeTableNode, nextNodeId } from '@varve/scene';
import { Button, Dialog, Select } from '@varve/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../context';
import { addNodeToActiveWorkspace } from '../scene/activeWorkspace';
import './CreateTableFromDataDialog.css';

export interface CreateTableFromDataDialogProps {
  open: boolean;
}

export function CreateTableFromDataDialog({ open }: CreateTableFromDataDialogProps) {
  const editor = useEditor();
  const [input, setInput] = useState('');
  const [delimiter, setDelimiter] = useState<'auto' | ',' | '\t' | ';' | 'markdown'>('auto');
  const [headerRow, setHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);

  const parsed = useMemo(() => {
    if (!input.trim()) return { rows: [] as string[][], warnings: [] as string[] };
    try {
      if (delimiter === 'markdown' || /^\s*\|.*\|\s*$/.test(input.trim().split('\n')[0] ?? '')) {
        return parseMarkdownTable(input);
      }
      if (delimiter === 'auto') {
        const tabScore = (input.split('\n')[0] ?? '').split('\t').length;
        const commaScore = (input.split('\n')[0] ?? '').split(',').length;
        const semiScore = (input.split('\n')[0] ?? '').split(';').length;
        const d: ',' | '\t' | ';' =
          tabScore > commaScore && tabScore > semiScore
            ? '\t'
            : commaScore >= semiScore
              ? ','
              : ';';
        return parseDelimitedText(input, { delimiter: d });
      }
      return parseDelimitedText(input, { delimiter });
    } catch (err) {
      setError(err instanceof Error ? err.message : String(err));
      return { rows: [] as string[][], warnings: [] as string[] };
    }
  }, [input, delimiter]);

  const rows = parsed.rows;
  const cols = rows.reduce((m, r) => Math.max(m, r.length), 0);
  const previewRows = rows.slice(0, 8);
  const truncated = rows.length > 8;

  const close = (): void => {
    editor.patch({ createTableFromDataOpen: false });
  };

  const commit = (): void => {
    if (rows.length === 0) {
      setCommitError('Nothing to create — paste some data first.');
      return;
    }
    setCommitError(null);
    const rowData = rows;
    const colCount = cols;
    const headerRows = headerRow ? 1 : 0;
    let createdId: string | null = null;
    editor.updateDoc((doc) => {
      const { id, doc: withId } = nextNodeId(doc);
      createdId = id;
      let table = makeTableNode(id, {
        name: 'Table',
        rows: rowData.length,
        columns: colCount,
        headerRows,
        w: Math.max(320, colCount * 96),
        h: Math.max(120, rowData.length * 32),
        columnSizing: { kind: 'fraction', value: 1 },
      });
      // Fill cell content row-major.
      rowData.forEach((row, r) => {
        row.forEach((text, c) => {
          const cellId = table.table.cellIndex[`${r},${c}`];
          if (!cellId) return;
          table = {
            ...table,
            table: {
              ...table.table,
              cells: {
                ...table.table.cells,
                [cellId]: { ...table.table.cells[cellId]!, content: { kind: 'text', text } },
              },
            },
          };
        });
      });
      // Editor-created layers belong to the active surface (design canvas or
      // publishing page), not the raw document root: appending to
      // rootChildren left the table out of the Layers panel and the pages it
      // belongs to.
      return addNodeToActiveWorkspace(withId, table, editor.state.workspaceMode);
    });
    if (createdId) editor.setSelection(createdId);
    editor.announce(`Created table with ${rows.length} rows and ${cols} columns`);
    setInput('');
    close();
  };

  return (
    <Dialog
      open={open}
      onClose={close}
      title="Create table from data"
      // The paste area is the reason the dialog exists.
      focusFirstControl
      footer={
        <div className="create-table-dialog__actions">
          <Button variant="ghost" onClick={close}>
            Cancel
          </Button>
          <Button variant="default" onClick={commit} disabled={rows.length === 0}>
            Create table
          </Button>
        </div>
      }
    >
      <div className="create-table-dialog">
        <textarea
          data-autofocus
          aria-label="Paste CSV, TSV, or Markdown table"
          className="create-table-dialog__input"
          value={input}
          onChange={(e) => setInput(e.target.value)}
          placeholder={'Paste spreadsheet data (tab or comma separated) or a Markdown table…'}
          rows={6}
        />

        <div className="create-table-dialog__row">
          <span className="create-table-dialog__field">
            Format
            <Select
              label="Input format"
              value={delimiter}
              options={[
                { value: 'auto', label: 'Auto-detect' },
                { value: '\t', label: 'Tab (TSV)' },
                { value: ',', label: 'Comma (CSV)' },
                { value: ';', label: 'Semicolon' },
                { value: 'markdown', label: 'Markdown' },
              ]}
              onChange={(v) => setDelimiter(v as typeof delimiter)}
            />
          </span>
          <label className="create-table-dialog__checkbox">
            <input
              type="checkbox"
              checked={headerRow}
              onChange={(e) => setHeaderRow(e.target.checked)}
            />{' '}
            First row is a header
          </label>
          <span className="create-table-dialog__meta">
            {rows.length} rows x {cols} columns
          </span>
        </div>

        {error && <div className="create-table-dialog__error">{error}</div>}
        {commitError && <div className="create-table-dialog__error">{commitError}</div>}
        {parsed.warnings.length > 0 && (
          <div className="create-table-dialog__warnings">{parsed.warnings.join('; ')}</div>
        )}

        {rows.length > 0 && (
          <div className="create-table-dialog__preview">
            <table className="varve-preview-table" aria-label="Preview">
              <thead>
                <tr>
                  {Array.from({ length: cols }, (_, c) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview columns are stateless; header labels can repeat
                    <th key={c}>{headerRow && rows[0]?.[c] ? rows[0][c] : `C${c + 1}`}</th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {previewRows.slice(headerRow ? 1 : 0).map((r, ri) => (
                  // biome-ignore lint/suspicious/noArrayIndexKey: preview rows are stateless; cell content repeats across the table
                  <tr key={ri}>
                    {Array.from({ length: cols }, (_, c) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview cells are stateless; content repeats across the table
                      <td key={c}>{r[c] ?? ''}</td>
                    ))}
                  </tr>
                ))}
              </tbody>
            </table>
            {truncated && (
              <div className="create-table-dialog__more">
                … and {rows.length - previewRows.length} more rows
              </div>
            )}
          </div>
        )}
      </div>
    </Dialog>
  );
}
