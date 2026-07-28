import type {
  DownloadProgress,
  ModelManifestEntry,
  ModelState,
  RuntimeCapabilities,
} from '@strata/engine';
import {
  createDiagnosticsLabel,
  DownloadManager,
  deriveAcquisition,
  getRuntimeCapabilities,
  isInferenceError,
  listAllModels,
  resetRuntimeCapabilities,
} from '@strata/engine';
import { Button, Icon, RegionLoader } from '@strata/ui';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';

interface ModelRow {
  entry: ModelManifestEntry;
  state: ModelState;
  downloadProgress: DownloadProgress | null;
  sourceLabel: string;
  storageLabel: string;
  memoryWarning?: string;
  availabilityReason?: string;
}

const CATEGORY_ORDER: Record<string, number> = {
  segmentation: 0,
  'background-removal': 1,
  upscaling: 2,
  denoising: 3,
  depth: 4,
  colorization: 5,
  lineart: 6,
  inpainting: 7,
  detection: 8,
  classification: 9,
  embedding: 10,
  ocr: 11,
  'frame-interpolation': 12,
  other: 99,
};

const CATEGORY_LABELS: Record<string, string> = {
  segmentation: 'Background Removal & Selection',
  'background-removal': 'Background Removal & Selection',
  upscaling: 'Image Upscaling',
  denoising: 'AI Denoising',
  depth: 'Depth Estimation',
  colorization: 'Colorization',
  lineart: 'Line Art Extraction',
  inpainting: 'Content-Aware Fill',
  detection: 'Object Detection',
  classification: 'Classification & Tagging',
  embedding: 'Semantic Search',
  ocr: 'Text Recognition (OCR)',
  'frame-interpolation': 'Frame Interpolation',
  other: 'Other Models',
};

function formatSize(bytes: number): string {
  if (bytes >= 1_000_000_000) return `${(bytes / 1_000_000_000).toFixed(1)} GB`;
  if (bytes >= 1_000_000) return `${Math.round(bytes / 1_000_000)} MB`;
  if (bytes >= 1_000) return `${Math.round(bytes / 1_000)} KB`;
  return `${bytes} B`;
}

function formatSpeed(speed: number): string {
  if (speed >= 1_000_000) return `${(speed / 1_000_000).toFixed(1)} MB/s`;
  if (speed >= 1_000) return `${Math.round(speed / 1_000)} KB/s`;
  return `${Math.round(speed)} B/s`;
}

function formatDuration(ms: number): string {
  if (ms >= 60_000) return `${Math.round(ms / 60_000)}m`;
  if (ms >= 1_000) return `${Math.round(ms / 1_000)}s`;
  return `${Math.round(ms)}ms`;
}

function qualityLabel(q: number): string {
  if (q >= 5) return 'Best';
  if (q >= 4) return 'High';
  if (q >= 3) return 'Balanced';
  if (q >= 2) return 'Fast';
  return 'Preview';
}

export function ModelManager() {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [caps, setCaps] = useState<RuntimeCapabilities | null>(null);
  const [loading, setLoading] = useState(true);
  const [diagnostics, setDiagnostics] = useState<string[]>([]);
  const [busyId, setBusyId] = useState<string | null>(null);
  const downloadManagerRef = useRef<DownloadManager | null>(null);
  const [showDiagnostics, setShowDiagnostics] = useState(false);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const catalog = listAllModels();
      const dm = new DownloadManager();
      for (const entry of catalog) {
        dm.registerModel(entry as Parameters<typeof dm.registerModel>[0]);
      }
      downloadManagerRef.current = dm;

      const runtimeCaps = await getRuntimeCapabilities();
      setCaps(runtimeCaps);
      setDiagnostics(createDiagnosticsEntries(runtimeCaps));

      const modelRows: ModelRow[] = [];
      for (const entry of catalog) {
        const state = await dm.getDownloadState(entry.id);
        const isReady = state === 'ready';

        let memoryWarning: string | undefined;
        if (entry.peakMemoryBytes && runtimeCaps.memoryTier === 'low') {
          const peakMB = Math.round(entry.peakMemoryBytes / 1_000_000);
          if (peakMB > 500) {
            memoryWarning = `~${peakMB}MB peak — may be slow on ${Math.round((runtimeCaps.approximateMemoryMB ?? 4096) / 1024)}GB systems`;
          }
        }

        let availabilityReason: string | undefined;
        if (!entry.bundled && !isReady) {
          const acquisition = deriveAcquisition(entry);
          if (acquisition.kind === 'unavailable') {
            availabilityReason = acquisition.detail;
          } else if (acquisition.kind === 'generated') {
            availabilityReason = 'Build from source weights (see tools/ddcolor-export/)';
          } else if (
            entry.peakMemoryBytes &&
            runtimeCaps.memoryTier === 'low' &&
            entry.peakMemoryBytes > 1_000_000_000
          ) {
            availabilityReason = 'Too large for this device (requires >4GB RAM)';
          }
        }

        modelRows.push({
          entry,
          state: isReady ? 'ready' : state === 'downloading' ? 'downloading' : 'unavailable',
          downloadProgress: null,
          sourceLabel: entry.bundled ? 'Bundled' : isReady ? 'Downloaded' : 'Not installed',
          storageLabel: entry.bundled ? 'App package' : isReady ? 'Local storage' : '',
          memoryWarning,
          availabilityReason,
        });
      }
      setRows(modelRows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
  }, [refresh]);

  const handleDownload = useCallback(async (modelId: string) => {
    const dm = downloadManagerRef.current;
    if (!dm) return;
    setBusyId(modelId);

    try {
      const unsubState = dm.subscribeState(modelId, (id: string, state) => {
        setRows((prev: ModelRow[]) =>
          prev.map((r: ModelRow) =>
            r.entry.id === id
              ? {
                  ...r,
                  state: state as ModelState,
                  sourceLabel: state === 'ready' ? 'Downloaded' : r.sourceLabel,
                }
              : r,
          ),
        );
      });

      const unsubProgress = dm.subscribeDownloadProgress(modelId, (p: DownloadProgress) => {
        setRows((prev) =>
          prev.map((r) => (r.entry.id === p.modelId ? { ...r, downloadProgress: p } : r)),
        );
      });

      await dm.startDownload(modelId);

      unsubState();
      unsubProgress();

      setRows((prev) =>
        prev.map((r) =>
          r.entry.id === modelId
            ? {
                ...r,
                state: 'ready',
                sourceLabel: 'Downloaded',
                storageLabel: 'Local storage',
                downloadProgress: null,
              }
            : r,
        ),
      );
    } catch (err) {
      if (isInferenceError(err) && err.code === 'download_interrupted') {
        setRows((prev) =>
          prev.map((r) =>
            r.entry.id === modelId ? { ...r, state: 'unavailable', downloadProgress: null } : r,
          ),
        );
      }
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleDelete = useCallback(async (modelId: string) => {
    const dm = downloadManagerRef.current;
    if (!dm) return;
    setBusyId(modelId);
    try {
      await dm.deleteModel(modelId);
      setRows((prev) =>
        prev.map((r) =>
          r.entry.id === modelId
            ? {
                ...r,
                state: 'unavailable',
                sourceLabel: 'Not installed',
                storageLabel: '',
                downloadProgress: null,
              }
            : r,
        ),
      );
    } finally {
      setBusyId(null);
    }
  }, []);

  const handleCancel = useCallback((modelId: string) => {
    const dm = downloadManagerRef.current;
    if (!dm) return;
    dm.cancelDownload(modelId);
    setRows((prev) =>
      prev.map((r) =>
        r.entry.id === modelId ? { ...r, state: 'unavailable', downloadProgress: null } : r,
      ),
    );
  }, []);

  const sortedRows = useMemo(() => {
    const grouped = new Map<string, ModelRow[]>();
    for (const row of rows) {
      const cat = row.entry.category ?? 'other';
      if (!grouped.has(cat)) grouped.set(cat, []);
      grouped.get(cat)!.push(row);
    }

    const sorted = Array.from(grouped.entries()).sort(
      (a, b) => (CATEGORY_ORDER[a[0]] ?? 99) - (CATEGORY_ORDER[b[0]] ?? 99),
    );

    for (const [, groupRows] of sorted) {
      groupRows.sort((a, b) => {
        if (a.entry.bundled !== b.entry.bundled) return a.entry.bundled ? -1 : 1;
        if (a.state === 'ready' && b.state !== 'ready') return -1;
        if (a.state !== 'ready' && b.state === 'ready') return 1;
        const aAvailable = a.state === 'ready' || (!!a.entry.remoteUrl && !!a.entry.checksum);
        const bAvailable = b.state === 'ready' || (!!b.entry.remoteUrl && !!b.entry.checksum);
        if (aAvailable && !bAvailable) return -1;
        if (!aAvailable && bAvailable) return 1;
        return b.entry.quality - a.entry.quality;
      });
    }

    return sorted;
  }, [rows]);

  const totalStorage = useMemo(() => {
    let total = 0;
    for (const row of rows) {
      if (row.state === 'ready' && !row.entry.bundled) {
        total += row.entry.sizeBytes;
      }
    }
    return total;
  }, [rows]);

  if (loading && rows.length === 0) {
    return <RegionLoader label="Loading models" loading />;
  }

  return (
    <div className="settings-section">
      <div className="model-manager__header">
        <p className="settings-section__hint">
          All AI models run locally on your device. Bundled models ship with the app. Optional
          models are downloaded on demand and stored in your browser's local storage or the desktop
          app's data directory. Models marked as unavailable have no trusted public ONNX source and
          require manual export from their original framework.
        </p>

        {totalStorage > 0 && (
          <p className="settings-section__hint">
            Total storage for downloaded models: <strong>{formatSize(totalStorage)}</strong>
          </p>
        )}
      </div>

      <div className="model-manager__toolbar">
        <Button variant="ghost" size="sm" onClick={() => setShowDiagnostics(!showDiagnostics)}>
          {showDiagnostics ? 'Hide runtime info' : 'Show runtime info'}
        </Button>
      </div>

      {showDiagnostics && caps && (
        <section className="model-manager__diagnostics" aria-label="Runtime diagnostics">
          <h4 className="settings-section__subtitle">Runtime Diagnostics</h4>
          <p className="model-manager__diag-label">{createDiagnosticsLabel(caps)}</p>
          <ul className="model-manager__diag-list">
            {diagnostics.map((d) => (
              <li key={d} className="model-manager__diag-item">
                {d}
              </li>
            ))}
          </ul>
          <div className="model-manager__diag-actions">
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                const report = [
                  '--- Strata AI Runtime Diagnostics ---',
                  ...diagnostics,
                  '',
                  'Installed Models:',
                  ...rows
                    .filter((r) => r.state === 'ready')
                    .map((r) => `  ${r.entry.name} (${r.entry.precision})`),
                  '',
                  `Total Downloaded: ${formatSize(totalStorage)}`,
                  `WebGPU: ${caps.hasWebGPU}`,
                  `WebGL: ${caps.hasWebGL}`,
                  `SharedArrayBuffer: ${caps.sharedMemoryAvailable}`,
                  `Cross-Origin Isolated: ${caps.crossOriginIsolated}`,
                  `Providers: ${caps.preferredOnnxProviders.join(', ')}`,
                ].join('\n');
                navigator.clipboard.writeText(report);
              }}
            >
              Copy to clipboard
            </Button>
            <Button
              variant="ghost"
              size="sm"
              onClick={() => {
                resetRuntimeCapabilities();
                void refresh();
              }}
            >
              Re-detect
            </Button>
          </div>
        </section>
      )}

      {sortedRows.map(([catId, catRows]) => (
        <div key={catId} className="model-manager__category">
          <h3 className="settings-section__title">{CATEGORY_LABELS[catId] ?? catId}</h3>

          {catRows.length === 0 && (
            <p className="settings-section__hint">No models in this category.</p>
          )}

          <ul className="bg-models-list" aria-label={`${CATEGORY_LABELS[catId] ?? catId} models`}>
            {catRows.map((row) => {
              const isReady = row.state === 'ready';
              const isDownloading = row.state === 'downloading';
              const canDownload =
                !row.entry.bundled && Boolean(row.entry.remoteUrl && row.entry.checksum);
              const progress = row.downloadProgress;
              const progressPercent =
                progress && progress.total > 0
                  ? Math.round((progress.loaded / progress.total) * 100)
                  : 0;

              return (
                <li key={row.entry.id} className="bg-models-list__row">
                  <div className="bg-models-list__info">
                    <span className="bg-models-list__name">
                      {row.entry.name}
                      {row.entry.precision && row.entry.precision !== 'fp32' && (
                        <span className="bg-models-list__badge">
                          {row.entry.precision.toUpperCase()}
                        </span>
                      )}
                      {row.entry.bundled && (
                        <span className="bg-models-list__badge bg-models-list__badge--bundled">
                          BUNDLED
                        </span>
                      )}
                    </span>

                    <span className="bg-models-list__meta">
                      {formatSize(row.entry.sizeBytes)}
                      {' · '}
                      {qualityLabel(row.entry.quality)} quality
                      {' · '}
                      {row.sourceLabel}
                    </span>

                    {row.entry.description && (
                      <span className="bg-models-list__desc">{row.entry.description}</span>
                    )}

                    {row.entry.sourceLicense && (
                      <span className="bg-models-list__meta">
                        License: {row.entry.sourceLicense}
                      </span>
                    )}

                    {(row.entry.source || row.entry.sourceLicense) && (
                      <span className="bg-models-list__meta">
                        {row.entry.source ? `Source: ${row.entry.source}` : ''}
                      </span>
                    )}

                    {isDownloading && progress && (
                      <div
                        className="insp-progress-bar"
                        role="progressbar"
                        aria-valuenow={progressPercent}
                        aria-valuemin={0}
                        aria-valuemax={100}
                        aria-label={`Downloading ${row.entry.name}: ${progressPercent}%`}
                      >
                        <div
                          className="insp-progress-bar__fill"
                          style={{ width: `${progressPercent}%` }}
                        />
                      </div>
                    )}

                    {isDownloading && progress && progress.speedBytesPerSec > 0 && (
                      <span className="bg-models-list__meta">
                        {formatSize(progress.loaded)} / {formatSize(progress.total)}
                        {' · '}
                        {formatSpeed(progress.speedBytesPerSec)}
                        {progress.estimatedRemainingMs > 0 &&
                          ` · ~${formatDuration(progress.estimatedRemainingMs)} remaining`}
                      </span>
                    )}
                  </div>

                  <div className="bg-models-list__actions">
                    {row.entry.bundled && <span className="bg-models-list__meta">Ready</span>}

                    {!row.entry.bundled && isReady && (
                      <Button
                        variant="ghost"
                        onClick={() => void handleDelete(row.entry.id)}
                        disabled={busyId === row.entry.id}
                        aria-label={`Remove ${row.entry.name}`}
                      >
                        {busyId === row.entry.id ? 'Removing...' : 'Remove'}
                      </Button>
                    )}

                    {!row.entry.bundled && isDownloading && (
                      <Button
                        variant="ghost"
                        onClick={() => handleCancel(row.entry.id)}
                        aria-label={`Cancel downloading ${row.entry.name}`}
                      >
                        Cancel
                      </Button>
                    )}

                    {!row.entry.bundled && !isReady && !isDownloading && canDownload && (
                      <Button
                        variant="primary"
                        onClick={() => void handleDownload(row.entry.id)}
                        disabled={busyId === row.entry.id}
                        aria-label={`Download ${row.entry.name} (${formatSize(row.entry.sizeBytes)})`}
                      >
                        {busyId === row.entry.id ? 'Starting...' : 'Download'}
                      </Button>
                    )}

                    {!row.entry.bundled && !isReady && !isDownloading && !canDownload && (
                      <span
                        className="bg-models-list__meta"
                        title={
                          row.availabilityReason ??
                          (row.entry.checksum ? 'Download not available' : 'No integrity checksum')
                        }
                      >
                        {row.availabilityReason ??
                          (row.entry.checksum ? 'Unavailable' : 'No checksum')}
                      </span>
                    )}

                    {row.memoryWarning && (
                      <span className="bg-models-list__meta bg-models-list__warning">
                        <Icon name="TriangleAlert" size={12} label="Warning" /> {row.memoryWarning}
                      </span>
                    )}
                  </div>
                </li>
              );
            })}
          </ul>
        </div>
      ))}
    </div>
  );
}

function createDiagnosticsEntries(caps: RuntimeCapabilities): string[] {
  const entries: string[] = [];

  entries.push(`Environment: ${caps.label}`);
  entries.push(`OS: ${caps.os ?? 'unknown'}`);
  entries.push(
    `CPU: ${caps.cpuArch ?? 'unknown'} · ${caps.logicalProcessors ?? '?'} logical cores`,
  );
  entries.push(
    `Memory: ~${caps.approximateMemoryMB ? Math.round(caps.approximateMemoryMB / 1024) : '?'} GB`,
  );

  if (caps.hasWebGPU) entries.push('WebGPU: available');
  if (caps.hasWebGL) entries.push('WebGL: available');
  if (caps.sharedMemoryAvailable) entries.push('SharedArrayBuffer: available');
  if (caps.crossOriginIsolated) entries.push('Cross-origin isolated: yes');
  if (caps.isTauri) entries.push('Tauri native runtime');
  if (caps.isWebKitGTK) entries.push('WebKitGTK detected');

  entries.push(`ONNX providers: ${caps.preferredOnnxProviders.join(', ')}`);
  entries.push(`WASM safe model size: ${formatSize(caps.wasmSafeModelBytes)}`);
  if (caps.memoryTier) entries.push(`Memory tier: ${caps.memoryTier}`);
  if (caps.webgpuDeviceLost) entries.push('WebGPU: device lost (fallback active)');
  entries.push(`Network: ${caps.networkType ?? 'unknown'}`);

  return entries;
}
