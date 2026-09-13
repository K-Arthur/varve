import type { ImportReport } from '@varve/import';
import { THEME_CHANGE_EVENT } from '@varve/ui/tokens';

export { isCapabilityRestricted } from '../capabilities/restrictions';
export { requestInspectorTab } from './inspectorTabBridge';

/** Module-level bridge used by theme and rendering controls to invalidate
 * canvas colour caches without making the editor tree consume a theme object. */
let bumpThemeRevisionHandler: (() => void) | null = null;
let listeningForThemeChanges = false;

function handleThemeChange(): void {
  bumpThemeRevisionHandler?.();
}

export function setBumpThemeRevisionHandler(fn: (() => void) | null): void {
  bumpThemeRevisionHandler = fn;
  if (typeof window === 'undefined') return;
  if (fn && !listeningForThemeChanges) {
    window.addEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    listeningForThemeChanges = true;
  } else if (!fn && listeningForThemeChanges) {
    window.removeEventListener(THEME_CHANGE_EVENT, handleThemeChange);
    listeningForThemeChanges = false;
  }
}

export function bumpThemeRevision(): void {
  bumpThemeRevisionHandler?.();
}

/** Module-level bridge: starts inline text editing for a node.
 *  Registered by CanvasArea on mount. Used by createActionHandlers' editText. */
let startTextEditingHandler: ((nodeId: string) => void) | null = null;

export function setStartTextEditingHandler(fn: ((nodeId: string) => void) | null): void {
  startTextEditingHandler = fn;
}

export function startTextEditing(nodeId: string): void {
  startTextEditingHandler?.(nodeId);
}

/** Report produced by a clipboard/drop import, enriched with the number of
 * roots that actually reached the document. The report bridge keeps the
 * ingestion paths independent from Shell while still presenting one result
 * surface for material losses and failures. */
export type ImportResultReport = ImportReport & {
  insertedCount?: number;
  /** Roots committed by the ingestion route, for an explicit reveal action. */
  committedRootIds?: readonly string[];
  /** Document that received those roots; prevents a stale report targeting a new tab. */
  documentId?: string;
  route?: 'paste' | 'import' | 'drop';
};

let importReportHandler: ((report: ImportResultReport | null) => void) | null = null;

export function setImportReportHandler(
  fn: ((report: ImportResultReport | null) => void) | null,
): void {
  importReportHandler = fn;
}

export function publishImportReport(report: ImportResultReport): void {
  importReportHandler?.(report);
}

/**
 * Canonical predicate for "this import report carries something the user
 * should see." Single source of truth for every ingestion route (picker,
 * drop, paste, icon insert) — previously five copies drifted apart, so a
 * degraded report could surface on one route and be silently dropped on
 * another.
 */
export function importReportHasIssues(report: ImportReport): boolean {
  return (
    report.partialCount > 0 ||
    report.failureCount > 0 ||
    report.warnings.length > 0 ||
    report.files.some(
      (file) =>
        file.status !== 'success' ||
        file.warnings.length > 0 ||
        file.unsupportedFeatures.length > 0,
    )
  );
}
