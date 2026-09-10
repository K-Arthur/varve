/**
 * DTCG 2025.10 serialization (ADR-0103).
 *
 * Two modes:
 * - canonical: stable key order, 2-space indent (new files, explicit
 *   formatting, adapter-required output)
 * - source-preserving patch: splices only changed/inserted subtrees into
 *   the original text; unchanged bytes, key order, indentation, newlines,
 *   BOM, and final newline survive untouched.
 *
 * Standard JSON has no comments; JSONC/JSON5 compatibility is a separate
 * source-syntax adapter (not implemented) that must convert to valid DTCG
 * JSON without semantic change.
 */
import type { JsonSourceResult } from './json';

/** Canonical key order for tokens and groups (documented; no mandated
 * order exists in the format report). */
const TOKEN_KEY_ORDER = ['$value', '$type', '$description', '$deprecated', '$extensions'];
/** Group properties follow the same canonical order as tokens. */
const GROUP_KEY_ORDER: readonly string[] = [
  '$description',
  '$type',
  '$extends',
  '$deprecated',
  '$extensions',
];

export interface SourceChange {
  /** Pointer to the value to replace (token $value, $type, $extensions…). */
  pointer: string;
  value: unknown;
}

export interface SourceInsert {
  /** Pointer to the object to insert into (e.g. a token's $extensions). */
  pointer: string;
  key: string;
  value: unknown;
}

// ── Canonical serialization ─────────────────────────────────────────────────

export function renderValueInline(value: unknown): string {
  return JSON.stringify(value);
}

/** Tokens are objects carrying $value (or $ref); groups are the rest. */
function isTokenObject(record: Record<string, unknown>): boolean {
  return Object.hasOwn(record, '$value') || Object.hasOwn(record, '$ref');
}

function renderObject(record: Record<string, unknown>, indent: string, depth: number): string {
  const keyOrder = isTokenObject(record) ? TOKEN_KEY_ORDER : GROUP_KEY_ORDER;
  const unit = indent;
  const pad = unit.repeat(depth + 1);
  const closePad = unit.repeat(depth);
  const keys: string[] = [];
  const ordered = new Set(keyOrder);
  for (const key of keyOrder) {
    if (key in record && record[key] !== undefined) keys.push(key);
  }
  for (const key of Object.keys(record)) {
    if (!ordered.has(key)) keys.push(key);
  }
  if (keys.length === 0) return '{}';
  const body = keys
    .map(
      (key) => `${pad}${JSON.stringify(key)}: ${renderCanonical(record[key], indent, depth + 1)}`,
    )
    .join(',\n');
  return `{\n${body}\n${closePad}}`;
}

export function renderCanonical(value: unknown, indent = '  ', depth = 0): string {
  if (value === null) return 'null';
  if (Array.isArray(value)) {
    if (value.length === 0) return '[]';
    const pad = indent.repeat(depth + 1);
    const closePad = indent.repeat(depth);
    const body = value
      .map((item) => `${pad}${renderCanonical(item, indent, depth + 1)}`)
      .join(',\n');
    return `[\n${body}\n${closePad}]`;
  }
  if (typeof value === 'object') {
    return renderObject(value as Record<string, unknown>, indent, depth);
  }
  return JSON.stringify(value);
}

// ── Source-preserving patch serialization ───────────────────────────────────

export interface PatchOptions {
  maxChangedSubtreeBytes?: number;
}

/**
 * Apply semantic changes to the original source text, preserving everything
 * that is not part of a changed subtree.
 *
 * Changed values are rendered inline so alignment with the original
 * indentation is always correct. Insertions append a new key before the
 * target object's closing brace, matching the detected newline style and
 * indentation unit.
 */
export function patchSerialize(
  text: string,
  source: JsonSourceResult,
  changes: readonly SourceChange[],
  insertions: readonly SourceInsert[] = [],
  options: PatchOptions = {},
): string {
  if (changes.length === 0 && insertions.length === 0) return text;
  const newline = text.includes('\r\n') ? '\r\n' : '\n';

  type Edit = { start: number; end: number; replacement: string };
  const edits: Edit[] = [];

  for (const change of changes) {
    const loc = source.keyLocations.get(change.pointer);
    if (!loc || loc.valueEnd < 0) continue;
    const maxBytes = options.maxChangedSubtreeBytes ?? 4096;
    const rendered = renderValueInline(change.value);
    if (rendered.length > maxBytes) {
      throw new Error(
        `patch.oversized-change: rendered subtree at ${change.pointer} exceeds ${maxBytes} bytes`,
      );
    }
    edits.push({ start: loc.valueStart, end: loc.valueEnd, replacement: rendered });
  }

  for (const insert of insertions) {
    const span = source.objectSpans.get(insert.pointer);
    if (!span || span.close < 0) continue;
    if (text[span.open] === '[') continue; // insertions target objects
    const inner = text.slice(span.open + 1, span.close);
    const trailing = inner.length - inner.trimEnd().length;
    const empty = inner.trim().length === 0;
    const renderedKey = JSON.stringify(insert.key);
    const renderedValue = renderValueInline(insert.value);
    const childIndent = detectChildIndent(text, source, insert.pointer);
    const parentIndent = detectParentIndent(text, span.open);
    const line = `${renderedKey}: ${renderedValue}`;
    const prefix = empty ? '' : ',';
    const replacement = `${prefix}${newline}${childIndent}${line}${newline}${parentIndent}`;
    edits.push({ start: span.close - trailing, end: span.close, replacement });
  }

  if (edits.length === 0) return text;
  edits.sort((a, b) => b.start - a.start);
  let out = text;
  for (const edit of edits) {
    out = out.slice(0, edit.start) + edit.replacement + out.slice(edit.end);
  }
  return out;
}

function detectIndentUnit(text: string, source: JsonSourceResult): string {
  const rootLoc = source.keyLocations.get('');
  if (!rootLoc) return '  ';
  const firstKeyLoc = [...source.keyLocations.entries()].find(
    ([pointer]) => pointer.split('/').length === 2,
  );
  if (!firstKeyLoc) return '  ';
  const loc = firstKeyLoc[1];
  const lineStart = text.lastIndexOf('\n', loc.keyStart - 1) + 1;
  const prefix = text.slice(lineStart, loc.keyStart);
  const match = /^[ \t]*/.exec(prefix);
  return match?.[0] ?? '  ';
}

function detectChildIndent(text: string, source: JsonSourceResult, pointer: string): string {
  const span = source.objectSpans.get(pointer);
  if (!span) return '  ';
  const child = [...source.keyLocations.entries()].find(
    ([p, loc]) => p.startsWith(`${pointer}/`) && loc.objectOpen === span.open,
  );
  if (!child) return detectParentIndent(text, span.open) + detectIndentUnit(text, source);
  const loc = child[1];
  const lineStart = text.lastIndexOf('\n', loc.keyStart - 1) + 1;
  const prefix = text.slice(lineStart, loc.keyStart);
  const match = /^[ \t]*/.exec(prefix);
  return match?.[0] ?? `${detectParentIndent(text, span.open)}  `;
}

function detectParentIndent(text: string, openOffset: number): string {
  const lineStart = text.lastIndexOf('\n', openOffset - 1) + 1;
  const prefix = text.slice(lineStart, openOffset);
  const match = /^[ \t]*/.exec(prefix);
  return match?.[0] ?? '';
}
