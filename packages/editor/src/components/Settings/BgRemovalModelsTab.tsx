/**
 * Settings tab — offline AI background-removal model storage (ADR-0005).
 * Surfaces download status, storage location, and delete controls per platform.
 */

import {
  AVAILABLE_MODELS,
  getModelLoaderReady,
  workerModelIdForMethod,
  type RemovalMethod,
} from '@strata/engine';
import { Button } from '@strata/ui';
import { useCallback, useEffect, useState } from 'react';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';

interface InstalledModelRow {
  id: string;
  name: string;
  size: number;
  installed: boolean;
  source: 'bundled' | 'downloaded' | 'none';
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
  const [loading, setLoading] = useState(true);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loader = await getModelLoaderReady();
      const list = await loader.listInstalledModels();
      setRows(list);
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

      {loading && <p className="settings-section__hint">Loading model status...</p>}

      {!loading && (
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
                  {!row.installed && (
                    <Button
                      variant="primary"
                      onClick={() => setDownloadModelId(row.id)}
                      aria-label={`Download ${row.name} model`}
                    >
                      Download
                    </Button>
                  )}
                </div>
              </li>
            );
          })}
        </ul>
      )}

      <p className="settings-section__hint">
        AI Balanced uses {AVAILABLE_MODELS.find((m) => m.id === 'birefnet-general-lite')?.name}.
        AI Best Quality uses {AVAILABLE_MODELS.find((m) => m.id === 'birefnet-general')?.name}.
      </p>

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
