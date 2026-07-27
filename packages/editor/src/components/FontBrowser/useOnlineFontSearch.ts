import { getFontRegistry } from '@strata/engine';
import type { FontProviderResult } from '@strata/engine/font';
import {
  FontDownloadManager,
  FontLoader,
  FontProviderRegistry,
  FontsourceProvider,
  GoogleFontsProvider,
} from '@strata/engine/font';
import { useCallback, useEffect, useRef, useState } from 'react';

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
    globalProviderRegistry.register(new GoogleFontsProvider());
    globalProviderRegistry.register(new FontsourceProvider());
  }
  return globalProviderRegistry;
}

let globalDownloadManager: FontDownloadManager | null = null;

function getDownloadManager(): FontDownloadManager {
  if (!globalDownloadManager) {
    const registry = getFontRegistry();
    globalDownloadManager = new FontDownloadManager(
      { maxConcurrent: 2, maxFileSize: 10 * 1024 * 1024 },
      {
        onJobComplete: (job) => {
          if (job.metadata && job.data) {
            const fontLoader = new FontLoader(undefined, registry);
            void fontLoader.loadFont(job.metadata, job.data);
          }
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

  const debounceRef = useRef<ReturnType<typeof setTimeout>>();

  const search = useCallback(async (q: string) => {
    const registry = getProviderRegistry();
    const norm = q.toLowerCase().trim();

    setGoogleLoading(true);
    setGoogleError(null);
    try {
      const gf = registry.get('google-fonts');
      if (gf?.enabled) {
        const results = await gf.search(norm, { limit: 12 });
        setGoogleResults(results);
      } else {
        setGoogleResults([]);
      }
    } catch (err) {
      setGoogleError(err instanceof Error ? err.message : 'Search failed');
      setGoogleResults([]);
    }
    setGoogleLoading(false);

    setFontsourceLoading(true);
    setFontsourceError(null);
    try {
      const fs = registry.get('fontsource');
      if (fs?.enabled) {
        const results = await fs.search(norm, { limit: 12 });
        setFontsourceResults(results);
      } else {
        setFontsourceResults([]);
      }
    } catch (err) {
      setFontsourceError(err instanceof Error ? err.message : 'Search failed');
      setFontsourceResults([]);
    }
    setFontsourceLoading(false);
  }, []);

  useEffect(() => {
    if (debounceRef.current) clearTimeout(debounceRef.current);
    const trimmed = query.trim();
    if (trimmed.length < 2) {
      setGoogleResults([]);
      setGoogleLoading(false);
      setGoogleError(null);
      setFontsourceResults([]);
      setFontsourceLoading(false);
      setFontsourceError(null);
      return;
    }
    debounceRef.current = setTimeout(() => search(trimmed), 300);
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
  dm.addJob(urls[0]!.url, familyName, 'woff2');
  dm.start();
}
