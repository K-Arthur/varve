import type { ModelAcquisition } from '@varve/engine';
import { getModelLoaderReady, listAllModels, resolveAcquisition } from '@varve/engine';
import { Button, RegionLoader } from '@varve/ui';
import { useCallback, useEffect, useState } from 'react';
import { modelRequirementLabel } from '../../modelRequirements';
import { ModelDownloadDialog } from '../BackgroundRemoval/ModelDownloadDialog';

interface ModelRow {
  id: string;
  name: string;
  size: number;
  peakMemoryBytes?: number;
  installed: boolean;
  source: 'bundled' | 'downloaded' | 'none';
  acquisition: ModelAcquisition;
  description?: string;
}

async function buildRows(
  loader: Awaited<ReturnType<typeof getModelLoaderReady>>,
): Promise<ModelRow[]> {
  const catalog = listAllModels().filter((m) => m.id === 'ddcolor' || m.id === 'ddcolor-tiny');
  const results: ModelRow[] = [];
  for (const model of catalog) {
    const installed = await loader.isModelAvailable(model.id);
    results.push({
      id: model.id,
      name: model.name,
      size: model.sizeBytes,
      peakMemoryBytes: model.peakMemoryBytes,
      installed,
      source: model.bundled
        ? 'bundled'
        : (await loader.hasDownloadedBlob?.(model.id))
          ? 'downloaded'
          : 'none',
      acquisition: resolveAcquisition(model),
      description: model.description,
    });
  }
  return results;
}

export function ColorizationModelsTab() {
  const [rows, setRows] = useState<ModelRow[]>([]);
  const [loading, setLoading] = useState(true);
  const [downloadModelId, setDownloadModelId] = useState<string | null>(null);
  const [busyId, setBusyId] = useState<string | null>(null);

  const refresh = useCallback(async () => {
    setLoading(true);
    try {
      const loader = await getModelLoaderReady();
      setRows(await buildRows(loader));
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void refresh();
    void getModelLoaderReady().then((l) =>
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
    <div className="colorization-models-section">
      <h3 className="colorization-models-section__title">Colorization Models</h3>
      <p className="colorization-models-section__hint">
        DDColor models propose plausible colors for grayscale photos. They are optional downloads
        (Apache-2.0 licensed) and process locally once a model is verified. Tint, palette, mask, and
        reference workflows do not need a model; line-art colorization is a separate, currently
        deferred workflow.
      </p>
      <RegionLoader label="Loading model status" loading={loading}>
        <ul className="bg-models-list" aria-label="Colorization models">
          {rows.map((row) => (
            <li key={row.id} className="bg-models-list__row">
              <div className="bg-models-list__info">
                <span className="bg-models-list__name">{row.name}</span>
                <span className="bg-models-list__meta">
                  {modelRequirementLabel(row.size, row.peakMemoryBytes)}
                  {row.installed
                    ? row.source === 'bundled'
                      ? ' — bundled'
                      : ' — installed'
                    : ' — not installed'}
                </span>
                {row.description && <span className="bg-models-list__desc">{row.description}</span>}
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
                {!row.installed && row.acquisition.kind === 'remote' && (
                  <Button
                    variant="default"
                    onClick={() => setDownloadModelId(row.id)}
                    aria-label={`Download ${row.name} model`}
                  >
                    Download
                  </Button>
                )}
                {!row.installed && row.acquisition.kind === 'generated' && (
                  <span className="bg-models-list__meta">
                    Build from source — see tools/ddcolor-export/
                  </span>
                )}
                {!row.installed && row.acquisition.kind === 'unavailable' && (
                  <span className="bg-models-list__meta">{row.acquisition.detail}</span>
                )}
              </div>
            </li>
          ))}
        </ul>
        {rows.length === 0 && !loading && (
          <p className="colorization-models-section__hint">
            No colorization models found in the catalog.
          </p>
        )}
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
