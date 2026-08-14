/**
 * React bridge for SemanticAssetSearchService.
 *
 * Owns the service lifecycle, debounced natural-language queries with
 * stale-result suppression, model availability/download affordances, and
 * pause/resume on document visibility (background indexing must never
 * compete with foreground work).
 */
import { getModelLoader, SIGLIP_IMAGE_MODEL, SIGLIP_TEXT_MODEL_ID } from '@varve/engine';
import { type Asset, IndexedDbSemanticEmbeddingStore, type Platform } from '@varve/platform';
import { useCallback, useEffect, useMemo, useRef, useState } from 'react';
import {
  createSemanticAssetSearchService,
  type SemanticAssetSearchService,
  type SemanticSearchStatus,
} from './semanticAssetSearch';

export interface SemanticSearchHookResult {
  /** assetId -> 1-based semantic rank (null when lane unavailable). */
  semanticRanks: Map<string, number> | null;
  status: SemanticSearchStatus;
  /** True while a natural-language query is being encoded/ranked. */
  semanticBusy: boolean;
  downloadImageModel: () => Promise<void>;
  downloadTextModel: () => Promise<void>;
  downloadProgress: number | null;
  downloadingModelId: string | null;
}

const QUERY_DEBOUNCE_MS = 350;

export function useSemanticAssetSearch(
  platform: Platform,
  assets: readonly Asset[],
  query: string,
): SemanticSearchHookResult {
  const serviceRef = useRef<SemanticAssetSearchService | null>(null);
  const [status, setStatus] = useState<SemanticSearchStatus>({
    imageModelAvailable: false,
    textModelAvailable: false,
    indexedCount: 0,
    totalCount: 0,
    indexing: false,
    lastError: null,
  });
  const [semanticRanks, setSemanticRanks] = useState<Map<string, number> | null>(null);
  const [semanticBusy, setSemanticBusy] = useState(false);
  const [downloadProgress, setDownloadProgress] = useState<number | null>(null);
  const [downloadingModelId, setDownloadingModelId] = useState<string | null>(null);
  const assetsRef = useRef<readonly Asset[]>([]);
  assetsRef.current = assets;
  const service = useMemo(() => {
    if (typeof indexedDB === 'undefined') return null;
    return createSemanticAssetSearchService({
      store: new IndexedDbSemanticEmbeddingStore(),
      getAssetBytes: (id) => platform.getAssetBytes(id),
      isImageModelAvailable: () => getModelLoader().isModelAvailable(SIGLIP_IMAGE_MODEL.id),
      isTextModelAvailable: () => getModelLoader().isModelAvailable(SIGLIP_TEXT_MODEL_ID),
      getImageModelPath: (signal) => getModelLoader().getModelPath(SIGLIP_IMAGE_MODEL.id, signal),
      getTextModelPath: (signal) => getModelLoader().getModelPath(SIGLIP_TEXT_MODEL_ID, signal),
      onStatus: setStatus,
    });
  }, [platform]);
  serviceRef.current = service;

  useEffect(() => {
    const svc = service;
    if (!svc) return;
    void svc.start();
    const onVisibility = () => {
      if (document.hidden) svc.pause();
      else svc.resume();
    };
    document.addEventListener('visibilitychange', onVisibility);
    return () => {
      document.removeEventListener('visibilitychange', onVisibility);
    };
  }, [service]);

  useEffect(() => {
    const svc = service;
    if (!svc) return;
    void svc.sync(assets);
  }, [service, assets]);

  // Debounced semantic query with stale-result suppression.
  useEffect(() => {
    const svc = service;
    if (!svc) return;
    if (!query.trim() || query.trim().length < 2) {
      setSemanticRanks(null);
      setSemanticBusy(false);
      return;
    }
    const controller = new AbortController();
    const timer = setTimeout(() => {
      setSemanticBusy(true);
      void svc
        .search(query, controller.signal)
        .then((ranks) => {
          if (!controller.signal.aborted) {
            setSemanticRanks(ranks);
            setSemanticBusy(false);
          }
        })
        .catch(() => {
          if (!controller.signal.aborted) {
            setSemanticRanks(null);
            setSemanticBusy(false);
          }
        });
    }, QUERY_DEBOUNCE_MS);
    return () => {
      clearTimeout(timer);
      controller.abort();
    };
  }, [service, query]);

  const downloadImageModel = useCallback(async () => {
    const loader = getModelLoader();
    setDownloadingModelId(SIGLIP_IMAGE_MODEL.id);
    setDownloadProgress(0);
    try {
      await loader.downloadModel(SIGLIP_IMAGE_MODEL.id, (loaded, total) => {
        setDownloadProgress(total > 0 ? loaded / total : null);
      });
    } finally {
      setDownloadingModelId(null);
      setDownloadProgress(null);
      const svc = serviceRef.current;
      if (svc) {
        await svc.refreshModelAvailability();
        void svc.sync(assetsRef.current);
      }
    }
  }, []);

  const downloadTextModel = useCallback(async () => {
    const loader = getModelLoader();
    setDownloadingModelId(SIGLIP_TEXT_MODEL_ID);
    setDownloadProgress(0);
    try {
      await loader.downloadModel(SIGLIP_TEXT_MODEL_ID, (loaded, total) => {
        setDownloadProgress(total > 0 ? loaded / total : null);
      });
    } finally {
      setDownloadingModelId(null);
      setDownloadProgress(null);
      const svc = serviceRef.current;
      if (svc) await svc.refreshModelAvailability();
    }
  }, []);

  return {
    semanticRanks,
    status,
    semanticBusy,
    downloadImageModel,
    downloadTextModel,
    downloadProgress,
    downloadingModelId,
  };
}
