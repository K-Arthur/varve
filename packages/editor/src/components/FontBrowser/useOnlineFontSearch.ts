import { getFontRegistry } from '@varve/engine';
import type { FontProviderResult } from '@varve/engine/font';
import {
  FontDownloadManager,
  FontLoader,
  FontProviderRegistry,
  FontsourceProvider,
  GoogleFontsProvider,
} from '@varve/engine/font';
import { useCallback, useEffect, useRef, useState } from 'react';
import { isCapabilityRestricted } from '../../capabilities/restrictions';
import { storeFont } from './fontStorage';

export interface OnlineFontSearchResult {
  results: FontProviderResult[];
  loading: boolean;
  error: string | null;
  provider: string;
}

let globalProviderRegistry: FontProviderRegistry | null = null;

function getProviderRegistry(): FontProviderRegistry {
  if (!globalProviderRegistry) {
    globalProviderRegistry = new FontProviderRegistry();
    // Google's metadata endpoint requires a configured key. Keep the provider
    // honest in the demo and in unconfigured desktop builds instead of
    // presenting a clickable section that can only show "Failed to fetch".
    const runtimeConfig = globalThis as typeof globalThis & {
      __VARVE_FONT_CONFIG__?: { googleApiKey?: string };
    };
    const googleApiKey = runtimeConfig.__VARVE_FONT_CONFIG__?.googleApiKey?.trim() ?? '';
    const google = new GoogleFontsProvider(googleApiKey || undefined);
    google.enabled = Boolean(googleApiKey);
    globalProviderRegistry.register(google);
    const fontsource = new FontsourceProvider();
    fontsource.enabled = !isCapabilityRestricted('onlineFonts');
    globalProviderRegistry.register(fontsource);
  }
  return globalProviderRegistry;
}

let globalDownloadManager: FontDownloadManager | null = null;
const pendingDownloadWaiters = new Map<
  string,
  { resolve: () => void; reject: (error: Error) => void }
>();

function getDownloadManager(): FontDownloadManager {
  if (!globalDownloadManager) {
    const registry = getFontRegistry();
    globalDownloadManager = new FontDownloadManager(
      { maxConcurrent: 2, maxFileSize: 10 * 1024 * 1024 },
      {
        onJobComplete: async (job) => {
          const waiter = pendingDownloadWaiters.get(job.id);
          try {
            if (!job.metadata || !job.data) throw new Error('Font download returned no font data.');
            const fontLoader = new FontLoader(undefined, registry);
            const result = await fontLoader.loadFont(job.metadata, job.data);
            if (!result.success) throw new Error(result.error ?? 'Font could not be registered.');
            await storeFont(job.familyName, job.data, {
              providerId: job.url.includes('googleapis') ? 'google-fonts' : 'fontsource',
            });
            waiter?.resolve();
          } catch (error) {
            waiter?.reject(error instanceof Error ? error : new Error(String(error)));
          } finally {
            pendingDownloadWaiters.delete(job.id);
          }
        },
        onJobFailed: (job) => {
          pendingDownloadWaiters
            .get(job.id)
            ?.reject(new Error(job.error ?? 'Font download failed.'));
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

export function useOnlineFontSearch(query: string): {
  googleFonts: OnlineFontSearchResult;
  fontsource: OnlineFontSearchResult;
} {
  const [googleResults, setGoogleResults] = useState<FontProviderResult[]>([]);
  const [googleLoading, setGoogleLoading] = useState(false);
  const [googleError, setGoogleError] = useState<string | null>(null);

  const [fontsourceResults, setFontsourceResults] = useState<FontProviderResult[]>([]);
  const [fontsourceLoading, setFontsourceLoading] = useState(false);
  const [fontsourceError, setFontsourceError] = useState<string | null>(null);

  const debounceRef = useRef<ReturnType<typeof setTimeout>>(undefined);
  const requestIdRef = useRef(0);

  const search = useCallback(async (q: string) => {
    const registry = getProviderRegistry();
    const norm = q.toLowerCase().trim();
    const requestId = ++requestIdRef.current;

    setGoogleLoading(true);
    setGoogleError(null);
    setFontsourceLoading(true);
    setFontsourceError(null);

    const searchProvider = async (id: string) => {
      const provider = registry.get(id);
      if (!provider?.enabled) return { id, results: [], error: null };
      try {
        return { id, results: await provider.search(norm, { limit: 12 }), error: null };
      } catch (err) {
        return {
          id,
          results: [],
          error: err instanceof Error ? err.message : 'Provider unavailable',
        };
      }
    };

    const results = await Promise.all([
      searchProvider('google-fonts'),
      searchProvider('fontsource'),
    ]);
    if (requestId !== requestIdRef.current) return;
    for (const result of results) {
      const isGoogle = result.id === 'google-fonts';
      const provider = registry.get(result.id);
      const error = result.error
        ? result.error.includes('Failed to fetch')
          ? 'Online search is unavailable in this environment.'
          : result.error
        : !provider?.enabled
          ? isCapabilityRestricted('onlineFonts')
            ? 'Online fonts are unavailable in this demo.'
            : isGoogle
              ? 'Google Fonts search is not configured.'
              : 'Online font search is unavailable.'
          : null;
      if (isGoogle) {
        setGoogleResults(result.results);
        setGoogleError(error);
        setGoogleLoading(false);
      } else {
        setFontsourceResults(result.results);
        setFontsourceError(error);
        setFontsourceLoading(false);
      }
    }
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      requestIdRef.current += 1;
      setGoogleResults([]);
      setGoogleLoading(false);
      setGoogleError(null);
      setFontsourceResults([]);
      setFontsourceLoading(false);
      setFontsourceError(null);
      return;
    }
    debounceRef.current = setTimeout(() => void search(trimmed), 300);
    return () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    };
  }, [query, search]);

  return {
    googleFonts: {
      results: googleResults,
      loading: googleLoading,
      error: googleError,
      provider: 'Google Fonts',
    },
    fontsource: {
      results: fontsourceResults,
      loading: fontsourceLoading,
      error: fontsourceError,
      provider: 'Fontsource',
    },
  };
}

export async function downloadAndApplyOnlineFont(
  familyName: string,
  providerId: string,
): Promise<void> {
  const provider = getProviderRegistry().get(providerId);
  if (!provider) throw new Error(`Provider "${providerId}" not found`);

  const urls = await provider.getDownloadUrls(familyName, 'woff2');
  if (urls.length === 0) throw new Error(`No download URLs for "${familyName}"`);

  const dm = getDownloadManager();
  const job = dm.addJob(urls[0]!.url, familyName, 'woff2');
  await new Promise<void>((resolve, reject) => {
    pendingDownloadWaiters.set(job.id, { resolve, reject });
  });
}
