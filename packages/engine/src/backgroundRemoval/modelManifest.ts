/**
 * Offline model manifest — bundled paths and SHA-256 verification (ADR-0005).
 */
export interface ModelManifestEntry {
  id: string;
  filename: string;
  localPath: string;
  sha256: string | null;
  bundled: boolean;
  remoteUrl: string;
}

export interface ModelManifest {
  version: number;
  models: ModelManifestEntry[];
}

let cachedManifest: ModelManifest | null = null;
let manifestPromise: Promise<ModelManifest | null> | null = null;

const MANIFEST_FETCH_TIMEOUT = 5_000;

export async function loadModelManifest(signal?: AbortSignal): Promise<ModelManifest | null> {
  if (cachedManifest) return cachedManifest;
  if (manifestPromise) return manifestPromise;

  const { fetchWithTimeout } = await import('./fetchWithTimeout');

  manifestPromise = (async () => {
    try {
      if (typeof fetch === 'undefined') return null;
      const res = await fetchWithTimeout(
        '/models/manifest.json',
        { signal },
        MANIFEST_FETCH_TIMEOUT,
      );
      if (!res.ok) return null;
      cachedManifest = (await res.json()) as ModelManifest;
      return cachedManifest;
    } catch {
      return null;
    } finally {
      manifestPromise = null;
    }
  })();

  return manifestPromise;
}

export function resetModelManifestCache(): void {
  cachedManifest = null;
  manifestPromise = null;
}

export async function getManifestEntry(
  modelId: string,
  signal?: AbortSignal,
): Promise<ModelManifestEntry | null> {
  const manifest = await loadModelManifest(signal);
  return manifest?.models.find((m) => m.id === modelId) ?? null;
}

export async function sha256Hex(data: ArrayBuffer): Promise<string> {
  const hash = await crypto.subtle.digest('SHA-256', data);
  return [...new Uint8Array(hash)].map((b) => b.toString(16).padStart(2, '0')).join('');
}

export async function verifyModelChecksum(
  data: ArrayBuffer,
  expected: string | null,
): Promise<boolean> {
  if (!expected) return true;
  const actual = await sha256Hex(data);
  return actual === expected.toLowerCase();
}
