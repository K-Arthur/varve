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
  const [state, setState] = useState<UpdateState>(() => coordinator.getState());
  const [preferences, setPreferencesState] = useState<UpdatePreferences>(() =>
    coordinator.getPreferences(),
  );
  const [consentOpen, setConsentOpen] = useState(false);
  const installRequestedRef = useRef(false);

  useEffect(() => {
    const unsubscribe = coordinator.subscribe(setState);
    void coordinator.initialize().then((next) => {
      setState(next);
      const current = coordinator.getPreferences();
      setPreferencesState(current);
      setConsentOpen(next.kind === 'consent-required' && !current.consentPromptSeen);
    });
    return unsubscribe;
  }, [coordinator]);

  const setPreferences = useCallback(
    (patch: Partial<UpdatePreferences>) => {
      const next = coordinator.setPreferences(
        patch.consent ? { ...patch, consentPromptSeen: true } : patch,
      );
      setPreferencesState(next);
      return next;
    },
    [coordinator],
  );

  const value = useMemo<UpdateContextValue>(
    () => ({
      coordinator,
      context: coordinator.getContext(),
      state,
      preferences,
      setPreferences,
      check: () => coordinator.check('manual'),
      download: () => coordinator.download(),
      install: () => coordinator.install(),
      installAndRestart: async () => {
        installRequestedRef.current = true;
        const lifecycle = getLifecycleCoordinator();
        if (!lifecycle) {
          const installed = await coordinator.install();
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
        return next;
      },
      resetSkippedVersions: () => {
        const next = coordinator.resetSkippedVersions();
        setPreferencesState(next);
        return next;
      },
    }),
    [coordinator, preferences, setPreferences, state],
  );

  useEffect(() => {
    setLifecycleCommitHook(async (intent) => {
      const shouldInstall =
        (intent === 'restart' || intent === 'quit-application') &&
        (installRequestedRef.current ||
          (preferences.installOnQuit && state.kind === 'ready-to-install'));
      if (!shouldInstall) return;
      installRequestedRef.current = false;
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
    });
    return () => setLifecycleCommitHook(null);
  }, [coordinator, preferences.installOnQuit, state.kind]);

  useEffect(() => {
    if (preferences.consent === 'manual' || state.kind !== 'idle') return;
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
