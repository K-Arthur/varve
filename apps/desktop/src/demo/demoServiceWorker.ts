/**
 * Optional service-worker registration for the deployed browser demo.
 *
 * The native Tauri route and development query demos are deliberately not
 * registered: a worker must not intercept native protocols or Vite HMR. The
 * production /try artifact gets a worker scoped to its own base path, so it
 * cannot affect the marketing site or another browser tab.
 */

export const DEMO_SERVICE_WORKER_FILE = 'varve-demo-sw.js';
export const DEMO_PWA_UPDATE_EVENT = 'varve:pwa-update';

export interface DemoServiceWorkerOptions {
  active: boolean;
  baseUrl?: string;
  development?: boolean;
}

export function normalizeDemoBaseUrl(baseUrl: string | undefined): string {
  const value = baseUrl?.trim() || '/';
  if (value === '/') return '/';
  return `${value.replace(/^\/+|\/+$/g, '')}/`.replace(/^/, '/');
}

export function demoServiceWorkerUrl(baseUrl: string | undefined): string {
  return `${normalizeDemoBaseUrl(baseUrl)}${DEMO_SERVICE_WORKER_FILE}`;
}

export function shouldInstallDemoServiceWorker(
  options: Pick<DemoServiceWorkerOptions, 'active' | 'development'>,
): boolean {
  return options.active && options.development !== true;
}

/** Install the public demo worker and return a cleanup function for tests. */
export function installDemoServiceWorker(options: DemoServiceWorkerOptions): () => void {
  if (
    !shouldInstallDemoServiceWorker(options) ||
    typeof window === 'undefined' ||
    !('serviceWorker' in navigator)
  ) {
    return () => undefined;
  }

  const serviceWorker = navigator.serviceWorker;
  const buildBaseUrl = (import.meta as ImportMeta & { env?: { BASE_URL?: string } }).env?.BASE_URL;
  const scope = normalizeDemoBaseUrl(options.baseUrl ?? buildBaseUrl);
  const url = demoServiceWorkerUrl(scope);
  let registration: ServiceWorkerRegistration | null = null;

  const announceWaitingUpdate = (candidate: ServiceWorkerRegistration) => {
    if (!candidate.waiting || !serviceWorker.controller) return;
    window.dispatchEvent(
      new CustomEvent(DEMO_PWA_UPDATE_EVENT, {
        detail: { registration: candidate },
      }),
    );
  };

  const observeRegistration = (candidate: ServiceWorkerRegistration): (() => void) => {
    registration = candidate;
    announceWaitingUpdate(candidate);
    const onUpdateFound = () => {
      const worker = candidate.installing;
      if (!worker) return;
      const onStateChange = () => {
        if (worker.state === 'installed') announceWaitingUpdate(candidate);
        if (worker.state === 'installed' || worker.state === 'redundant') {
          worker.removeEventListener('statechange', onStateChange);
        }
      };
      worker.addEventListener('statechange', onStateChange);
    };
    candidate.addEventListener('updatefound', onUpdateFound);
    return () => candidate.removeEventListener('updatefound', onUpdateFound);
  };

  let stopObserving: (() => void) | null = null;
  const onVisibilityChange = () => {
    if (document.visibilityState !== 'visible' || !registration) return;
    void registration.update().catch(() => undefined);
  };
  document.addEventListener('visibilitychange', onVisibilityChange);

  void serviceWorker
    .register(url, { scope, updateViaCache: 'none' })
    .then((candidate) => {
      stopObserving?.();
      stopObserving = observeRegistration(candidate);
    })
    .catch(() => {
      // PWA support is an enhancement; the editor remains usable with its
      // existing IndexedDB and explicit file save paths.
      registration = null;
    });

  return () => {
    stopObserving?.();
    document.removeEventListener('visibilitychange', onVisibilityChange);
    registration = null;
  };
}
