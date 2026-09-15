import { useEffect, useMemo, useRef, useState } from 'react';
import { loadSettings } from '../settings';
import { type BootManager, type BootState, createBootManager } from './bootManager';
import { checkStartupCapabilities, type StartupCapabilities } from './capabilityCheck';
import { STARTUP_TIMEOUT_MS } from './startupConstants';
import {
  createStartupTimer,
  STARTUP_MILESTONES,
  type StartupTimelineExport,
  type StartupTimer,
} from './startupTimer';

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
  markHomeDataReady: () => void;
  markEditorStateInitialized: () => void;
  onHomeReady: () => void;
  onEditorReady: () => void;
  exportStartupTimeline: () => StartupTimelineExport;
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
    startupTimer.markOnce(STARTUP_MILESTONES.APP_MOUNT);
  }, []); // eslint-disable-line react-hooks/exhaustive-deps

  const isWarmRestart = useMemo(() => {
    if (typeof sessionStorage !== 'undefined') {
      const flag = sessionStorage.getItem('varve-session-started');
      if (flag) return true;
      sessionStorage.setItem('varve-session-started', '1');
    }
    return false;
  }, []);

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
    markHomeDataReady: () => startupTimer.markOnce(STARTUP_MILESTONES.HOME_DATA_READY),
    markEditorStateInitialized: () =>
      startupTimer.markOnce(STARTUP_MILESTONES.EDITOR_STATE_INITIALIZED),
    onHomeReady: () => {
      startupTimer.markOnce(STARTUP_MILESTONES.HOME_INTERACTIVE);
      bootManager.markHomeReady();
    },
    onEditorReady: () => {
      startupTimer.markOnce(STARTUP_MILESTONES.EDITOR_FIRST_VISIBLE_CANVAS);
      bootManager.markEditorReady();
    },
    exportStartupTimeline: () => startupTimer.exportTimeline(),
    onBootError: reportBootError,
  };
}
