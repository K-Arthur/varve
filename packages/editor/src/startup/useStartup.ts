import { useEffect, useMemo, useState } from 'react';
import { loadSettings } from '../settings';
import { createBootManager, type BootManager, type BootState } from './bootManager';
import { createStartupTimer, type StartupTimer } from './startupTimer';
import { checkStartupCapabilities, type StartupCapabilities } from './capabilityCheck';

export interface UseStartupOptions {
  onBootComplete?: () => void;
}

export interface UseStartupResult {
  showLoader: boolean;
  bootState: BootState;
  bootError: string | null;
  onRetry: () => void;
  capabilities: StartupCapabilities;
  startupTime: number;
  onHomeReady: () => void;
  onEditorReady: () => void;
  onBootError: (err: Error) => void;
}

export function useStartup(opts: UseStartupOptions): UseStartupResult {
  const [bootState, setBootState] = useState<BootState>('init');
  const [bootError, setBootError] = useState<string | null>(null);

  const settings = useMemo(() => loadSettings(), []);
  const showBrandedLoader = settings.startup.showBrandedLoader;

  const bootManager = useMemo<BootManager>(
    () =>
      createBootManager({
        onStateChange: (_prev, next) => {
          setBootState(next);
          if (next === 'editor_ready') {
            opts.onBootComplete?.();
          }
        },
      }),
    [], // eslint-disable-line react-hooks/exhaustive-deps
  );

  const startupTimer = useMemo<StartupTimer>(() => createStartupTimer(), []);
  const capabilities = useMemo<StartupCapabilities>(() => checkStartupCapabilities(), []);

  useEffect(() => {
    startupTimer.mark('app_mount');
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  // Warm restart detection — skip branded loader if sessionStorage flag is set
  const isWarmRestart = useMemo(() => {
    if (typeof sessionStorage !== 'undefined') {
      const flag = sessionStorage.getItem('strata-session-started');
      if (flag) return true;
      sessionStorage.setItem('strata-session-started', '1');
    }
    return false;
  }, []);

  // Skip branded loader when disabled or on warm restart
  useEffect(() => {
    if ((!showBrandedLoader || isWarmRestart) && bootManager.state() === 'init') {
      bootManager.markHomeReady();
    }
  }, [showBrandedLoader, isWarmRestart, bootManager]);

  const showLoader =
    showBrandedLoader && (bootState === 'init' || bootState === 'error') && !isWarmRestart;
  const startupTime = startupTimer.elapsed();

  return {
    showLoader,
    bootState,
    bootError,
    onRetry: () => {
      setBootError(null);
      setBootState('init');
    },
    capabilities,
    startupTime,
    onHomeReady: () => bootManager.markHomeReady(),
    onEditorReady: () => bootManager.markEditorReady(),
    onBootError: (err: Error) => {
      setBootError(err.message);
      bootManager.markError(err);
    },
  };
}
