/**
 * File > Import — the picker half of the ingestion pipeline.
 *
 * Varve has two hidden file inputs and they mean different things. The
 * document input (`#file-open-input`) belongs to File > Open and loads a
 * `.varve` / `.strata` / `.json` document into its own tab. This module owns
 * the other one (`#file-import-input`): it inserts external artwork into the
 * document that is already open. The two were once wired to the same ref, so
 * Import silently offered only Varve documents and no image or SVG could be
 * chosen at all; keeping the import side in its own module is what stops that
 * pairing from being re-created by accident.
 *
 * Everything here funnels into `ImportService`, which is also what canvas
 * drag-drop (`CanvasArea`) and clipboard paste (`context.tsx`) use, so all
 * three ingestion routes share one parser stack and one compatibility report.
 * LUT files are the single exception: they carry no scene content, so they
 * are peeled off first and routed to the adjustment handler.
 */

import type { Adjustment } from '@varve/engine';
import { getImportAcceptString, type ImportReport, ImportService } from '@varve/import';
import type { Document, NodeId, SceneNode } from '@varve/scene';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';
import type { ImportResultReport } from '../context/sessionGlobals';
import { type PreparedFragment, preparedFragmentFromRootSets } from '../dropUtils';

/** Files that describe a colour transform rather than artwork. */
const LUT_PATTERN = /\.(cube|3dl|clf|ctf)$/i;

interface ImportProgressState {
  current: number;
  total: number;
  fileName: string;
}

/** The slice of the editor context this module needs. Keeps the seam narrow. */
export interface FileImportEditor {
  /** Snapshot used to reject a picker result that outlived its destination. */
  state: {
    document: { id: string };
    activeId: string;
    revision: number;
    selectionRevision: number;
  };
  announce: (message: string) => void;
  addLutAdjustment: (adjustment: Adjustment) => void;
  batchImportNodes: (items: { node: SceneNode; sourceDoc: Document }[]) => void;
  commitPreparedFragment: (fragment: PreparedFragment) => string[];
}

export interface FileImportController {
  /** Ref for the hidden import input. Never share this with File > Open. */
  inputRef: React.RefObject<HTMLInputElement | null>;
  /** `accept` filter, derived from the parser registry. */
  accept: string;
  /** Opens the picker — the handler behind the Import action. */
  openPicker: () => void;
  onFilesSelected: (event: ChangeEvent<HTMLInputElement>) => Promise<void>;
  progress: ImportProgressState | null;
  report: ImportResultReport | null;
  cancel: () => void;
  dismissReport: () => void;
}

async function importLutFiles(
  files: File[],
  editor: FileImportEditor,
  isCurrent: () => boolean,
): Promise<void> {
  const { parseCubeData, parse3dlData, makeAdjustment } = await import('@varve/engine');
  for (const file of files) {
    if (!isCurrent()) return;
    const text = await file.text();
    const ext = file.name.split('.').pop()?.toLowerCase() ?? '';
    try {
      const result: { transform: unknown } =
        ext === 'cube' ? parseCubeData(text) : parse3dlData(text);
      const lutAdj = makeAdjustment(
        `lut-${Date.now()}-${Math.random().toString(36).slice(2, 8)}`,
        'lut',
        {
          lutJson: JSON.stringify(result.transform),
          originalFilename: file.name,
          inputSpace: 'sRGB' as const,
          interpolation: 'tetrahedral' as const,
          intensity: 1,
          linearize: false,
          visible: true,
          opacity: 1,
        },
      );
      if (!isCurrent()) return;
      editor.addLutAdjustment(lutAdj);
      editor.announce(`Imported LUT: ${file.name}`);
    } catch (err) {
      editor.announce(`LUT import failed: ${err instanceof Error ? err.message : String(err)}`);
    }
  }
}

/** True when the report carries anything the user should see. */
function reportHasIssues(report: ImportReport): boolean {
  return (
    report.partialCount > 0 ||
    report.failureCount > 0 ||
    report.warnings.length > 0 ||
    report.files.some((file) => file.unsupportedFeatures.length > 0)
  );
}

export function useFileImport(editor: FileImportEditor): FileImportController {
  const inputRef = useRef<HTMLInputElement>(null);
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const abortRef = useRef<AbortController | null>(null);
  const operationSequenceRef = useRef(0);
  const activeOperationRef = useRef<number | null>(null);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const [report, setReport] = useState<ImportResultReport | null>(null);

  // An import that outlives its Shell has nowhere to put its nodes.
  useEffect(
    () => () => {
      activeOperationRef.current = null;
      abortRef.current?.abort();
      abortRef.current = null;
    },
    [],
  );

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const dismissReport = useCallback(() => setReport(null), []);

  const onFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      // A second picker gesture supersedes the first one. Aborting the old
      // controller is not enough by itself: its promise may settle later and
      // otherwise clear the new run's progress, report, or input value.
      abortRef.current?.abort();
      const operationId = ++operationSequenceRef.current;
      const abortController = new AbortController();
      abortRef.current = abortController;
      activeOperationRef.current = operationId;
      const isOwnedOperation = (): boolean => activeOperationRef.current === operationId;
      const isActiveOperation = (): boolean =>
        isOwnedOperation() && !abortController.signal.aborted;
      const expected = {
        documentId: editor.state.document.id,
        activeId: editor.state.activeId,
        revision: editor.state.revision,
        selectionRevision: editor.state.selectionRevision,
      };
      const isCurrent = (): boolean => {
        const current = editorRef.current.state;
        return (
          current.document.id === expected.documentId &&
          current.activeId === expected.activeId &&
          current.revision === expected.revision &&
          current.selectionRevision === expected.selectionRevision
        );
      };
      const isCurrentOperation = (): boolean => isActiveOperation() && isCurrent();
      try {
        const lutFiles = files.filter((f) => LUT_PATTERN.test(f.name));
        if (lutFiles.length > 0)
          await importLutFiles(lutFiles, editorRef.current, isCurrentOperation);
        if (!isCurrentOperation()) return;

        const artwork = files.filter((f) => !LUT_PATTERN.test(f.name));
        if (artwork.length === 0) return;

        if (!isActiveOperation()) return;
        setReport(null);
        setProgress({ current: 0, total: artwork.length, fileName: artwork[0]!.name });

        const result = await ImportService.importFiles(
          await Promise.all(
            artwork.map(async (file) => ({
              name: file.name,
              source: 'file-picker' as const,
              size: file.size,
              bytes: new Uint8Array(await file.arrayBuffer()),
            })),
          ),
          {
            center: true,
            embedImages: true,
            onProgress: (current, total, file) => {
              if (isActiveOperation()) setProgress({ current, total, fileName: file.name });
            },
          },
          abortController.signal,
        );
        if (!isCurrentOperation()) return;

        const parsedItems: { rootIds: NodeId[]; sourceDoc: Document }[] = [];
        for (const fileReport of result.files) {
          for (const artifact of fileReport.artifacts) {
            const rootIds = artifact.nodeIds.filter((id) => artifact.document.nodes[id]);
            if (rootIds.length > 0) parsedItems.push({ rootIds, sourceDoc: artifact.document });
          }
        }
        if (!isCurrentOperation()) {
          editor.announce('Import cancelled because the document changed while it was loading');
          return;
        }
        // One batch, so the whole import is a single undo step.
        if (parsedItems.length > 0) {
          const committedIds = editor.commitPreparedFragment(
            preparedFragmentFromRootSets('import', parsedItems, { targetParentId: null }),
          );
          if (reportHasIssues(result) && isActiveOperation()) {
            setReport({
              ...result,
              insertedCount: committedIds.length,
              committedRootIds: committedIds,
              documentId: expected.documentId,
              route: 'import',
            });
          }
        } else if (reportHasIssues(result) && isActiveOperation()) {
          setReport({
            ...result,
            insertedCount: 0,
            committedRootIds: [],
            documentId: expected.documentId,
            route: 'import',
          });
        }
        const landed = result.successCount + result.partialCount;
        editor.announce(
          `Imported ${landed} file${landed === 1 ? '' : 's'}; ${result.failureCount} failed`,
        );
      } catch (err) {
        if (!isActiveOperation()) return;
        if (err instanceof Error && err.name === 'AbortError') return;
        editor.announce(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed');
      } finally {
        if (isOwnedOperation()) {
          activeOperationRef.current = null;
          abortRef.current = null;
          setProgress(null);
          // Let the same file be re-picked after a failed or cancelled run.
          input.value = '';
        }
      }
    },
    [editor],
  );

  return {
    inputRef,
    accept: getImportAcceptString(),
    openPicker,
    onFilesSelected,
    progress,
    report,
    cancel,
    dismissReport,
  };
}
