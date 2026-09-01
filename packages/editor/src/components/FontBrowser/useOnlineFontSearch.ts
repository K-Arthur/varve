import type { FontProviderResult } from '@varve/engine/font';
import {
  type CatalogSearchResult,
  type FontArtifactDescriptor,
  FontDownloadManager,
  FontLoader,
  getFontsourceCatalog,
} from '@varve/engine/font';
import { useCallback, useMemo, useSyncExternalStore } from 'react';
import { isCapabilityRestricted } from '../../capabilities/restrictions';
import { storeFont } from './fontStorage';

export interface OnlineFontSearchResult {
  results: FontProviderResult[];
  loading: boolean;
  error: string | null;
  provider: string;
}

const EMPTY_RESULTS: FontProviderResult[] = [];

function toProviderResult(item: CatalogSearchResult): FontProviderResult {
  return {
    providerId: item.providerId,
    familyId: item.familyId,
    familyName: item.familyName,
    category: item.category,
    variants: item.weights.length * item.styles.length,
    isVariable: item.variable,
    languages: item.subsets,
    packageVersion: item.packageVersion,
    weights: item.weights,
    styles: item.styles,
  };
}

/**
 * Search the shipped Fontsource catalog. The historical hook name is kept as
 * a compatibility seam for mounted selectors, but this path is synchronous,
 * local, and never performs a provider request.
 */
export function useOnlineFontSearch(query: string): {
  googleFonts: OnlineFontSearchResult;
  fontsource: OnlineFontSearchResult;
} {
  const catalog = getFontsourceCatalog();
  const subscribe = useCallback((listener: () => void) => catalog.subscribe(listener), [catalog]);
  const getRevision = useCallback(() => catalog.revision, [catalog]);
  const revision = useSyncExternalStore(subscribe, getRevision, getRevision);
  const results = useMemo(() => {
    if (query.trim().length < 2) return EMPTY_RESULTS;
    return catalog.search({ query, limit: 24 }).map(toProviderResult);
  }, [catalog, query, revision]);

  return {
    googleFonts: {
      results: EMPTY_RESULTS,
      loading: false,
      error: null,
      provider: 'Legacy provider disabled',
    },
    fontsource: {
      results,
      loading: false,
      error: null,
      provider: 'Fontsource catalog',
    },
  };
}

let globalDownloadManager: FontDownloadManager | null = null;
const pendingDownloadWaiters = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void; artifact: FontArtifactDescriptor }
>();

function getDownloadManager(): FontDownloadManager {
  if (!globalDownloadManager) {
    globalDownloadManager = new FontDownloadManager(
      { maxConcurrent: 2, maxFileSize: 10 * 1024 * 1024 },
      {
        onJobComplete: async (job) => {
          const waiter = pendingDownloadWaiters.get(job.id);
          try {
            if (!waiter?.artifact || !job.metadata || !job.data) {
              throw new Error('The downloaded font did not contain usable font data.');
            }
            const artifact = waiter.artifact;
            await storeFont(job.familyName, job.data, {
              providerId: artifact.providerId,
              familyId: artifact.familyId,
              packageVersion: artifact.packageVersion,
              upstreamVersion: artifact.upstreamVersion,
              weight: artifact.weight,
              style: artifact.style,
              subset: artifact.subset,
              variable: artifact.variable,
              axes: artifact.axes,
              postScriptName: job.metadata.identity.postScriptName,
              license: artifact.license.name,
              licenseUrl: artifact.license.url,
            });
            const result = await new FontLoader(undefined).loadFont(job.metadata, job.data);
            if (!result.success) throw new Error('The font was saved but could not be registered.');
            getFontsourceCatalog().setInstalled(artifact.familyId, true);
            waiter.resolve();
          } catch (error) {
            waiter?.reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            pendingDownloadWaiters.delete(job.id);
          }
        },
        onJobFailed: (job) => {
          pendingDownloadWaiters.get(job.id)?.reject(new Error(userFacingDownloadError(job.error)));
          pendingDownloadWaiters.delete(job.id);
        },
        onJobCancelled: (job) => {
          pendingDownloadWaiters.get(job.id)?.reject(new Error('Font download cancelled.'));
          pendingDownloadWaiters.delete(job.id);
        },
      },
    );
  }
  return globalDownloadManager;
}

function userFacingDownloadError(error?: string): string {
  const detail = error?.toLowerCase() ?? '';
  if (
    detail.includes('failed to fetch') ||
    detail.includes('network') ||
    detail.includes('offline')
  ) {
    return 'Connect to the internet to download this font.';
  }
  if (detail.includes('too large')) return 'The downloaded font is too large to install.';
  if (detail.includes('format') || detail.includes('signature')) {
    return 'The downloaded file was not a valid supported font. The previous font was retained.';
  }
  return 'This font could not be installed. The previous font was retained.';
}

/** Download one explicit, version-pinned Fontsource artifact and install it. */
export async function downloadAndApplyOnlineFont(
  familyName: string,
  providerId: string,
  familyId = familyName,
  request: {
    weight?: number;
    style?: 'normal' | 'italic';
    subset?: string;
    variable?: boolean;
  } = {},
): Promise<void> {
  if (providerId !== 'fontsource')
    throw new Error('Only the local Fontsource catalog can install fonts.');
  if (isCapabilityRestricted('onlineFonts')) {
    throw new Error(
      'Font search is available offline, but downloading additional fonts is disabled in this demo.',
    );
  }
  const artifact = getFontsourceCatalog().resolve({ familyId, ...request });
  const job = getDownloadManager().addJob(artifact.url, familyName, artifact.format, {
    providerId: artifact.providerId,
    familyId: artifact.familyId,
    packageVersion: artifact.packageVersion,
  });
  await new Promise<void>((resolve, reject) => {
    pendingDownloadWaiters.set(job.id, { resolve, reject, artifact });
  });
}
