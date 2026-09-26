/**
 * Export of the document token store as a DTCG 2025.10 document.
 *
 * Deterministic: records are emitted in path order, group metadata is
 * replayed from the store, and no timestamp or id is written, so an
 * unchanged store always produces byte-identical output.
 *
 * Fidelity rules:
 * - token values are written exactly as stored (references stay references;
 *   hex-string colors are not silently converted to the structured form)
 * - unknown `$extensions` and `$deprecated` are replayed verbatim
 * - group `$description`/`$deprecated`/`$extensions` are replayed from the
 *   store's group metadata; group `$type` is omitted because every exported
 *   token already carries its resolved type and `$extends` is expanded at
 *   parse time — both are reported as an export note, never silently lost
 * - anything the store cannot represent is reported as a diagnostic instead
 *   of being dropped without a trace
 */
import type {
  DesignTokenRecord,
  DesignTokenStore,
  TokenSynchronization,
} from '@varve/scene/tokens';
import { renderCanonical } from '@varve/tokens';

export interface ExportDiagnostic {
  severity: 'info' | 'warning' | 'error';
  code: string;
  message: string;
}

export interface TokenExportResult {
  text: string;
  tokenCount: number;
  /** Records the store refused to emit (bad names, conflicts, no value). */
  skipped: number;
  groupCount: number;
  diagnostics: ExportDiagnostic[];
}

const NAME_FORBIDDEN = /[{}.]/;
const PURE_CURLY_REFERENCE = /^\{[^{}]+\}$/;

function isPlainObject(value: unknown): value is Record<string, unknown> {
  return value !== null && typeof value === 'object' && !Array.isArray(value);
}

function isPureReference(value: unknown): boolean {
  if (typeof value === 'string') return PURE_CURLY_REFERENCE.test(value.trim());
  return isPlainObject(value) && Object.keys(value).length === 1 && typeof value.$ref === 'string';
}

function invalidSegment(segment: string, index: number, length: number): boolean {
  if (NAME_FORBIDDEN.test(segment)) return true;
  if (segment.startsWith('$')) return !(index === length - 1 && segment === '$root');
  return false;
}

function referenceEntry(value: Record<string, unknown>): Record<string, unknown> | undefined {
  const keys = Object.keys(value);
  if (keys.length === 1 && keys[0] === '$ref' && typeof value.$ref === 'string') return value;
  return undefined;
}

function metadataFields(record: DesignTokenRecord, entry: Record<string, unknown>): void {
  if (typeof record.description === 'string' && record.description.length > 0) {
    entry.$description = record.description;
  }
  if (record.deprecated !== undefined) entry.$deprecated = record.deprecated;
  if (record.extensions && Object.keys(record.extensions).length > 0) {
    entry.$extensions = record.extensions;
  }
}

function tokenEntry(record: DesignTokenRecord): Record<string, unknown> | undefined {
  if (record.value === undefined) return undefined;

  // Token-level JSON Pointer reference: replay the exact authored form
  // (format report §6.6.2) rather than inventing a $value.
  if (isPlainObject(record.value)) {
    const ref = referenceEntry(record.value);
    if (ref) {
      const entry: Record<string, unknown> = { $ref: ref.$ref };
      metadataFields(record, entry);
      return entry;
    }
  }

  const entry: Record<string, unknown> = { $value: record.value };
  // A pure reference derives its type from its target (format report §5.2.2);
  // writing a stored fallback type could contradict the target.
  if (!isPureReference(record.value) && record.type) entry.$type = record.type;
  metadataFields(record, entry);
  return entry;
}

function isTokenNode(value: unknown): boolean {
  return isPlainObject(value) && ('$value' in value || '$ref' in value);
}

/**
 * Serialize the store's tokens (and group metadata) to canonical DTCG JSON.
 * Never mutates the store; never writes files.
 *
 * `options.sourceId` scopes the export to one source's tokens — used by the
 * source content editor so a source is edited as exactly what it owns, not
 * as an export of the whole document.
 */
export function exportTokensToDtcg(
  sync: TokenSynchronization | undefined,
  options?: { sourceId?: string },
): TokenExportResult {
  const diagnostics: ExportDiagnostic[] = [];
  const allRecords = Object.values(sync?.store.tokens ?? {});
  const scope = options?.sourceId;
  const records = allRecords
    .filter((record) => (scope ? record.source?.sourceId === scope : true))
    .slice()
    .sort((a, b) => a.path.join('.').localeCompare(b.path.join('.')));

  if (records.length === 0) {
    return {
      text: '',
      tokenCount: 0,
      skipped: 0,
      groupCount: 0,
      diagnostics: [
        {
          severity: 'warning',
          code: 'export.empty',
          message: scope
            ? 'This source owns no design tokens to export.'
            : 'This document has no design tokens to export.',
        },
      ],
    };
  }

  const root: Record<string, unknown> = {};
  let tokenCount = 0;
  let skipped = 0;
  let hexColors = 0;
  let nonStandardTypes = 0;
  const standardTypes = new Set([
    'color',
    'dimension',
    'number',
    'duration',
    'cubicBezier',
    'fontFamily',
    'fontWeight',
    'strokeStyle',
    'border',
    'transition',
    'shadow',
    'gradient',
    'typography',
  ]);

  for (const record of records) {
    const segments = record.path;
    if (segments.length === 0) {
      skipped += 1;
      diagnostics.push({
        severity: 'error',
        code: 'export.empty-path',
        message: `Token ${record.id} has an empty path and was not exported.`,
      });
      continue;
    }
    const bad = segments.findIndex((s, i) => invalidSegment(s, i, segments.length));
    if (bad >= 0) {
      skipped += 1;
      diagnostics.push({
        severity: 'error',
        code: 'export.invalid-name',
        message: `Token path "${segments.join('.')}" contains an invalid segment "${segments[bad]}" and was not exported.`,
      });
      continue;
    }

    let node = root;
    let aborted = false;
    for (let i = 0; i < segments.length - 1; i += 1) {
      const segment = segments[i] as string;
      const existing = node[segment];
      if (existing === undefined) {
        const created: Record<string, unknown> = {};
        node[segment] = created;
        node = created;
        continue;
      }
      if (!isPlainObject(existing) || isTokenNode(existing)) {
        skipped += 1;
        aborted = true;
        diagnostics.push({
          severity: 'error',
          code: 'export.path-conflict',
          message: `Token path "${segments.join('.')}" collides with an existing token and was not exported.`,
        });
        break;
      }
      node = existing;
    }
    if (aborted) continue;

    const leaf = segments[segments.length - 1] as string;
    if (leaf in node) {
      skipped += 1;
      diagnostics.push({
        severity: 'warning',
        code: 'export.duplicate-path',
        message: `Duplicate token path "${segments.join('.')}" — the first record was kept.`,
      });
      continue;
    }
    const entry = tokenEntry(record);
    if (!entry) {
      skipped += 1;
      diagnostics.push({
        severity: 'error',
        code: 'export.missing-value',
        message: `Token "${segments.join('.')}" has no value and was not exported.`,
      });
      continue;
    }
    node[leaf] = entry;
    tokenCount += 1;
    if (
      record.type === 'color' &&
      typeof record.value === 'string' &&
      record.value.startsWith('#')
    ) {
      hexColors += 1;
    }
    if (record.type && !standardTypes.has(record.type)) nonStandardTypes += 1;
  }

  const groupCount = applyGroupMetadata(
    root,
    scope ? scopedGroupMeta(sync?.store.groupMeta, records) : sync?.store.groupMeta,
    diagnostics,
  );

  if (hexColors > 0) {
    diagnostics.push({
      severity: 'info',
      code: 'export.hex-string-colors',
      message: `${hexColors} color token(s) use hex-string values rather than the 2025.10 structured form; preserved exactly as authored.`,
    });
  }
  if (nonStandardTypes > 0) {
    diagnostics.push({
      severity: 'warning',
      code: 'export.nonstandard-types',
      message: `${nonStandardTypes} token(s) carry types outside the 2025.10 set; preserved, but a strict DTCG validator will reject them.`,
    });
  }
  diagnostics.push({
    severity: 'info',
    code: 'export.group-type-omitted',
    message:
      'Group $type and $extends are not re-emitted: each token carries its resolved type and $extends is expanded at parse time.',
  });

  return {
    text: `${renderCanonical(root)}\n`,
    tokenCount,
    skipped,
    groupCount,
    diagnostics,
  };
}

/**
 * Group metadata is keyed by path; when an export is scoped to one source,
 * only groups that are ancestors of that source's tokens belong in it.
 */
function scopedGroupMeta(
  groupMeta: DesignTokenStore['groupMeta'],
  records: readonly DesignTokenRecord[],
): DesignTokenStore['groupMeta'] {
  if (!groupMeta) return undefined;
  const out: Record<string, NonNullable<DesignTokenStore['groupMeta']>[string]> = {};
  for (const [path, meta] of Object.entries(groupMeta)) {
    const segments = path.split('.');
    const keep = records.some(
      (record) =>
        record.path.length > segments.length &&
        segments.every((segment, index) => record.path[index] === segment),
    );
    if (keep) out[path] = meta;
  }
  return out;
}

function applyGroupMetadata(
  root: Record<string, unknown>,
  groupMeta:
    | Record<
        string,
        { description?: string; deprecated?: boolean | string; extensions: Record<string, unknown> }
      >
    | undefined,
  diagnostics: ExportDiagnostic[],
): number {
  if (!groupMeta) return 0;
  let applied = 0;
  for (const [path, meta] of Object.entries(groupMeta)) {
    const segments = path.split('.');
    if (segments.length === 0) continue;
    let node = root;
    let aborted = false;
    for (const segment of segments) {
      const existing = node[segment];
      if (existing === undefined) {
        const created: Record<string, unknown> = {};
        node[segment] = created;
        node = created;
        continue;
      }
      if (!isPlainObject(existing) || isTokenNode(existing)) {
        aborted = true;
        break;
      }
      node = existing;
    }
    if (aborted) {
      diagnostics.push({
        severity: 'warning',
        code: 'export.group-meta-conflict',
        message: `Group metadata for "${path}" could not be replayed because a token occupies that path.`,
      });
      continue;
    }
    if (typeof meta.description === 'string') node.$description = meta.description;
    if (meta.deprecated !== undefined) node.$deprecated = meta.deprecated;
    if (meta.extensions && Object.keys(meta.extensions).length > 0) {
      node.$extensions = meta.extensions;
    }
    applied += 1;
  }
  return applied;
}
