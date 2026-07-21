/**
 * Settings tab — all offline AI models (ADR-0005 unified catalog).
 *
 * Shows models from every category (segmentation, upscaling, denoising, depth,
 * interactive segmentation) in grouped sections with download/delete controls.
 */

import {
  getModelLoaderReady,
  listAllModels,
  type RemovalMethod,
  workerModelIdForMethod,
} from '@strata/engine';
import { Button, RegionLoader } from '@strata/ui';
import { useCallback, useEffect, useState } from 'react';
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
  const results: InstalledModelRow[] = [];

  for (const model of catalog) {
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
      downloadable: Boolean(model.remoteUrl && model.checksum) || !model.bundled,
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

  const handleDelete = async (id: string) => {
    setBusyId(id);
    try {
      const loader = await getModelLoaderReady();
      await loader.deleteModel(id);
      await refresh();
    } finally {
      setBusyId(null);
    }
  };

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
                  </div>
                  <div className="bg-models-list__actions">
                    {row.installed && row.source === 'downloaded' && (
                      <Button
                        variant="ghost"
                        onClick={() => void handleDelete(row.id)}
                        disabled={busyId === row.id}
                        aria-label={`Remove ${row.name} model`}
                      >
                        {busyId === row.id ? 'Removing...' : 'Remove'}
                      </Button>
                    )}
                    {!row.installed && row.downloadable && (
                      <Button
                        variant="primary"
                        onClick={() => setDownloadModelId(row.id)}
                        aria-label={`Download ${row.name} model`}
                      >
                        {row.source === 'bundled' ? 'Verify' : 'Download'}
                      </Button>
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
