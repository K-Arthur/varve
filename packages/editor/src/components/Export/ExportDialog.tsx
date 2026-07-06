/**
 * Export dialog — full-screen modal for batch export management.
 *
 * Shows all nodes with enabled presets as export jobs, progress tracking,
 * destination configuration, and cancellation support.
 */

import type { ExportBatch, ExportJob, ExportPreset, SceneNode, ShapeNode } from '@strata/scene';
import { imageShapeH, imageShapeSrc, imageShapeW, isImageShape } from '@strata/scene';
import { useCallback, useEffect, useMemo, useState } from 'react';
import { BatchJobList } from './BatchJobList';
import { DestinationPicker } from './DestinationPicker';
import { ExportProgressBar } from './ExportProgressBar';

import './ExportDialog.css';

export interface ExportDialogProps {
  isOpen: boolean;
  onClose: () => void;
  nodes: SceneNode[];
  onExport: (batch: ExportBatch) => Promise<void>;
  initialTemplate?: string;
}

function safeFilename(name: string): string {
  return name.replace(/[^a-zA-Z0-9-_\s]/g, '').trim() || 'export';
}

function buildJobs(nodes: SceneNode[]): ExportJob[] {
  const jobs: ExportJob[] = [];
  for (const node of nodes) {
    const presets: ExportPreset[] = node.presets ?? [];
    for (const preset of presets) {
      if (!preset.enabled) continue;
      const safeName = safeFilename(node.name);
      const ext = preset.format.startsWith('pdf')
        ? 'pdf'
        : preset.format === 'svg' || preset.format === 'svg-component'
          ? 'svg'
          : preset.format === 'react-tailwind' || preset.format === 'react-cssmodules'
            ? 'tsx'
            : preset.format === 'flutter'
              ? 'dart'
              : preset.format === 'swiftui'
                ? 'swift'
                : preset.format;
      const suffix = preset.suffix ? `-${preset.suffix}` : '';
      const fileName = `${safeName}${suffix}.${ext}`;
      const scale = preset.scale.type === 'factor' ? preset.scale.value : 1;
      jobs.push({
        presetId: preset.id,
        nodeId: node.id,
        nodeName: node.name,
        format: preset.format,
        fileName,
        dimensions: { w: Math.round(100 * scale), h: Math.round(80 * scale) },
        estimatedSize: 1024 * 50,
        status: 'pending',
      });
    }
  }
  return jobs;
}

export function ExportDialog({
  isOpen,
  onClose,
  nodes,
  onExport,
  initialTemplate = '{name}{suffix}.{ext}',
}: ExportDialogProps) {
  const [running, setRunning] = useState(false);
  const [progress, setProgress] = useState({ done: 0, errors: 0 });
  const [selectedIds, setSelectedIds] = useState<Set<string>>(new Set());
  const [template, setTemplate] = useState(initialTemplate);
  const [folderRule, setFolderRule] = useState<ExportBatch['folderRule']>('flat');
  const [destinationLabel, setDestinationLabel] = useState('');
  const [announceMsg, setAnnounceMsg] = useState('');
  const [removeBgBeforeExport, setRemoveBgBeforeExport] = useState(false);

  const jobs = useMemo(() => buildJobs(nodes), [nodes]);

  useEffect(() => {
    if (isOpen) {
      setRunning(false);
      setProgress({ done: 0, errors: 0 });
      setAnnounceMsg('');
      const allIds = new Set(jobs.map((job) => `${job.nodeId}-${job.presetId}`));
      setSelectedIds(allIds);
    }
  }, [isOpen, jobs]);

  useEffect(() => {
    if (!isOpen) return;
    function handleKey(e: KeyboardEvent) {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    }
    window.addEventListener('keydown', handleKey, true);
    return () => window.removeEventListener('keydown', handleKey, true);
  }, [isOpen, onClose]);

  const handleExport = useCallback(async () => {
    setRunning(true);
    setProgress({ done: 0, errors: 0 });
    const selectedJobs = jobs.filter((job) => selectedIds.has(`${job.nodeId}-${job.presetId}`));

    if (removeBgBeforeExport) {
      const imageNodes = nodes.filter((n): n is ShapeNode => isImageShape(n));
      const pendingImages = imageNodes.filter((n) => !n.backgroundRemoval);
      if (pendingImages.length > 0) {
        setAnnounceMsg(`Removing background from ${pendingImages.length} image(s)...`);
        const { removeBackground: removeBgFn } = await import('@strata/engine');
        const { getImageCache } = await import('@strata/engine');
        const cache = getImageCache();
        for (const imgNode of pendingImages) {
          try {
            const src = imageShapeSrc(imgNode);
            const w = imageShapeW(imgNode);
            const h = imageShapeH(imgNode);
            const img = await cache.load(src);
            if (!img) continue;
            const c = document.createElement('canvas');
            c.width = w;
            c.height = h;
            const ctx = c.getContext('2d');
            if (!ctx) continue;
            ctx.drawImage(img, 0, 0, w, h);
            const imageData = ctx.getImageData(0, 0, w, h);
            const result = await removeBgFn(imageData, {
              method: 'quick',
              feather: 0.5,
              decontaminate: true,
            });
            const { setBackgroundRemoval } = await import('@strata/scene');
            nodes.forEach((n, i) => {
              if (n.id === imgNode.id) {
                (nodes as unknown[])[i] = setBackgroundRemoval(
                  { nodes: { [n.id]: n } } as never,
                  n.id,
                  {
                    maskDataUrl: result.maskDataUrl,
                    method: result.method,
                    confidence: result.confidence,
                    appliedAt: Date.now(),
                    feather: 0.5,
                    decontaminate: true,
                  },
                ).nodes[n.id];
              }
            });
          } catch {
            // continue with export even if bg removal fails
          }
        }
      }
    }

    const batch: ExportBatch = {
      jobs: selectedJobs,
      destinationFolder: destinationLabel || null,
      filenameTemplate: template,
      folderRule,
    };
    await onExport(batch);
    setRunning(false);
    setAnnounceMsg(`Export complete: ${selectedJobs.length} files exported`);
  }, [
    jobs,
    selectedIds,
    onExport,
    destinationLabel,
    template,
    folderRule,
    removeBgBeforeExport,
    nodes,
  ]);

  const handleCancel = useCallback(() => {
    setRunning(false);
    setProgress({ done: 0, errors: 0 });
    setAnnounceMsg('Export cancelled');
  }, []);

  const handleToggleJob = useCallback((jobKey: string) => {
    setSelectedIds((prev) => {
      const next = new Set(prev);
      if (next.has(jobKey)) next.delete(jobKey);
      else next.add(jobKey);
      return next;
    });
  }, []);

  const handleToggleAll = useCallback(() => {
    setSelectedIds((prev) => {
      const allIds = new Set(jobs.map((job) => `${job.nodeId}-${job.presetId}`));
      return prev.size === jobs.length ? new Set() : allIds;
    });
  }, [jobs]);

  const handleSelectDestination = useCallback(() => {
    setDestinationLabel('/exports');
  }, []);

  if (!isOpen) return null;

  return (
    <div
      className="export-dialog-overlay"
      role="dialog"
      aria-modal="true"
      aria-label="Export"
      onClick={(e) => {
        if (e.target === e.currentTarget) onClose();
      }}
    >
      <div className="export-dialog">
        <div className="export-dialog__header">
          <h2 className="export-dialog__title">Export</h2>
          <button
            type="button"
            className="export-dialog__close"
            aria-label="Close"
            onClick={onClose}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="3"
              strokeLinecap="round"
              aria-hidden="true"
            >
              <path d="M18 6 6 18" />
              <path d="m6 6 12 12" />
            </svg>
          </button>
        </div>

        <div className="export-dialog__body">
          <section className="export-dialog__section" aria-label="Jobs">
            <h3 className="export-dialog__section-title">Files to export</h3>
            <BatchJobList
              jobs={jobs}
              selectedIds={selectedIds}
              onToggleJob={handleToggleJob}
              onToggleAll={handleToggleAll}
            />
          </section>

          <section className="export-dialog__section" aria-label="Destination">
            <h3 className="export-dialog__section-title">Destination</h3>
            <DestinationPicker
              template={template}
              folderRule={folderRule}
              jobs={jobs}
              onTemplateChange={setTemplate}
              onFolderRuleChange={setFolderRule}
              onSelectDestination={handleSelectDestination}
              destinationLabel={destinationLabel}
            />
          </section>

          <section className="export-dialog__section" aria-label="Background">
            <h3 className="export-dialog__section-title">Background</h3>
            <label className="export-dialog__checkbox-label">
              <input
                type="checkbox"
                checked={removeBgBeforeExport}
                onChange={(e) => setRemoveBgBeforeExport(e.target.checked)}
              />
              <span>Remove background before export</span>
            </label>
            {removeBgBeforeExport &&
              (() => {
                const imageCount = nodes.filter(
                  (n): n is ShapeNode => isImageShape(n) && !n.backgroundRemoval,
                ).length;
                return imageCount > 0 ? (
                  <p className="export-dialog__note">
                    Background removal will be applied to {imageCount} image
                    {imageCount !== 1 ? 's' : ''}
                  </p>
                ) : (
                  <p className="export-dialog__note">All images already have background removal</p>
                );
              })()}
          </section>

          {(running || progress.done > 0 || progress.errors > 0) && (
            <section className="export-dialog__section" aria-label="Progress">
              <h3 className="export-dialog__section-title">Progress</h3>
              <ExportProgressBar
                total={selectedIds.size}
                done={progress.done}
                errors={progress.errors}
                running={running}
                onCancel={handleCancel}
              />
            </section>
          )}
        </div>

        <div className="export-dialog__footer">
          <button
            type="button"
            className="export-dialog__btn export-dialog__btn--secondary"
            onClick={onClose}
            disabled={running}
          >
            Close
          </button>
          <button
            type="button"
            className="export-dialog__btn export-dialog__btn--primary"
            onClick={handleExport}
            disabled={running || selectedIds.size === 0}
          >
            {running ? 'Exporting\u2026' : `Export (${selectedIds.size})`}
          </button>
        </div>

        <div role="status" aria-live="polite" className="strata-visually-hidden">
          {announceMsg}
        </div>
      </div>
    </div>
  );
}
