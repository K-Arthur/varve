/**
 * Deterministic CSV/TSV/Markdown table parsing (ADR-0016 §19).
 *
 * Untrusted input policy:
 * - quoted fields with embedded delimiters and newlines
 * - escaped quotes ("" and \")
 * - bounded input: rows/columns/fields capped before parsing
 * - ragged rows are padded with empty cells (preserving empty cells)
 * - no evaluation, no formula execution, no HTML interpretation
 *
 * The result is a plain matrix of strings; table construction happens in
 * the scene layer (createTableModel) with stable ids.
 */
export const MAX_TABLE_ROWS = 10_000;
export const MAX_TABLE_COLUMNS = 1_000;
export const MAX_TABLE_FIELD_LENGTH = 100_000;
export const MAX_TABLE_INPUT_LENGTH = 50_000_000;

export interface DelimitedParseResult {
  rows: string[][];
  /** Detected delimiter when the input did not specify one. */
  delimiter: ',' | '\t' | ';';
  warnings: string[];
}

export interface DelimitedParseOptions {
  delimiter?: ',' | '\t' | ';';
  maxRows?: number;
  maxColumns?: number;
}

function detectDelimiter(firstLine: string): ',' | '\t' | ';' {
  const candidates: Array<',' | '\t' | ';'> = [',', '\t', ';'];
  let best: ',' | '\t' | ';' = ',';
  let bestScore = -1;
  for (const d of candidates) {
    const outsideQuotes =
      firstLine
        .split(/"[^"]*"/g)
        .join('')
        .split(d).length - 1;
    if (outsideQuotes > bestScore) {
      bestScore = outsideQuotes;
      best = d;
    }
  }
  return bestScore > 0 ? best : ',';
}

/**
 * Parse delimited text. Handles RFC-4180 quoting, quoted newlines, escaped
 * quotes, and CRLF. Returns a rectangular-ish matrix; rows shorter than the
 * widest row are padded with empty strings (empty cells preserved).
 */
export function parseDelimitedText(
  input: string,
  options: DelimitedParseOptions = {},
): DelimitedParseResult {
  const warnings: string[] = [];
  if (typeof input !== 'string' || input.length === 0)
    return { rows: [], delimiter: ',', warnings };
  if (input.length > MAX_TABLE_INPUT_LENGTH) {
    throw new Error('Table input exceeds the 50 MB safety bound');
  }

  const delimiter = options.delimiter ?? detectDelimiter(input.split('\n')[0] ?? '');
  const maxRows = options.maxRows ?? MAX_TABLE_ROWS;
  const maxColumns = options.maxColumns ?? MAX_TABLE_COLUMNS;

  const rows: string[][] = [];
  let row: string[] = [];
  let field = '';
  let inQuotes = false;
  let i = 0;
  const n = input.length;

  const pushField = (): void => {
    if (row.length < maxColumns) {
      if (field.length > MAX_TABLE_FIELD_LENGTH) {
        warnings.push('field truncated to 100,000 characters');
        field = field.slice(0, MAX_TABLE_FIELD_LENGTH);
      }
      row.push(field);
    } else if (field.length > 0) {
      warnings.push('row truncated to the column bound');
    }
    field = '';
  };

  const pushRow = (): void => {
    pushField();
    if (rows.length < maxRows) {
      rows.push(row);
    } else {
      warnings.push('input truncated to the row bound');
    }
    row = [];
  };

  while (i < n) {
    const ch = input[i]!;
    if (inQuotes) {
      if (ch === '"') {
        if (input[i + 1] === '"') {
          field += '"';
          i += 2;
          continue;
        }
        inQuotes = false;
        i++;
        continue;
      }
      field += ch;
      i++;
      continue;
    }
    if (ch === '"' && field.length === 0) {
      inQuotes = true;
      i++;
      continue;
    }
    if (ch === delimiter) {
      pushField();
      i++;
      continue;
    }
    if (ch === '\n') {
      pushRow();
      i++;
      continue;
    }
    if (ch === '\r') {
      if (input[i + 1] === '\n') i++;
      pushRow();
      i++;
      continue;
    }
    field += ch;
    i++;
  }
  // Trailing content without a final newline.
  if (field.length > 0 || row.length > 0) pushRow();

  // Pad ragged rows so downstream consumers can assume a grid.
  const width = rows.reduce((m, r) => Math.max(m, r.length), 0);
  for (const r of rows) {
    while (r.length < width) r.push('');
  }

  return { rows, delimiter, warnings };
}

/**
 * Parse a GitHub-flavored Markdown table into a matrix. The delimiter line
 * (--- | ---) is consumed; alignment hints are ignored (content only).
 */
export function parseMarkdownTable(input: string): { rows: string[][]; warnings: string[] } {
  const warnings: string[] = [];
  const lines = input
    .split('\n')
    .map((l) => l.trim())
    .filter((l) => l.startsWith('|'));
  if (lines.length === 0) return { rows: [], warnings };
  // Skip the separator row (e.g. | --- | --- |).
  const body = lines.filter((l, i) => !(i > 0 && /^\|[\s:|-]+\|$/.test(l)));
  const rows = body.map((line) => {
    const inner = line.replace(/^\|/, '').replace(/\|$/, '').replace(/\\\|/g, '\u241E');
    return inner.split('|').map((cell) => cell.trim().replace(/\u241E/g, '|'));
  });
  return { rows, warnings };
}

/**
 * Safe-export policy: prefix spreadsheet formula triggers with a single
 * quote when `escapeFormulas` is enabled (ADR-0016 §19). Triggers: = + - @
 * and the tab/carriage-return characters.
 */
export function escapeSpreadsheetFormula(value: string): string {
  if (value.length === 0) return value;
  const first = value[0]!;
  if (
    first === '=' ||
    first === '+' ||
    first === '-' ||
    first === '@' ||
    first === '\t' ||
    first === '\r'
  ) {
    return `'${value}`;
  }
  return value;
}

export function toDelimitedText(
  rows: readonly (readonly string[])[],
  delimiter: ',' | '\t' = '\t',
  options: { escapeFormulas?: boolean } = {},
): string {
  const escapeFormulas = options.escapeFormulas ?? true;
  const lines = rows.map((row) =>
    row
      .map((cell) => {
        const safe = escapeFormulas ? escapeSpreadsheetFormula(cell) : cell;
        const needsQuoting = safe.includes(delimiter) || safe.includes('"') || safe.includes('\n');
        if (!needsQuoting) return safe;
        return `"${safe.replace(/"/g, '""')}"`;
      })
      .join(delimiter),
  );
  return lines.join('\n');
}
