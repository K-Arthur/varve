/**
 * Browser-demo entry orchestration.
 *
 * In demo mode (/try path or ?try=1) the app skips Home-first boot and opens
 * the canonical sample document as soon as the storage platform is ready:
 *
 *   1. seed the sample into local storage (idempotent — never overwrites a
 *      user's edits; on storage failure the document still opens in memory)
 *   2. open it through the normal open path so save/reopen semantics are the
 *      same as any other document
 *   3. surface banner state (limitations + desktop CTA) for the DemoBanner
 *
 * Desktop (Tauri) and non-demo URLs are untouched.
 */

import type { FileEntry, Platform } from '@varve/platform';
import { useEffect, useMemo, useRef, useState } from 'react';
import { type DemoConfig, demoMode } from './demoMode';
import { type DemoSeedResult, seedDemoSample } from './sampleDocument';

export interface DemoOpenHandlers {
  /** Normal open path (reads content from storage). */
  onOpenFile: (entry: FileEntry) => Promise<void> | void;
  /** Fallback: open without a storage read (ephemeral / quota failure). */
  onOpenDirect: (entry: { id: string; name: string }, json: string) => void;
}

export interface DemoEntryState {
  config: DemoConfig;
  /** True once the demo document has been handed to the editor. */
  opened: boolean;
  /** Seed outcome for diagnostics; null before the attempt / on non-demo pages. */
  seed: DemoSeedResult | null;
}

export function useDemoEntry(
  platform: Platform,
  storageIsEphemeral: boolean,
  handlers: DemoOpenHandlers,
): DemoEntryState {
  const config = useMemo(() => demoMode(), []);
  const [seed, setSeed] = useState<DemoSeedResult | null>(null);
  const startedRef = useRef(false);
  const handlersRef = useRef(handlers);
  handlersRef.current = handlers;

  useEffect(() => {
    if (!config.active || startedRef.current) return;
    // Wait for the real storage backend: the boot platform is the in-memory
    // fallback until createWebPlatform() resolves (App swaps it in). When the
    // upgrade failed (storageIsEphemeral) the memory platform is all we have —
    // the sample still opens, it just cannot persist.
    if (platform.kind === 'memory' && !storageIsEphemeral) return;
    startedRef.current = true;

    let cancelled = false;
    void (async () => {
      const { onOpenFile, onOpenDirect } = handlersRef.current;
      const result = await seedDemoSample(platform);
      if (cancelled) return;
      setSeed(result);
      if (!result.ok) {
        // Storage is broken (quota/privacy mode): open the document in memory
        // so the demo still works for the session. The ephemeral banner
        // already tells the user their work will not persist.
        const { makeDemoSampleEntry, serializeDemoSample } = await import('./sampleDocument');
        onOpenDirect(makeDemoSampleEntry(), serializeDemoSample());
        return;
      }
      await onOpenFile(result.entry);
    })();
    return () => {
      cancelled = true;
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [config.active, platform, storageIsEphemeral]);

  return { config, opened: startedRef.current && seed?.ok === true, seed };
}
