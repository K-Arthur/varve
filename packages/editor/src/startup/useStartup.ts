import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings } from '../settings';
import { type BootManager, type BootState, createBootManager } from './bootManager';
import { checkStartupCapabilities, type StartupCapabilities } from './capabilityCheck';
import { STARTUP_TIMEOUT_MS } from './startupConstants';
import { createStartupTimer, type StartupTimer } from './startupTimer';

export interface UseStartupOptions {
  onBootComplete?: () => void;
}

export interface UseStartupResult {
  showLoader: boolean;
  bootState: BootState;
  bootError: string | null;
  onRetry: () => void;
  /** Bumps when the user retries startup — remount data loaders. */
  retryCount: number;
  capabilities: StartupCapabilities;
  startupTime: number;
  onHomeReady: () => void;
  onEditorReady: () => void;
  onBootError: (err: Error) => void;
}

export function useStartup(opts: UseStartupOptions): UseStartupResult {
  const [bootState, setBootState] = useState<BootState>('init');
  const [bootError, setBootError] = useState<string | null>(null);
  const [retryCount, setRetryCount] = useState(0);

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
  const timeoutFired = useRef(false);

  useEffect(() => {
    startupTimer.mark('app_mount');
    if (typeof performance !== 'undefined' && performance.mark) {
      performance.mark('app_mount');
    }
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isWarmRestart = useMemo(() => {
    if (typeof sessionStorage !== 'undefined') {
      const flag = sessionStorage.getItem('strata-session-started');
      if (flag) return true;
      sessionStorage.setItem('strata-session-started', '1');
    }
    return false;
  }, []);

  useEffect(() => {
    if ((!showBrandedLoader || isWarmRestart) && bootManager.state() === 'init') {
      bootManager.markHomeReady();
    }
  }, [showBrandedLoader, isWarmRestart, bootManager]);

  const reportBootError = (err: Error) => {
    setBootError(err.message);
    bootManager.markError(err);
  };

  // Abort stuck startup — never leave an infinite branded loader
  useEffect(() => {
    if (!showBrandedLoader || isWarmRestart) return undefined;
    if (bootState !== 'init') return undefined;

    timeoutFired.current = false;
    const timer = window.setTimeout(() => {
      if (bootManager.state() === 'init' && !timeoutFired.current) {
        timeoutFired.current = true;
        reportBootError(
          new Error('Startup is taking longer than expected. Check your connection or try again.'),
        );
      }
    }, STARTUP_TIMEOUT_MS);

    return () => window.clearTimeout(timer);
  }, [showBrandedLoader, isWarmRestart, bootState, bootManager, retryCount]);

  const showLoader =
    showBrandedLoader && (bootState === 'init' || bootState === 'error') && !isWarmRestart;
  const startupTime = startupTimer.elapsed();

  return {
    showLoader,
    bootState,
    bootError,
    retryCount,
    onRetry: () => {
      timeoutFired.current = false;
      bootManager.reset();
      setBootError(null);
      setBootState('init');
      setRetryCount((c) => c + 1);
    },
    capabilities,
    startupTime,
    onHomeReady: () => bootManager.markHomeReady(),
    onEditorReady: () => bootManager.markEditorReady(),
    onBootError: reportBootError,
  };
}
