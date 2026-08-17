/**
 * CreateTableFromDataDialog — paste TSV/CSV/Markdown, preview, commit as a
 * native table (ADR-0016 §17/§19). One undoable insertion; empty cells and
 * ragged rows are preserved; a first-row header toggle maps to headerRoles.
 */

import { parseDelimitedText, parseMarkdownTable } from '@varve/import';
import { makeTableNode, nextNodeId } from '@varve/scene';
import { FocusTrap, Icon, Select } from '@varve/ui';
import { useEffect, useId, useMemo, useState } from 'react';
import { useEditor } from '../context';

export function CreateTableFromDataDialog() {
  const editor = useEditor();
  const [input, setInput] = useState('');
  const [delimiter, setDelimiter] = useState<'auto' | ',' | '\t' | ';' | 'markdown'>('auto');
  const [headerRow, setHeaderRow] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [commitError, setCommitError] = useState<string | null>(null);
  const titleId = useId();

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

  const commit = (): void => {
    if (rows.length === 0) {
      setCommitError('Nothing to create — paste some data first.');
      return;
    }
    setCommitError(null);
    const { id, doc: d2 } = nextNodeId(editor.state.document);
    const table = makeTableNode(id, {
      name: 'Table',
      rows: rows.length,
      columns: cols,
      headerRows: headerRow ? 1 : 0,
      w: Math.max(320, cols * 96),
      h: Math.max(120, rows.length * 32),
      columnSizing: { kind: 'fraction', value: 1 },
    });
    // Fill cell content row-major.
    let next = table;
    rows.forEach((row, r) => {
      row.forEach((text, c) => {
        const cellId = next.table.cellIndex[`${r},${c}`];
        if (!cellId) return;
        next = {
          ...next,
          table: {
            ...next.table,
            cells: {
              ...next.table.cells,
              [cellId]: { ...next.table.cells[cellId]!, content: { kind: 'text', text } },
            },
          },
        };
      });
    });

    editor.updateDoc((doc) => {
      const rootChildren = [...doc.rootChildren, id];
      return { ...doc, rootChildren, nodes: { ...doc.nodes, [id]: next }, nextId: d2.nextId };
    });
    editor.setSelection(id);
    editor.announce(`Created table with ${rows.length} rows and ${cols} columns`);
    setInput('');
    editor.patch({ createTableFromDataOpen: false });
  };

  useEffect(() => {
    const onKey = (e: KeyboardEvent): void => {
      if (e.key === 'Escape') editor.patch({ createTableFromDataOpen: false });
    };
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [editor]);

  return (
    <div
      role="dialog"
      aria-modal="true"
      aria-labelledby={titleId}
      style={{
        position: 'fixed',
        inset: 0,
        background: 'rgba(0,0,0,0.35)',
        display: 'flex',
        alignItems: 'center',
        justifyContent: 'center',
        zIndex: 2000,
      }}
      onPointerDown={(e) => {
        if (e.target === e.currentTarget) editor.patch({ createTableFromDataOpen: false });
      }}
    >
      {/* Focus containment + restoration; Escape is handled by the window
          listener above, which FocusTrap's onClose mirrors for parity. */}
      <FocusTrap active onClose={() => editor.patch({ createTableFromDataOpen: false })}>
        <div
          className="varve-dialog"
          style={{
            background: 'var(--color-surface-raised, #fff)',
            borderRadius: 10,
            padding: 16,
            width: 560,
            maxWidth: '92vw',
            maxHeight: '84vh',
            display: 'flex',
            flexDirection: 'column',
            gap: 12,
            boxShadow: '0 16px 48px rgba(0,0,0,0.25)',
          }}
        >
          <div className="insp-field-row__split" style={{ justifyContent: 'space-between' }}>
            <h2 id={titleId} style={{ margin: 0, fontSize: 16 }}>
              Create table from data
            </h2>
            <button
              type="button"
              className="insp-inline-btn"
              aria-label="Close"
              onClick={() => editor.patch({ createTableFromDataOpen: false })}
            >
              <Icon name="X" label={undefined} size="1em" />
            </button>
          </div>

          <textarea
            aria-label="Paste CSV, TSV, or Markdown table"
            value={input}
            onChange={(e) => setInput(e.target.value)}
            placeholder={'Paste spreadsheet data (tab or comma separated) or a Markdown table…'}
            rows={6}
            style={{ fontFamily: 'monospace', fontSize: 12, resize: 'vertical' }}
          />

          <div className="insp-field-row__split" style={{ gap: 12, flexWrap: 'wrap' }}>
            <span style={{ fontSize: 12 }}>
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
            <label style={{ fontSize: 12 }}>
              <input
                type="checkbox"
                checked={headerRow}
                onChange={(e) => setHeaderRow(e.target.checked)}
              />{' '}
              First row is a header
            </label>
            <span style={{ fontSize: 12, opacity: 0.7 }}>
              {rows.length} rows x {cols} columns
            </span>
          </div>

          {error && (
            <div style={{ color: 'var(--color-feedback-danger, #d64545)', fontSize: 12 }}>
              {error}
            </div>
          )}
          {commitError && (
            <div style={{ color: 'var(--color-feedback-danger, #d64545)', fontSize: 12 }}>
              {commitError}
            </div>
          )}
          {parsed.warnings.length > 0 && (
            <div style={{ fontSize: 11, opacity: 0.7 }}>{parsed.warnings.join('; ')}</div>
          )}

          {rows.length > 0 && (
            <div
              style={{
                overflow: 'auto',
                border: '1px solid var(--color-border-subtle, #cdd3de)',
                borderRadius: 6,
              }}
            >
              <table className="varve-preview-table" aria-label="Preview">
                <thead>
                  <tr>
                    {Array.from({ length: cols }, (_, c) => (
                      // biome-ignore lint/suspicious/noArrayIndexKey: preview columns are stateless; header labels can repeat
                      <th key={c} style={{ fontSize: 11, padding: '2px 6px', textAlign: 'left' }}>
                        {headerRow && rows[0]?.[c] ? rows[0][c] : `C${c + 1}`}
                      </th>
                    ))}
                  </tr>
                </thead>
                <tbody>
                  {previewRows.slice(headerRow ? 1 : 0).map((r, ri) => (
                    // biome-ignore lint/suspicious/noArrayIndexKey: preview rows are stateless; cell content repeats across the table
                    <tr key={ri}>
                      {Array.from({ length: cols }, (_, c) => (
                        // biome-ignore lint/suspicious/noArrayIndexKey: preview cells are stateless; content repeats across the table
                        <td key={c} style={{ fontSize: 11, padding: '2px 6px' }}>
                          {r[c] ?? ''}
                        </td>
                      ))}
                    </tr>
                  ))}
                </tbody>
              </table>
              {truncated && (
                <div style={{ fontSize: 11, padding: 4, opacity: 0.7 }}>
                  … and {rows.length - previewRows.length} more rows
                </div>
              )}
            </div>
          )}

          <div style={{ display: 'flex', gap: 8, justifyContent: 'flex-end' }}>
            <button
              type="button"
              className="insp-inline-btn"
              onClick={() => editor.patch({ createTableFromDataOpen: false })}
            >
              Cancel
            </button>
            <button
              type="button"
              className="insp-add-btn"
              onClick={commit}
              disabled={rows.length === 0}
            >
              Create table
            </button>
          </div>
        </div>
      </FocusTrap>
    </div>
  );
}
