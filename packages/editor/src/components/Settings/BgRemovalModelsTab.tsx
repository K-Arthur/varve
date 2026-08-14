/**
 * Settings tab — all offline AI models (ADR-0005 unified catalog).
 *
 * Shows models from every category (segmentation, upscaling, denoising, depth,
 * interactive segmentation) in grouped sections with download/delete controls.
 */

import {
  deriveAcquisition,
  getModelLoaderReady,
  listAllModels,
  type RemovalMethod,
  workerModelIdForMethod,
} from '@varve/engine';
import { Button, RegionLoader } from '@varve/ui';
import { useCallback, useEffect, useRef, useState } from 'react';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';

interface InstalledModelRow {
  id: string;
  name: string;
  size: number;
  installed: boolean;
  source: 'bundled' | 'downloaded' | 'none';
  downloadable: boolean;
  description?: string;
  precision?: 'fp32' | 'int8';
  isQuantized: boolean;
  /** Present for multi-file models (e.g. SAM2's separate encoder + decoder
   * graphs) — download/delete acts on every id in this list as one unit
   * instead of showing each part as its own row. */
  componentIds?: string[];
}

function formatMb(bytes: number): string {
  return `~${Math.round(bytes / 1_000_000)} MB`;
}

function storageLabel(): string {
  if (typeof indexedDB !== 'undefined') {
    return 'IndexedDB on this device (browser / desktop webview)';
  }
  return 'Local storage unavailable in this environment';
}

async function buildRows(
  loader: Awaited<ReturnType<typeof getModelLoaderReady>>,
): Promise<InstalledModelRow[]> {
  const catalog = listAllModels();
  // Component ids (e.g. SAM2's encoder/decoder) are downloadable individually
  // by the tools that use them, but shouldn't also show as their own rows
  // here — their parent multiComponent entry represents them as one unit.
  const hiddenComponentIds = new Set(catalog.flatMap((m) => m.components?.map((c) => c.id) ?? []));
  // Semantic-search models (SigLIP image/text towers + tokenizer) are
  // managed by the dedicated SemanticSearchTab.
  const catalogFiltered = catalog.filter((m) => m.category !== 'embedding');
  const results: InstalledModelRow[] = [];

  for (const model of catalogFiltered) {
    if (hiddenComponentIds.has(model.id)) continue;

    if (model.multiComponent && model.components && model.components.length > 0) {
      const componentAvailability = await Promise.all(
        model.components.map((c) => loader.isModelAvailable(c.id)),
      );
      results.push({
        id: model.id,
        name: model.name,
        size: model.components.reduce((sum, c) => sum + c.sizeBytes, 0),
        installed: componentAvailability.every(Boolean),
        source: componentAvailability.some(Boolean) ? 'downloaded' : 'none',
        downloadable: model.components.every((c) => Boolean(c.remoteUrl)),
        description: model.description,
        precision: model.precision as 'fp32' | 'int8' | undefined,
        isQuantized: model.precision === 'int8',
        componentIds: model.components.map((c) => c.id),
      });
      continue;
    }

    const installed = await loader.isModelAvailable(model.id);
    results.push({
      id: model.id,
      name: model.name,
      size: model.sizeBytes,
      installed,
      source: model.bundled
        ? 'bundled'
        : (await loader.hasDownloadedBlob?.(model.id))
          ? 'downloaded'
          : 'none',
      downloadable: deriveAcquisition(model).kind === 'remote',
      description: model.description,
      precision: model.precision as 'fp32' | 'int8' | undefined,
      isQuantized: model.precision === 'int8',
    });
  }

  return results;
}

const CATEGORY_LABELS: Record<string, string> = {
  segmentation: 'Background Removal',
  upscaling: 'Image Upscaling',
  denoising: 'AI Denoising',
  depth: 'Depth Estimation',
  classification: 'Classification',
  detection: 'Object Detection',
  ocr: 'Text Recognition',
  other: 'Other',
};

export function BgRemovalModelsTab() {
  const [allRows, setAllRows] = useState<InstalledModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);
  const [compositeDownload, setCompositeDownload] = useState<{
    id: string;
    progress: number;
  } | null>(null);
  const [compositeError, setCompositeError] = useState<string | null>(null);
  const compositeAbortRef = useRef<AbortController | null>(null);
  const [bundleStatus, setBundleStatus] = useState<'unknown' | 'verified' | 'corrupt' | 'skipped'>(
    'unknown',
  );

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loader = await getModelLoaderReady();
      const verify = await loader.verifyBundledModel('u2netp');
      setBundleStatus(verify);
      const rows = await buildRows(loader);
      setAllRows(rows);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    const loader = getModelLoaderReady();
    void loader.then((l) =>
      l.subscribe(() => {
        void refresh();
      }),
    );
  }, [refresh]);

  const handleDelete = async (row: InstalledModelRow) => {
    setBusyId(row.id);
    try {
      const loader = await getModelLoaderReady();
      for (const id of row.componentIds ?? [row.id]) {
        await loader.deleteModel(id);
      }
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

  const handleCompositeDownload = useCallback(
    async (row: InstalledModelRow) => {
      const componentIds = row.componentIds;
      if (!componentIds || componentIds.length === 0) return;
      setCompositeError(null);
      setCompositeDownload({ id: row.id, progress: 0 });
      const controller = new AbortController();
      compositeAbortRef.current = controller;
      const loaded = new Map<string, number>();
      const totals = new Map<string, number>();
      try {
        const loader = await getModelLoaderReady();
        for (const id of componentIds) {
          await loader.downloadModel(
            id,
            (partLoaded, partTotal) => {
              loaded.set(id, partLoaded);
              totals.set(id, partTotal);
              const sumLoaded = [...loaded.values()].reduce((a, b) => a + b, 0);
              const sumTotal = [...totals.values()].reduce((a, b) => a + b, 0);
              setCompositeDownload({
                id: row.id,
                progress: sumTotal > 0 ? Math.round((sumLoaded / sumTotal) * 100) : 0,
              });
            },
            controller.signal,
          );
        }
        await refresh();
      } catch (err) {
        if (!controller.signal.aborted) {
          setCompositeError(err instanceof Error ? err.message : 'Download failed');
        }
      } finally {
        setCompositeDownload(null);
        compositeAbortRef.current = null;
      }
    },
    [refresh],
  );

  const handleCompositeCancel = useCallback(() => {
    compositeAbortRef.current?.abort();
  }, []);

  // Group rows by category
  const categories = new Map<string, InstalledModelRow[]>();
  for (const row of allRows) {
    const cat = listAllModels().find((m) => m.id === row.id)?.category ?? 'other';
    if (!categories.has(cat)) categories.set(cat, []);
    categories.get(cat)!.push(row);
  }

  return (
    <div className="settings-section">
      <p className="settings-section__hint">
        All AI models run locally on your device. Downloads require explicit consent and are stored
        in {storageLabel()}. Bundled models ship with the app and need no download.
      </p>

      {bundleStatus === 'corrupt' && (
        <p className="bg-models-list__bundle-warning" role="alert">
          Bundled starter model (U&sup2;-Net Light) failed integrity check. Reinstall the app or
          download models manually below.
        </p>
      )}

      <RegionLoader label="Loading model status" loading={loading}>
        {Array.from(categories.entries()).map(([catId, rows]) => (
          <div key={catId}>
            <h3 className="settings-section__title">{CATEGORY_LABELS[catId] ?? catId}</h3>
            <ul className="bg-models-list" aria-label={`${CATEGORY_LABELS[catId] ?? catId} models`}>
              {rows.map((row) => (
                <li key={row.id} className="bg-models-list__row">
                  <div className="bg-models-list__info">
                    <span className="bg-models-list__name">
                      {row.name}
                      {row.isQuantized && <span className="bg-models-list__badge">INT8</span>}
                    </span>
                    <span className="bg-models-list__meta">
                      {formatMb(row.size)}
                      {row.installed
                        ? row.source === 'bundled'
                          ? ' — bundled'
                          : ' — installed'
                        : ' — not installed'}
                      {row.precision === 'int8' && ' (quantized)'}
                    </span>
                    {row.description && (
                      <span className="bg-models-list__desc">{row.description}</span>
                    )}
                    {compositeDownload?.id === row.id && (
                      <div
                        className="insp-progress-bar"
                        role="progressbar"
                        aria-valuenow={compositeDownload.progress}
                        aria-valuemin={0}
                        aria-valuemax={100}
                      >
                        <div
                          className="insp-progress-bar__fill"
                          style={{ width: `${compositeDownload.progress}%` }}
                        />
                      </div>
                    )}
                    {compositeError && row.id === compositeDownload?.id && (
                      <span className="bg-models-list__meta" role="alert">
                        {compositeError}
                      </span>
                    )}
                  </div>
                  <div className="bg-models-list__actions">
                    {row.installed && row.source === 'downloaded' && (
                      <Button
                        variant="ghost"
                        onClick={() => void handleDelete(row)}
                        disabled={busyId === row.id}
                        aria-label={`Remove ${row.name} model`}
                      >
                        {busyId === row.id ? 'Removing...' : 'Remove'}
                      </Button>
                    )}
                    {!row.installed && row.downloadable && row.componentIds ? (
                      compositeDownload?.id === row.id ? (
                        <Button
                          variant="ghost"
                          onClick={handleCompositeCancel}
                          aria-label={`Cancel ${row.name} download`}
                        >
                          Cancel
                        </Button>
                      ) : (
                        <Button
                          variant="primary"
                          onClick={() => void handleCompositeDownload(row)}
                          aria-label={`Download ${row.name} model (${row.componentIds.length} parts)`}
                        >
                          Download
                        </Button>
                      )
                    ) : (
                      !row.installed &&
                      row.downloadable && (
                        <Button
                          variant="primary"
                          onClick={() => setDownloadModelId(row.id)}
                          aria-label={`Download ${row.name} model`}
                        >
                          {row.source === 'bundled' ? 'Verify' : 'Download'}
                        </Button>
                      )
                    )}
                    {!row.installed && !row.downloadable && (
                      <span className="bg-models-list__meta">Unavailable</span>
                    )}
                  </div>
                </li>
              ))}
            </ul>
          </div>
        ))}
      </RegionLoader>

      {downloadModelId && (
        <ModelDownloadDialog
          modelId={downloadModelId}
          onClose={() => setDownloadModelId(null)}
          onComplete={() => {
            setDownloadModelId(null);
            void refresh();
          }}
        />
      )}
    </div>
  );
}

/** Model id required for a given removal method (for inspector gating). */
export function modelIdForRemovalMethod(method: RemovalMethod): string | null {
  return workerModelIdForMethod(method);
}
