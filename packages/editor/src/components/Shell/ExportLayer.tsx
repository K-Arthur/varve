import { createEngine, type Engine, getFontRegistry } from '@varve/engine';
import { FontCatalog } from '@varve/engine/font';
import type { Platform } from '@varve/platform';
import type { ExportBatch, ExportFormat, SceneNode, ShapeNode } from '@varve/scene';
import { isImageShape } from '@varve/scene';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { durationBucket, getDesktopAnalytics } from '../../analytics/desktopAnalytics';
import { isCapabilityRestricted } from '../../capabilities/restrictions';
import { useEditor } from '../../context';
import {
  createBufferedExportArchive,
  createExportFolderSaveFile,
  createExportSaveFile,
  saveExportBytes,
} from '../../exportSaveAdapter';
import { type ExportProgressEvent, ExportService } from '../../exportService';
import { buildPackageExport } from '../../packageExport';
import { BatchBgRemoveDialog } from '../BatchBgRemoveDialog';
import { ExportDialog } from '../Export/ExportDialog';

function isRasterExport(format: ExportFormat): boolean {
  return format === 'png' || format === 'jpg' || format === 'webp';
}

/**
 * Nodes the batch dialog can export: every document node that carries at least
 * one export preset, plus image shapes (the background-removal pre-pass needs
 * them). This is sourced from the full document node table rather than
 * `rootNodes()`, because page-scoped content lives under the active page's
 * content root — a node created on a page would otherwise never appear in the
 * export dialog.
 */
function exportableNodes(doc: { nodes: Record<string, SceneNode> }): SceneNode[] {
  return Object.values(doc.nodes).filter(
    (node) => (node.presets?.length ?? 0) > 0 || isImageShape(node),
  );
}

export interface ExportLayerHandle {
  openBatchBgRemove: () => void;
}

export interface ExportLayerProps {
  platform?: Platform;
}

export const ExportLayer = forwardRef<ExportLayerHandle, ExportLayerProps>(function ExportLayer(
  { platform },
  ref,
) {
  const editor = useEditor();
  const exportEngineRef = useRef<Promise<Engine> | null>(null);
  const saveExportFile = useMemo(() => createExportSaveFile(platform), [platform]);
  const [batchBgRemoveOpen, setBatchBgRemoveOpen] = useState(false);

  useImperativeHandle(ref, () => ({
    // BatchBgRemoveDialog calls removeBackground straight from @varve/engine
    // rather than through the editor context, so the context guard does not
    // cover it. Disabling the Object-menu item was not enough either — the
    // command palette reaches this same handler. Refusing to open the dialog
    // is the one place every route passes through.
    openBatchBgRemove: () => {
      if (isCapabilityRestricted('inference')) return;
      setBatchBgRemoveOpen(true);
    },
  }));

  const getExportEngine = useCallback(() => {
    exportEngineRef.current ??= createEngine('auto');
    return exportEngineRef.current;
  }, []);

  const handleExportBatch = useCallback(
    async (
      batch: ExportBatch,
      signal?: AbortSignal,
      onProgress?: (event: ExportProgressEvent) => void,
    ) => {
      const needsEngine = batch.jobs.some((job) => isRasterExport(job.format));
      const engine = needsEngine ? await getExportEngine() : null;
      const useBrowserArchive = platform?.kind === 'web' && batch.jobs.length > 1;
      const archive = useBrowserArchive ? createBufferedExportArchive(platform) : null;
      const folderSaveFile =
        platform?.kind === 'tauri' && batch.destinationFolder
          ? createExportFolderSaveFile(platform, batch.destinationFolder)
          : null;
      const report = await ExportService.run(
        batch,
        {
          document: editor.state.document,
          engine,
          saveFile: archive?.saveFile ?? folderSaveFile ?? saveExportFile,
          onProgress,
        },
        signal,
        platform?.kind ?? 'web',
      );
      if (archive && archive.fileCount() > 0) {
        const archivePath = await archive.flush(`${editor.state.document.name}-exports`);
        if (archivePath === null) {
          const error = new Error('Export archive save was cancelled');
          error.name = 'AbortError';
          throw error;
        }
        if (archivePath) {
          for (const file of report.files) {
            if (file.status === 'success') file.savedPath = archivePath;
          }
        }
      }
      const analytics = getDesktopAnalytics();
      for (const file of report.files) {
        const analyticsFormat = mapExportFormat(file.format);
        if (file.status === 'success') {
          analytics.track('export_completed', {
            format: analyticsFormat,
            durationBucket: durationBucket(file.durationMs),
          });
        } else {
          analytics.track('export_failed', {
            format: analyticsFormat,
            code: 'unknown',
          });
        }
      }
      void analytics.flush();
      return report;
    },
    [editor.state.document, getExportEngine, saveExportFile, platform?.kind],
  );

  const handleExportMotion = useCallback(
    (format: 'css' | 'lottie' | 'svg', fileName: string, content: string) => {
      const mimeType =
        format === 'lottie' ? 'application/json' : format === 'svg' ? 'image/svg+xml' : 'text/css';
      const extension = format === 'lottie' ? '.json' : format === 'svg' ? '.svg' : '.css';
      void saveExportBytes(
        platform,
        fileName,
        new TextEncoder().encode(content),
        mimeType,
        extension,
      );
    },
    [platform],
  );

  const handleSaveVideoFile = useCallback(
    async (fileName: string, bytes: Uint8Array, mimeType: string) => {
      const extension = fileName.toLowerCase().endsWith('.webm') ? '.webm' : '.mp4';
      await saveExportBytes(platform, fileName, bytes, mimeType, extension);
    },
    [platform],
  );

  const handlePackageExport = useCallback(async () => {
    const catalog = buildCatalogFromRegistry();
    const pkg = buildPackageExport(editor.state.document, undefined, catalog);
    await saveExportBytes(platform, pkg.fileName, pkg.bytes, pkg.mimeType, '.zip');
  }, [editor.state.document, platform]);

  return (
    <>
      <ExportDialog
        isOpen={editor.showExportDialog}
        onClose={() => editor.setShowExportDialog(false)}
        nodes={exportableNodes(editor.state.document)}
        timelines={editor.state.document.timelines}
        document={editor.state.document}
        selectionIds={editor.state.selection}
        platformKind={platform?.kind ?? 'web'}
        onSelectDestination={
          platform?.kind === 'tauri' ? () => platform.chooseExportFolder() : undefined
        }
        onRevealOutput={
          platform?.kind === 'tauri' ? (path) => platform.revealInFileManager(path) : undefined
        }
        revealOutputLabel={platform?.kind === 'tauri' ? platform.fileManagerLabel() : undefined}
        onExport={handleExportBatch}
        onPackageExport={handlePackageExport}
        onExportMotion={handleExportMotion}
        onSaveVideoFile={handleSaveVideoFile}
        onApplyBackgroundRemoval={(id, state) => {
          editor.updateNode(id, (n) => ({ ...n, backgroundRemoval: state }));
        }}
      />

      <BatchBgRemoveDialog
        open={batchBgRemoveOpen}
        onClose={() => setBatchBgRemoveOpen(false)}
        nodes={editor.state.selection
          .map((id) => editor.state.document.nodes[id])
          .filter((n): n is ShapeNode => !!n && isImageShape(n))}
        onNodeUpdate={(id, state) => {
          editor.updateNode(id, (n) => ({ ...n, backgroundRemoval: state }));
        }}
      />
    </>
  );
});

/**
 * Build a FontCatalog from the current FontRegistry so that package export
 * can report real embedding status for each font family.
 */
function buildCatalogFromRegistry(): FontCatalog {
  const catalog = new FontCatalog();
  const registry = getFontRegistry();

  for (const family of registry.families()) {
    const entries = registry.getEntries(family);
    const first = entries[0];
    if (!first) continue;

    catalog.addEntry({
      identity: {
        contentHash: `registry:${family}`,
        postScriptName: family.replace(/\s+/g, '-'),
        familyName: family,
        subfamilyName: weightToSubfamily(first.weight, first.style),
        fullName: `${family} ${weightToSubfamily(first.weight, first.style)}`,
      },
      format: 'unknown',
      fileSize: 0,
      unitsPerEm: 1000,
      ascender: 800,
      descender: -200,
      lineGap: 0,
      glyphCount: 0,
      isVariable: registry.isVariable(family),
      axes: [],
      namedInstances: [],
      openTypeFeatures: registry.getSupportedFeatures(family),
      unicodeRanges: [],
      scripts: [],
      embeddingRights: first.source === 'system' ? 'installable' : 'unknown',
      hasColorGlyphs: false,
      category: 'sans-serif',
      source:
        first.source === 'system' ? 'system' : first.source === 'google' ? 'remote' : 'bundled',
    });
  }

  return catalog;
}

function weightToSubfamily(weight: number, style: string): string {
  const weightNames: Record<number, string> = {
    100: 'Thin',
    200: 'ExtraLight',
    300: 'Light',
    400: 'Regular',
    500: 'Medium',
    600: 'SemiBold',
    700: 'Bold',
    800: 'ExtraBold',
    900: 'Black',
  };
  const base = weightNames[weight] ?? 'Regular';
  return style === 'italic' ? `${base} Italic` : base;
}

function mapExportFormat(format: string): 'png' | 'jpeg' | 'webp' | 'svg' | 'pdf' | 'gif' | 'webm' {
  if (format === 'png' || format === 'gif' || format === 'webm') return format;
  if (format === 'jpg') return 'jpeg';
  if (format === 'webp') return 'webp';
  if (format === 'svg') return 'svg';
  if (format.startsWith('pdf')) return 'pdf';
  return 'png';
}
