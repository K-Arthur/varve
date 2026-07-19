/**
 * Settings tab — offline AI models for background removal and image upscaling (ADR-0005).
 */

import {
  AVAILABLE_MODELS,
  getModelLoaderReady,
  type RemovalMethod,
  UPSCALE_MODELS,
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

export function BgRemovalModelsTab() {
  const [rows, setRows] = useState<InstalledModelRow[]>([]);
  const [upscaleRows, setUpscaleRows] = useState<InstalledModelRow[]>([]);
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
      const list = await loader.listInstalledModels();
      setRows(
        list.map((row) => {
          const metadata = AVAILABLE_MODELS.find((model) => model.id === row.id);
          return {
            ...row,
            downloadable: Boolean(metadata?.remoteUrl && metadata.checksum),
          };
        }),
      );

      const upscaleStatus: InstalledModelRow[] = [];
      for (const model of UPSCALE_MODELS) {
        const installed = await loader.isModelAvailable(model.id);
        upscaleStatus.push({
          id: model.id,
          name: model.name,
          size: model.size,
          installed,
          source: installed ? (model.bundled ? 'bundled' : 'downloaded') : 'none',
          downloadable: Boolean(model.remoteUrl),
        });
      }
      setUpscaleRows(upscaleStatus);
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

  return (
    <div className="settings-section">
      <h3 className="settings-section__title">Background Removal Models</h3>
      <p className="settings-section__hint">
        AI models run locally on your device. Downloads require explicit consent and are stored in{' '}
        {storageLabel()}. Quick mode works without any download.
      </p>

      {bundleStatus === 'corrupt' && (
        <p className="bg-models-list__bundle-warning" role="alert">
          Bundled starter model (U^2-Net Light) failed integrity check. Reinstall the app or
          download models manually below.
        </p>
      )}

      <RegionLoader label="Loading model status" loading={loading}>
        <ul className="bg-models-list" aria-label="Installed background removal models">
          {rows.map((row) => {
            const meta = AVAILABLE_MODELS.find((m) => m.id === row.id);
            return (
              <li key={row.id} className="bg-models-list__row">
                <div className="bg-models-list__info">
                  <span className="bg-models-list__name">{row.name}</span>
                  <span className="bg-models-list__meta">
                    {formatMb(row.size)}
                    {row.installed
                      ? row.source === 'bundled'
                        ? ' — bundled with app'
                        : ' — downloaded'
                      : ' — not installed'}
                  </span>
                  {meta?.description && (
                    <span className="bg-models-list__desc">{meta.description}</span>
                  )}
                </div>
                <div className="bg-models-list__actions">
                  {row.installed && row.source === 'downloaded' && (
                    <Button
                      variant="ghost"
                      onClick={() => void handleDelete(row.id)}
                      disabled={busyId === row.id}
                      aria-label={`Delete ${row.name} model`}
                    >
                      {busyId === row.id ? 'Removing...' : 'Delete'}
                    </Button>
                  )}
                  {!row.installed && row.downloadable && (
                    <Button
                      variant="primary"
                      onClick={() => setDownloadModelId(row.id)}
                      aria-label={`Download ${row.name} model`}
                    >
                      Download
                    </Button>
                  )}
                  {!row.installed && !row.downloadable && (
                    <span className="bg-models-list__meta">Unavailable</span>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      </RegionLoader>

      <p className="settings-section__hint">
        AI Balanced prefers {AVAILABLE_MODELS.find((m) => m.id === 'isnet-general-use')?.name} and
        automatically falls back to {AVAILABLE_MODELS.find((m) => m.id === 'u2netp')?.name} on
        lower-memory systems. AI High Quality uses{' '}
        {AVAILABLE_MODELS.find((m) => m.id === 'birefnet-general-lite')?.name}.
      </p>

      <h3 className="settings-section__title">Image Upscaling Models</h3>
      <p className="settings-section__hint">
        Real-ESRGAN runs locally in a worker and is bundled for browser and desktop use.
      </p>
      <ul className="bg-models-list" aria-label="Image upscaling models">
        {upscaleRows.map((row) => {
          const meta = UPSCALE_MODELS.find((m) => m.id === row.id);
          return (
            <li key={row.id} className="bg-models-list__row">
              <div className="bg-models-list__info">
                <span className="bg-models-list__name">{row.name}</span>
                <span className="bg-models-list__meta">
                  {formatMb(row.size)}
                  {row.installed
                    ? row.source === 'bundled'
                      ? ' — bundled with app'
                      : ' — downloaded'
                    : ' — not installed'}
                </span>
                {meta?.description && (
                  <span className="bg-models-list__desc">{meta.description}</span>
                )}
              </div>
              <div className="bg-models-list__actions">
                {row.installed && row.source === 'downloaded' && (
                  <Button
                    variant="ghost"
                    onClick={() => void handleDelete(row.id)}
                    disabled={busyId === row.id}
                    aria-label={`Delete ${row.name} model`}
                  >
                    {busyId === row.id ? 'Removing...' : 'Delete'}
                  </Button>
                )}
                {!row.installed && row.downloadable && (
                  <Button
                    variant="primary"
                    onClick={() => setDownloadModelId(row.id)}
                    aria-label={`Download ${row.name} model`}
                  >
                    Download
                  </Button>
                )}
                {!row.installed && !row.downloadable && (
                  <span className="bg-models-list__meta">Unavailable</span>
                )}
              </div>
            </li>
          );
        })}
      </ul>

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
