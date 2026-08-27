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
import type { Document, SceneNode } from '@varve/scene';
import { type ChangeEvent, useCallback, useEffect, useRef, useState } from 'react';

/** Files that describe a colour transform rather than artwork. */
const LUT_PATTERN = /\.(cube|3dl|clf|ctf)$/i;

interface ImportProgressState {
  current: number;
  total: number;
  fileName: string;
}

/** The slice of the editor context this module needs. Keeps the seam narrow. */
export interface FileImportEditor {
  announce: (message: string) => void;
  addLutAdjustment: (adjustment: Adjustment) => void;
  batchImportNodes: (items: { node: SceneNode; sourceDoc: Document }[]) => void;
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
  report: ImportReport | null;
  cancel: () => void;
  dismissReport: () => void;
}

async function importLutFiles(files: File[], editor: FileImportEditor): Promise<void> {
  const { parseCubeData, parse3dlData, makeAdjustment } = await import('@varve/engine');
  for (const file of files) {
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
  const abortRef = useRef<AbortController | null>(null);
  const [progress, setProgress] = useState<ImportProgressState | null>(null);
  const [report, setReport] = useState<ImportReport | null>(null);

  // An import that outlives its Shell has nowhere to put its nodes.
  useEffect(() => () => abortRef.current?.abort(), []);

  const openPicker = useCallback(() => inputRef.current?.click(), []);
  const cancel = useCallback(() => abortRef.current?.abort(), []);
  const dismissReport = useCallback(() => setReport(null), []);

  const onFilesSelected = useCallback(
    async (event: ChangeEvent<HTMLInputElement>) => {
      const input = event.target;
      const files = Array.from(input.files ?? []);
      if (files.length === 0) return;
      try {
        const lutFiles = files.filter((f) => LUT_PATTERN.test(f.name));
        if (lutFiles.length > 0) await importLutFiles(lutFiles, editor);

        const artwork = files.filter((f) => !LUT_PATTERN.test(f.name));
        if (artwork.length === 0) return;

        const abortController = new AbortController();
        abortRef.current = abortController;
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
            onProgress: (current, total, file) =>
              setProgress({ current, total, fileName: file.name }),
          },
          abortController.signal,
        );

        const parsedItems: { node: SceneNode; sourceDoc: Document }[] = [];
        for (const fileReport of result.files) {
          for (const artifact of fileReport.artifacts) {
            for (const id of artifact.nodeIds) {
              const node = artifact.document.nodes[id];
              if (node) parsedItems.push({ node, sourceDoc: artifact.document });
            }
          }
        }
        // One batch, so the whole import is a single undo step.
        if (parsedItems.length > 0) editor.batchImportNodes(parsedItems);
        if (reportHasIssues(result)) setReport(result);
        const landed = result.successCount + result.partialCount;
        editor.announce(
          `Imported ${landed} file${landed === 1 ? '' : 's'}; ${result.failureCount} failed`,
        );
      } catch (err) {
        if (err instanceof Error && err.name === 'AbortError') return;
        editor.announce(err instanceof Error ? `Import failed: ${err.message}` : 'Import failed');
      } finally {
        abortRef.current = null;
        setProgress(null);
        // Let the same file be re-picked after a failed or cancelled run.
        input.value = '';
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
