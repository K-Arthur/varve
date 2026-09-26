/**
 * Selected-source preview and source-content editing (ADR-0107/0108 UI).
 *
 * Pure, framework-free helpers so the panel only renders and wires events:
 *
 * - `sourceTokenRows` previews exactly the tokens one source owns, so
 *   switching the source in the panel shows that source and nothing else.
 * - `validateSourceDraft` re-runs the import pipeline over edited content
 *   and reports the first blocking diagnostic instead of applying anything,
 *   so editing a source with non-DTCG data produces an error notice and
 *   leaves the document untouched.
 * - `sourceContent` seeds the editor from a scoped export of that source's
 *   own tokens (never the whole document).
 */
import type { DesignTokenRecord, TokenSynchronization } from '@varve/scene/tokens';
import { tokensBySource } from '@varve/scene/tokens';
import { exportTokensToDtcg } from './exportWorkflow';
import { buildImportPreview, type ImportPreviewState } from './importWorkflow';

export interface SourceTokenRow {
  /** Canonical dotted path shown to the user. */
  path: string;
  type: string;
  /** Rendered value — never JSON.parse'd blindly, never assumed scalar. */
  value: string;
  description?: string;
  deprecated?: boolean | string;
}

export interface SourceDraftResult {
  ok: boolean;
  /** First blocking diagnostic, ready to render as an error notice. */
  message?: string;
  preview?: ImportPreviewState;
}

/** Tokens owned by one source, in path order. */
export function sourceTokenRows(
  sync: TokenSynchronization | undefined,
  sourceId: string,
): SourceTokenRow[] {
  if (!sync) return [];
  return tokensBySource(sync.store, sourceId as `src_${string}`)
    .slice()
    .sort((a, b) => a.path.join('.').localeCompare(b.path.join('.')))
    .map((record) => ({
      path: record.path.join('.'),
      type: record.type,
      value: formatTokenValue(record.value),
      ...(record.description !== undefined ? { description: record.description } : {}),
      ...(record.deprecated !== undefined ? { deprecated: record.deprecated } : {}),
    }));
}

/** Seed text for the source editor: that source's tokens as DTCG JSON. */
export function sourceContent(sync: TokenSynchronization | undefined, sourceId: string): string {
  return exportTokensToDtcg(sync, { sourceId }).text;
}

/**
 * Validate edited source content without touching the document. The preview
 * is only handed back when it is importable, so a caller can never apply a
 * document that failed validation.
 */
export function validateSourceDraft(
  text: string,
  fileName: string,
  sync: TokenSynchronization | undefined,
): SourceDraftResult {
  const preview = buildImportPreview(
    text,
    { name: fileName, size: text.length, lastModified: 0 },
    sync,
  );
  const blocking = preview.diagnostics.find((d) => d.severity === 'error');
  if (blocking || !preview.document) {
    return {
      ok: false,
      message:
        blocking?.message ??
        `${fileName} did not produce an importable token document. Nothing was changed.`,
      preview,
    };
  }
  return { ok: true, preview };
}

/** Render a token value for previews and conflict review. */
export function formatTokenValue(value: unknown): string {
  if (value === undefined) return '(none)';
  if (value === null) return 'null';
  if (typeof value === 'string') return value;
  if (typeof value === 'number' || typeof value === 'boolean') return String(value);
  try {
    return JSON.stringify(value);
  } catch {
    return '[unrenderable value]';
  }
}

/** Ownership check used to disable source-only actions honestly. */
export function sourceOwnsTokens(
  sync: TokenSynchronization | undefined,
  sourceId: string,
): boolean {
  if (!sync) return false;
  const owned: DesignTokenRecord[] = tokensBySource(sync.store, sourceId as `src_${string}`);
  return owned.length > 0;
}
