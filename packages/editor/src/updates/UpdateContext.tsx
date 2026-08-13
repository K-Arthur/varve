import { Button, Dialog } from '@varve/ui';
import {
  createContext,
  type ReactNode,
  useCallback,
  useContext,
  useEffect,
  useMemo,
  useRef,
  useState,
} from 'react';
import { getLifecycleCoordinator, setLifecycleCommitHook } from '../lifecycle';
import { UpdateCoordinator } from './updateCoordinator';
import type {
  UpdatePreferences,
  UpdatePreferencesStore,
  UpdateProvider,
  UpdateState,
} from './updateTypes';
import {
  BroadcastWindowSync,
  isActiveUpdateState,
  isSettledUpdateState,
  UPDATE_ACTIVE_STALE_MS,
  type UpdateWindowOperation,
} from './updateWindowSync';

const STORAGE_KEY = 'varve-update-preferences';

interface UpdateContextValue {
  coordinator: UpdateCoordinator;
  context: ReturnType<UpdateCoordinator['getContext']>;
  state: UpdateState;
  preferences: UpdatePreferences;
  setPreferences(patch: Partial<UpdatePreferences>): UpdatePreferences;
  check(): Promise<UpdateState>;
  download(): Promise<UpdateState>;
  install(): Promise<UpdateState>;
  installAndRestart(): Promise<UpdateState>;
  defer(): UpdateState;
  skipVersion(): UpdatePreferences;
  resetSkippedVersions(): UpdatePreferences;
}

const UpdateContext = createContext<UpdateContextValue | null>(null);

const localStore: UpdatePreferencesStore = {
  load() {
    try {
      const raw = localStorage.getItem(STORAGE_KEY);
      return raw
        ? (JSON.parse(raw) as UpdatePreferences)
        : {
            schemaVersion: 1,
            consentPromptSeen: false,
            consent: 'manual',
            installOnQuit: false,
            channel: 'stable',
            skippedVersions: {},
            lastCheckedAt: null,
            nextEligibleCheckAt: null,
          };
    } catch {
      return {
        schemaVersion: 1,
        consentPromptSeen: false,
        consent: 'manual',
        installOnQuit: false,
        channel: 'stable',
        skippedVersions: {},
        lastCheckedAt: null,
        nextEligibleCheckAt: null,
      };
    }
  },
  save(preferences) {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(preferences));
  },
};

export function UpdateCoordinatorProvider({
  provider,
  children,
}: {
  provider: UpdateProvider;
  children: ReactNode;
}) {
  const coordinator = useMemo(() => new UpdateCoordinator(provider, localStore), [provider]);
  const sync = useMemo(
    () =>
      typeof window !== 'undefined' && 'BroadcastChannel' in window
        ? new BroadcastWindowSync()
        : null,
    [],
  );
  const [state, setState] = useState<UpdateState>(() => coordinator.getState());
  const [preferences, setPreferencesState] = useState<UpdatePreferences>(() =>
    coordinator.getPreferences(),
  );
  const [consentOpen, setConsentOpen] = useState(false);
  const installRequestedRef = useRef(false);
  const lastSyncAtRef = useRef(0);

  // One coordinator per process is impossible across windows, so each window
  // mirrors the others' state through the sync channel. Local operations are
  // lease-guarded: a second window never starts a duplicate download/install.
  useEffect(() => {
    if (!sync) return;
    const unsubscribeLocal = coordinator.subscribe((next) => {
      setState(next);
      lastSyncAtRef.current = Date.now();
      sync.publish({ type: 'state', state: next });
    });
    const unsubscribeRemote = sync.subscribe((message) => {
      if (message.type === 'state' && message.state) {
        const remote = message.state as UpdateState;
        // A local active operation owns the truth until it finishes; anything
        // else is safe to mirror. `synchronize` is a no-op for identical state.
        const adopted = coordinator.synchronize(remote);
        setState(adopted);
        lastSyncAtRef.current = Date.now();
      } else if (message.type === 'preferences' && message.preferences) {
        const adopted = coordinator.adoptPreferences(message.preferences as UpdatePreferences);
        setPreferencesState(adopted);
        // The consent prompt is a per-window dialog; a decision made in one
        // window closes it in the others.
        if (adopted.consentPromptSeen || adopted.consent !== 'manual') setConsentOpen(false);
        lastSyncAtRef.current = Date.now();
      }
    });

    // If the window owning an active operation dies without finishing, the
    // lease expires and this window recovers to a settled state instead of
    // freezing on a mirrored "downloading" forever.
    const staleTimer = window.setInterval(() => {
      const local = coordinator.getState();
      if (!isActiveUpdateState(local.kind)) return;
      if (Date.now() - lastSyncAtRef.current > UPDATE_ACTIVE_STALE_MS) {
        const adopted = coordinator.resetStaleOperation();
        setState(adopted);
      }
    }, 30_000);

    return () => {
      unsubscribeLocal();
      unsubscribeRemote();
      window.clearInterval(staleTimer);
      sync.close();
    };
  }, [coordinator, sync]);

  useEffect(() => {
    void coordinator.initialize().then((next) => {
      setState(next);
      const current = coordinator.getPreferences();
      setPreferencesState(current);
      setConsentOpen(next.kind === 'consent-required' && !current.consentPromptSeen);
    });
  }, [coordinator]);

  const setPreferences = useCallback(
    (patch: Partial<UpdatePreferences>) => {
      const next = coordinator.setPreferences(
        patch.consent ? { ...patch, consentPromptSeen: true } : patch,
      );
      setPreferencesState(next);
      sync?.publish({ type: 'preferences', preferences: next });
      return next;
    },
    [coordinator, sync],
  );

  const runGuarded = useCallback(
    async (kind: UpdateWindowOperation, operation: () => Promise<UpdateState>) => {
      if (!sync || sync.claim(kind)) {
        const renewTimer = window.setInterval(() => sync?.renew(kind), 30_000);
        try {
          return await operation();
        } finally {
          window.clearInterval(renewTimer);
          sync?.release(kind);
        }
      }
      // Another window owns the operation; mirror its state as it arrives.
      return coordinator.getState();
    },
    [coordinator, sync],
  );

  const value = useMemo<UpdateContextValue>(
    () => ({
      coordinator,
      context: coordinator.getContext(),
      state,
      preferences,
      setPreferences,
      check: () => runGuarded('check', () => coordinator.check('manual')),
      download: () => runGuarded('download', () => coordinator.download()),
      install: () => runGuarded('install', () => coordinator.install()),
      installAndRestart: async () => {
        installRequestedRef.current = true;
        const lifecycle = getLifecycleCoordinator();
        if (!lifecycle) {
          const installed = await runGuarded('install', () => coordinator.install());
          if (installed.kind !== 'restart-required') return installed;
          return coordinator.relaunch();
        }
        await lifecycle.requestTermination('restart', 'update-install');
        return coordinator.getState();
      },
      defer: () => coordinator.defer(),
      skipVersion: () => {
        const next = coordinator.skipVersion();
        setPreferencesState(next);
        sync?.publish({ type: 'preferences', preferences: next });
        return next;
      },
      resetSkippedVersions: () => {
        const next = coordinator.resetSkippedVersions();
        setPreferencesState(next);
        sync?.publish({ type: 'preferences', preferences: next });
        return next;
      },
    }),
    [coordinator, preferences, runGuarded, setPreferences, state, sync],
  );

  useEffect(() => {
    setLifecycleCommitHook(async (intent) => {
      const shouldInstall =
        (intent === 'restart' || intent === 'quit-application') &&
        (installRequestedRef.current ||
          (preferences.installOnQuit && state.kind === 'ready-to-install'));
      if (!shouldInstall) return;
      installRequestedRef.current = false;
      // The canonical termination guard has already resolved unsaved work;
      // only the window processing the quit installs the verified update.
      if (sync && !sync.claim('install')) return;
      const renewTimer = window.setInterval(() => sync?.renew('install'), 30_000);
      try {
        const installed = await coordinator.install();
        if (installed.kind !== 'restart-required') {
          throw new Error('Varve could not install the verified update.');
        }
        // A normal quit only needs the installer to finish; the next launch
        // picks up the installed version. An explicit restart owns relaunching
        // and therefore suppresses the bridge's ordinary exit approval.
        if (intent === 'restart') {
          await coordinator.relaunch();
          return true;
        }
      } finally {
        window.clearInterval(renewTimer);
        sync?.release('install');
      }
    });
    return () => setLifecycleCommitHook(null);
  }, [coordinator, preferences.installOnQuit, state.kind, sync]);

  // Background check scheduler: fires from any settled state, so a first check
  // that ended in up-to-date/error/deferred still schedules the next eligible
  // check (24 h after success, 6 h after failure). Manual mode never schedules.
  useEffect(() => {
    if (preferences.consent === 'manual' || !isSettledUpdateState(state.kind)) return;
    const delay = preferences.nextEligibleCheckAt
      ? Math.max(0, preferences.nextEligibleCheckAt - Date.now())
      : 30_000;
    const timer = window.setTimeout(() => {
      void coordinator.check('background');
    }, delay);
    return () => window.clearTimeout(timer);
  }, [coordinator, preferences.consent, preferences.nextEligibleCheckAt, state.kind]);

  const finishConsent = useCallback(
    (consent: UpdatePreferences['consent']) => {
      setPreferences({ consent, consentPromptSeen: true });
      setConsentOpen(false);
    },
    [setPreferences],
  );

  return (
    <UpdateContext.Provider value={value}>
      {children}
      <Dialog
        open={consentOpen}
        onClose={() => finishConsent('manual')}
        title="Keep Varve up to date?"
        dismissible
      >
        <div className="settings-section">
          <p className="settings-desc">
            Varve can periodically check for newer versions. Checking contacts Varve's configured
            release endpoint. Updates are cryptographically verified before installation, and you
            can change this choice at any time in Settings.
          </p>
          <div className="settings-dialog__footer">
            <Button variant="secondary" onClick={() => finishConsent('manual')}>
              Not now
            </Button>
            <Button variant="primary" onClick={() => finishConsent('notify')}>
              Automatically check for updates
            </Button>
          </div>
        </div>
      </Dialog>
    </UpdateContext.Provider>
  );
}

export function useUpdateCoordinator(): UpdateContextValue {
  const context = useContext(UpdateContext);
  if (!context)
    throw new Error('useUpdateCoordinator must be used within UpdateCoordinatorProvider');
  return context;
}

export function useOptionalUpdateCoordinator(): UpdateContextValue | null {
  return useContext(UpdateContext);
}
