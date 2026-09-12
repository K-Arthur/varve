import { exportNodeToSvg } from '@varve/codegen';
import { createEngine, type Engine, getFontRegistry } from '@varve/engine';
import { FontCatalog } from '@varve/engine/font';
import type { Platform } from '@varve/platform';
import type { Document, ExportBatch, ExportFormat, SceneNode, ShapeNode } from '@varve/scene';
import { isExportRegion, resolveNodePaints } from '@varve/scene';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { durationBucket, getDesktopAnalytics } from '../../analytics/desktopAnalytics';
import {
  commitPreparedBackgroundRemoval,
  type PreparedBackgroundRemoval,
} from '../../backgroundRemoval/commitRasterMask';
import { isCapabilityRestricted } from '../../capabilities/restrictions';
import { type ClipboardSelectionSnapshot, writeClipboardRepresentation } from '../../clipboard';
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
import { worldBBox } from '../SpecPanel/measurement';
import { QuickConvertDialogHost } from './QuickConvertDialogHost';

function isRasterExport(format: ExportFormat): boolean {
  return format === 'png' || format === 'jpg' || format === 'webp';
}

/**
 * Nodes the batch dialog can export: every document node that carries at least
 * one export preset, every Export Region, plus image shapes (the
 * background-removal pre-pass needs them). This is sourced from the full
 * document node table rather than `rootNodes()`, because page-scoped content
 * lives under the active page's content root — a node created on a page would
 * otherwise never appear in the export dialog.
 *
 * Export Regions are listed whether or not they still carry a preset: a region
 * exists only to be exported, so one whose presets were all removed should
 * still be visible here rather than silently dropping out of the dialog.
 */
function exportableNodes(doc: Document): SceneNode[] {
  return Object.values(doc.nodes).filter(
    (node) =>
      (node.presets?.length ?? 0) > 0 ||
      isExportRegion(node) ||
      (node.kind === 'shape' &&
        resolveNodePaints({ fills: node.fills, paintRefs: node.paintRefs }, doc).some(
          (fill) => fill.type === 'image' && fill.image,
        )),
  );
}

export interface ExportLayerHandle {
  openBatchBgRemove: () => void;
  copySelectionAsPng: (scale: 1 | 2 | 3, selection?: ClipboardSelectionSnapshot) => Promise<void>;
}

export interface ExportLayerProps {
  platform?: Platform;
}

const MAX_COPY_PNG_DIMENSION = 32_768;
const MAX_COPY_PNG_PIXELS = 64_000_000;

function stripSvgEnvelope(markup: string): string {
  return markup
    .replace(/^\s*<\?xml[^>]*>\s*/i, '')
    .replace(/^\s*<svg[^>]*>/i, '')
    .replace(/<\/svg>\s*$/i, '');
}

function unionBounds(
  bounds: { x: number; y: number; w: number; h: number },
  next: { x: number; y: number; w: number; h: number },
): { x: number; y: number; w: number; h: number } {
  const x = Math.min(bounds.x, next.x);
  const y = Math.min(bounds.y, next.y);
  return {
    x,
    y,
    w: Math.max(bounds.x + bounds.w, next.x + next.w) - x,
    h: Math.max(bounds.y + bounds.h, next.y + next.h) - y,
  };
}

async function renderSelectionPng(
  nodes: readonly SceneNode[],
  documentSnapshot: Document,
  requestedScale: 1 | 2 | 3,
  worldTransforms?: Readonly<Record<string, SceneNode['transform']>>,
): Promise<{ bytes: Uint8Array; clamped: boolean }> {
  if (typeof document === 'undefined' || typeof Image === 'undefined') {
    throw new Error('PNG rendering is unavailable in this runtime');
  }
  let bounds = worldBBox(nodes[0]!, documentSnapshot);
  for (const node of nodes.slice(1))
    bounds = unionBounds(bounds, worldBBox(node, documentSnapshot));
  const width = Math.max(1, bounds.w);
  const height = Math.max(1, bounds.h);
  const parts = nodes.map((node) => {
    const exportRoot = worldTransforms?.[node.id]
      ? ({ ...node, transform: worldTransforms[node.id]!, rotation: 0 } as SceneNode)
      : node;
    return stripSvgEnvelope(
      exportNodeToSvg(exportRoot, documentSnapshot, { background: 'transparent' }),
    );
  });
  const svg = [
    '<?xml version="1.0" encoding="UTF-8"?>',
    `<svg xmlns="http://www.w3.org/2000/svg" viewBox="${bounds.x} ${bounds.y} ${width} ${height}" width="${width}" height="${height}">`,
    `<g>${parts.join('')}</g>`,
    '</svg>',
  ].join('');

  const requestedWidth = Math.max(1, Math.round(width * requestedScale));
  const requestedHeight = Math.max(1, Math.round(height * requestedScale));
  const pixelScale = Math.min(
    1,
    MAX_COPY_PNG_DIMENSION / requestedWidth,
    MAX_COPY_PNG_DIMENSION / requestedHeight,
    Math.sqrt(MAX_COPY_PNG_PIXELS / (requestedWidth * requestedHeight)),
  );
  const outputWidth = Math.max(1, Math.floor(requestedWidth * pixelScale));
  const outputHeight = Math.max(1, Math.floor(requestedHeight * pixelScale));
  const canvas = document.createElement('canvas');
  canvas.width = outputWidth;
  canvas.height = outputHeight;
  const context = canvas.getContext('2d');
  if (!context) throw new Error('PNG rendering is unavailable in this runtime');

  const image = new Image();
  const svgUrl = URL.createObjectURL(new Blob([svg], { type: 'image/svg+xml' }));
  try {
    await new Promise<void>((resolve, reject) => {
      image.onload = () => resolve();
      image.onerror = () => reject(new Error('SVG selection could not be rasterized'));
      image.src = svgUrl;
    });
    context.clearRect(0, 0, outputWidth, outputHeight);
    context.drawImage(image, 0, 0, outputWidth, outputHeight);
    const blob = await new Promise<Blob>((resolve, reject) => {
      canvas.toBlob((value) => {
        if (value) resolve(value);
        else reject(new Error('PNG encoding is unavailable in this runtime'));
      }, 'image/png');
    });
    return {
      bytes: new Uint8Array(await blob.arrayBuffer()),
      clamped: outputWidth !== requestedWidth || outputHeight !== requestedHeight,
    };
  } finally {
    URL.revokeObjectURL(svgUrl);
  }
}

export const ExportLayer = forwardRef<ExportLayerHandle, ExportLayerProps>(function ExportLayer(
  { platform },
  ref,
) {
  const editor = useEditor();
  const editorRef = useRef(editor);
  editorRef.current = editor;
  const applyPreparedCutout = useCallback((id: string, prepared: PreparedBackgroundRemoval) => {
    const current = editorRef.current;
    const snapshot = current.state.document;
    const committed = commitPreparedBackgroundRemoval(snapshot, id, prepared);
    if (committed === snapshot)
      throw new Error('The image changed while processing; this cutout was not applied.');
    current.updateDoc((doc) =>
      doc === snapshot ? committed : commitPreparedBackgroundRemoval(doc, id, prepared),
    );
  }, []);
  const exportEngineRef = useRef<Promise<Engine> | null>(null);
  const saveExportFile = useMemo(() => createExportSaveFile(platform), [platform]);
  const [batchBgRemoveOpen, setBatchBgRemoveOpen] = useState(false);

  const copySelectionAsPng = useCallback(
    async (scale: 1 | 2 | 3, selection?: ClipboardSelectionSnapshot): Promise<void> => {
      const snapshot = editorRef.current;
      const documentSnapshot = selection?.document ?? snapshot.state.document;
      const nodes = selection
        ? [...selection.nodes]
        : snapshot.state.selection
            .map((id) => documentSnapshot.nodes[id])
            .filter((node): node is SceneNode => Boolean(node));
      if (nodes.length === 0) {
        snapshot.announce('Select artwork before copying PNG');
        return;
      }
      if (
        selection &&
        (snapshot.state.document.id !== selection.document.id ||
          snapshot.state.activeId !== selection.activeId ||
          snapshot.state.revision !== selection.revision ||
          snapshot.state.selectionRevision !== selection.selectionRevision)
      ) {
        snapshot.announce('Copy as PNG cancelled because the document changed');
        return;
      }
      try {
        const rendered = await renderSelectionPng(
          nodes,
          documentSnapshot,
          scale,
          selection?.worldTransforms,
        );
        if (
          selection &&
          (snapshot.state.document.id !== selection.document.id ||
            snapshot.state.activeId !== selection.activeId ||
            snapshot.state.revision !== selection.revision ||
            snapshot.state.selectionRevision !== selection.selectionRevision)
        ) {
          snapshot.announce('Copy as PNG cancelled because the document changed');
          return;
        }
        const outcome = await writeClipboardRepresentation(
          'image/png',
          rendered.bytes,
          nodes.map((node) => node.name).join('\n'),
          platform,
        );
        if (outcome.status === 'editable') {
          snapshot.announce(
            rendered.clamped
              ? 'Copied selection as PNG (scaled down to fit the image safety limit)'
              : 'Copied selection as PNG',
          );
        } else if (outcome.status === 'text-only') {
          snapshot.announce('Copied layer names as text — PNG clipboard write unavailable');
        } else {
          snapshot.announce('Copy PNG failed — clipboard unavailable');
        }
      } catch (error) {
        snapshot.announce(
          error instanceof Error ? `Copy PNG failed — ${error.message}` : 'Copy PNG failed',
        );
      }
    },
    [platform],
  );

  useImperativeHandle(
    ref,
    () => ({
      // BatchBgRemoveDialog calls removeBackground straight from @varve/engine
      // rather than through the editor context, so the context guard does not
      // cover it. Disabling the Object-menu item was not enough either — the
      // command palette reaches this same handler. Refusing to open the dialog
      // is the one place every route passes through.
      openBatchBgRemove: () => {
        if (isCapabilityRestricted('inference')) return;
        setBatchBgRemoveOpen(true);
      },
      copySelectionAsPng,
    }),
    [copySelectionAsPng],
  );

  const getExportEngine = useCallback(() => {
    exportEngineRef.current ??= createEngine('auto');
    return exportEngineRef.current;
  }, []);

  const handleExportBatch = useCallback(
    async (
      batch: ExportBatch,
      signal?: AbortSignal,
      onProgress?: (event: ExportProgressEvent) => void,
      preparedDocument?: Document,
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
          document: preparedDocument ?? editor.state.document,
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
    const pkg = await buildPackageExport(editor.state.document, undefined, catalog);
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
        onApplyBackgroundRemoval={applyPreparedCutout}
      />

      <BatchBgRemoveDialog
        open={batchBgRemoveOpen}
        documentId={editor.state.document.id}
        document={editor.state.document}
        onClose={() => setBatchBgRemoveOpen(false)}
        nodes={editor.state.selection
          .map((id) => editor.state.document.nodes[id])
          .filter((n): n is ShapeNode => n?.kind === 'shape')}
        onNodeUpdate={applyPreparedCutout}
      />
      <QuickConvertDialogHost platform={platform} />
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
