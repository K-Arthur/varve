import { isTauriRuntime } from '@varve/platform';
import type { AuditFinding } from '@varve/scene';
import type { EditorContextValue } from '../context/types';
import {
  createNavigationCoordinator,
  type NavigationCoordinator,
  type NavigationDeps,
  type NavigationEditorContext,
} from './navigationCoordinator';
import type { NavigationRequest } from './navigationRequest';
import { parseNavigationTargetFromUrl } from './navigationTargets';

export type DeepLinkType = 'finding' | 'unknown';

export interface DeepLinkRequest {
  type: DeepLinkType;
  findingId: string;
  raw: string;
}

/** Outcome of a handled deep link, for the caller to announce or ignore. */
export type DeepLinkOutcome =
  | { status: 'completed' }
  | { status: 'blocked'; reason: string }
  | { status: 'stale'; reason: string };

/**
 * Dependencies the deep-link handler needs beyond the editor context:
 * the navigation coordinator plus the resolver hooks it consults.
 */
export interface DeepLinkDeps extends NavigationDeps {
  /** Coordinator used to execute typed destinations. Defaults to the standard one. */
  coordinator?: NavigationCoordinator;
  /** How long to park a link while the document is still loading. */
  timeoutMs?: number;
}

const DEEP_LINK_TIMEOUT_MS = 30000;
const DEEP_LINK_POLL_MS = 100;

interface PendingLink {
  href: string;
  deps: DeepLinkDeps;
  createdAt: number;
  resolve: (outcome: DeepLinkOutcome) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

let pendingLink: PendingLink | null = null;

/** Cancel any parked deep link (used by tests and teardown). */
export function resetDeepLinkState(): void {
  if (pendingLink) {
    clearTimeout(pendingLink.timeoutId);
    pendingLink = null;
  }
}

export function parseDeepLink(href: string): DeepLinkRequest | null {
  try {
    const url = new URL(href, window.location.origin);

    if (url.protocol === 'finding:') {
      const findingId = url.pathname.replace(/^\//, '');
      if (findingId) {
        return { type: 'finding', findingId, raw: href };
      }
    }

    if (url.protocol === 'http:' || url.protocol === 'https:') {
      const findingParam = url.searchParams.get('finding');
      if (findingParam) {
        return { type: 'finding', findingId: findingParam, raw: href };
      }
    }

    return null;
  } catch {
    return null;
  }
}

export function parseFindingDeepLink(href: string): DeepLinkRequest | null {
  const link = parseDeepLink(href);
  if (link?.type === 'finding') return link;
  return null;
}

function isDocumentLoaded(state: unknown): boolean {
  if (!state) return false;
  const s = state as { document?: { nodes?: Record<string, unknown> } };
  return !!s.document?.nodes && Object.keys(s.document.nodes).length > 0;
}

export function isFindingFromDifferentDocument(
  findingId: string,
  currentFindings: AuditFinding[],
): boolean {
  return !currentFindings.some((f) => f.findingId === findingId);
}

export async function handleDeepLink(href: string, deps: DeepLinkDeps): Promise<DeepLinkOutcome> {
  if (pendingLink) {
    clearTimeout(pendingLink.timeoutId);
    pendingLink.reject(new Error('Cancelled by new deep link'));
    pendingLink = null;
  }

  const parsed = parseNavigationTargetFromUrl(href);
  if (!parsed.ok) {
    return { status: 'blocked', reason: parsed.reason };
  }

  const ctx = tryGetEditorContext();
  if (!ctx || !isDocumentLoaded(ctx.state)) {
    return parkUntilLoaded(href, deps);
  }

  return executeNavigation(href, deps, ctx);
}

function parkUntilLoaded(href: string, deps: DeepLinkDeps): Promise<DeepLinkOutcome> {
  return new Promise<DeepLinkOutcome>((resolve, reject) => {
    const timeoutMs = deps.timeoutMs ?? DEEP_LINK_TIMEOUT_MS;
    const timeoutId = setTimeout(() => {
      pendingLink = null;
      resolve({ status: 'blocked', reason: 'document never loaded' });
    }, timeoutMs);

    pendingLink = {
      href,
      deps,
      createdAt: Date.now(),
      resolve,
      reject,
      timeoutId,
    };

    pollForContext(href, deps, resolve);
  });
}

function pollForContext(
  href: string,
  deps: DeepLinkDeps,
  resolve: (outcome: DeepLinkOutcome) => void,
): void {
  if (!pendingLink) return;

  const ctx = tryGetEditorContext();
  if (ctx && isDocumentLoaded(ctx.state)) {
    clearTimeout(pendingLink.timeoutId);
    pendingLink = null;
    void executeNavigation(href, deps, ctx).then(resolve);
    return;
  }

  if (Date.now() - pendingLink.createdAt > DEEP_LINK_TIMEOUT_MS) {
    clearTimeout(pendingLink.timeoutId);
    pendingLink = null;
    resolve({ status: 'blocked', reason: 'document never loaded' });
    return;
  }

  setTimeout(() => pollForContext(href, deps, resolve), DEEP_LINK_POLL_MS);
}

async function executeNavigation(
  href: string,
  deps: DeepLinkDeps,
  ctx: EditorContextValue | NavigationEditorContext,
): Promise<DeepLinkOutcome> {
  const parsed = parseNavigationTargetFromUrl(href);
  if (!parsed.ok) {
    return { status: 'blocked', reason: parsed.reason };
  }

  const request: NavigationRequest = {
    target: parsed.target,
    source: 'deep-link',
    activation: 'auto',
    focus: 'canvas',
    fit: parsed.target.kind === 'page' ? 'fit' : 'reveal',
    history: 'record',
    failure: 'silent',
  };

  const coordinator = deps.coordinator ?? createNavigationCoordinator();
  const result = await coordinator(request, ctx as unknown as NavigationEditorContext, deps);

  switch (result.status) {
    case 'completed':
    case 'partially-completed':
      return { status: 'completed' };
    case 'stale':
      return { status: 'stale', reason: result.reason };
    default:
      return {
        status: 'blocked',
        reason: result.status === 'blocked' ? result.reason : result.status,
      };
  }
}

let cachedCtx: EditorContextValue | NavigationEditorContext | null = null;

export function setCachedEditorContext(
  ctx: EditorContextValue | NavigationEditorContext | null,
): void {
  cachedCtx = ctx;
}

function tryGetEditorContext(): EditorContextValue | NavigationEditorContext | null {
  return cachedCtx;
}

export function setupDeepLinkListener(deps: () => DeepLinkDeps): () => void {
  const handleHashChange = () => {
    const currentDeps = deps();
    const request = parseDeepLink(window.location.href);
    if (request) {
      void handleDeepLink(window.location.href, currentDeps);
    }
  };

  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('popstate', handleHashChange);

  const initialDeps = deps();
  const initialRequest = parseDeepLink(window.location.href);
  if (initialRequest) {
    void handleDeepLink(window.location.href, initialDeps);
  }

  setupTauriDeepLink(deps);

  return () => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('popstate', handleHashChange);
  };
}

function setupTauriDeepLink(deps: () => DeepLinkDeps): void {
  if (isTauriRuntime()) {
    try {
      const tauri = (window as unknown as Record<string, unknown>).__TAURI__ as {
        event: {
          listen: (
            event: string,
            cb: (payload: { payload: string }) => void,
          ) => Promise<() => void>;
        };
      };
      tauri.event.listen('deep-link', async (event: { payload: string }) => {
        const request = parseDeepLink(event.payload);
        if (request) {
          await handleDeepLink(event.payload, deps());
        }
      });
    } catch {
      // Tauri event listener API might not be available
    }
  }
}
