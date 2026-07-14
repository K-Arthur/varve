import { createEngine, type Engine } from '@strata/engine';
import type { Platform } from '@strata/platform';
import type { ExportBatch, ExportFormat, ShapeNode } from '@strata/scene';
import { isImageShape } from '@strata/scene';
import { forwardRef, useCallback, useImperativeHandle, useMemo, useRef, useState } from 'react';
import { useEditor } from '../../context';
import { createExportSaveFile, saveExportBytes } from '../../exportSaveAdapter';
import { ExportService } from '../../exportService';
import { buildPackageExport } from '../../packageExport';
import { BatchBgRemoveDialog } from '../BatchBgRemoveDialog';
import { ExportDialog } from '../Export/ExportDialog';

function isRasterExport(format: ExportFormat): boolean {
  return format === 'png' || format === 'jpg' || format === 'webp';
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
    openBatchBgRemove: () => setBatchBgRemoveOpen(true),
  }));

  const getExportEngine = useCallback(() => {
    exportEngineRef.current ??= createEngine('auto');
    return exportEngineRef.current;
  }, []);

  const handleExportBatch = useCallback(
    async (batch: ExportBatch) => {
      const needsEngine = batch.jobs.some((job) => isRasterExport(job.format));
      const engine = needsEngine ? await getExportEngine() : null;
      return await ExportService.run(batch, {
        document: editor.state.document,
        engine,
        saveFile: saveExportFile,
      });
    },
    [editor.state.document, getExportEngine, saveExportFile],
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
    const pkg = buildPackageExport(editor.state.document);
    await saveExportBytes(platform, pkg.fileName, pkg.bytes, pkg.mimeType, '.zip');
  }, [editor.state.document, platform]);

  return (
    <>
      <ExportDialog
        isOpen={editor.showExportDialog}
        onClose={() => editor.setShowExportDialog(false)}
        nodes={editor.rootNodes()}
        timelines={editor.state.document.timelines}
        document={editor.state.document}
        selectionIds={editor.state.selection}
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
