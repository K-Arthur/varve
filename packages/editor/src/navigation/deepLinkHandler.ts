import type { AuditFinding } from '@strata/scene';
import type { EditorContextValue } from '../context/types';

export type DeepLinkType = 'finding' | 'unknown';

export interface DeepLinkRequest {
  type: DeepLinkType;
  findingId: string;
  raw: string;
}

const DEEP_LINK_TIMEOUT_MS = 30000;
const DEEP_LINK_POLL_MS = 100;

interface PendingLink {
  request: DeepLinkRequest;
  createdAt: number;
  resolve: (result: boolean) => void;
  reject: (error: Error) => void;
  timeoutId: ReturnType<typeof setTimeout>;
}

let pendingLink: PendingLink | null = null;

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

export async function handleDeepLink(
  request: DeepLinkRequest,
  ctx: EditorContextValue | null,
  getFindings: () => AuditFinding[],
  navigateToFinding: (finding: AuditFinding) => void,
): Promise<boolean> {
  if (pendingLink) {
    clearTimeout(pendingLink.timeoutId);
    pendingLink.reject(new Error('Cancelled by new deep link'));
    pendingLink = null;
  }

  if (!ctx) {
    return new Promise<boolean>((resolve, reject) => {
      const timeoutId = setTimeout(() => {
        pendingLink = null;
        reject(new Error('Deep link timed out: document never loaded'));
      }, DEEP_LINK_TIMEOUT_MS);

      pendingLink = {
        request,
        createdAt: Date.now(),
        resolve,
        reject,
        timeoutId,
      };

      pollForContext(request, getFindings, navigateToFinding, resolve);
    });
  }

  return executeNavigation(request, ctx, getFindings, navigateToFinding);
}

function pollForContext(
  request: DeepLinkRequest,
  getFindings: () => AuditFinding[],
  navigateToFinding: (finding: AuditFinding) => void,
  resolve: (result: boolean) => void,
): void {
  if (pendingLink && Date.now() - pendingLink.createdAt > DEEP_LINK_TIMEOUT_MS) {
    clearTimeout(pendingLink.timeoutId);
    pendingLink = null;
    resolve(false);
    return;
  }

  const moduleCtx = tryGetEditorContext();
  if (moduleCtx && isDocumentLoaded(moduleCtx.state)) {
    clearTimeout(pendingLink!.timeoutId);
    pendingLink = null;
    executeNavigation(request, moduleCtx, getFindings, navigateToFinding).then(resolve);
    return;
  }

  setTimeout(
    () => pollForContext(request, getFindings, navigateToFinding, resolve),
    DEEP_LINK_POLL_MS,
  );
}

let cachedCtx: EditorContextValue | null = null;

export function setCachedEditorContext(ctx: EditorContextValue | null): void {
  cachedCtx = ctx;
}

function tryGetEditorContext(): EditorContextValue | null {
  return cachedCtx;
}

async function executeNavigation(
  request: DeepLinkRequest,
  ctx: EditorContextValue,
  getFindings: () => AuditFinding[],
  navigateToFinding: (finding: AuditFinding) => void,
): Promise<boolean> {
  const findings = getFindings();
  const finding = findings.find((f) => f.findingId === request.findingId);

  if (!finding) {
    if (isFindingFromDifferentDocument(request.findingId, findings)) {
      ctx.showToast({
        message: 'This finding belongs to a different document',
        type: 'warning',
      });
    } else {
      ctx.showToast({
        message: 'Finding not found — re-run the audit to refresh findings',
        type: 'warning',
      });
    }
    return false;
  }

  navigateToFinding(finding);
  return true;
}

export function setupDeepLinkListener(
  getFindings: () => AuditFinding[],
  navigateToFinding: (finding: AuditFinding) => void,
): () => void {
  const handleHashChange = () => {
    const request = parseDeepLink(window.location.href);
    if (request) {
      const ctx = tryGetEditorContext();
      handleDeepLink(request, ctx, getFindings, navigateToFinding);
    }
  };

  window.addEventListener('hashchange', handleHashChange);
  window.addEventListener('popstate', handleHashChange);

  const initialRequest = parseDeepLink(window.location.href);
  if (initialRequest) {
    const ctx = tryGetEditorContext();
    handleDeepLink(initialRequest, ctx, getFindings, navigateToFinding);
  }

  setupTauriDeepLink(getFindings, navigateToFinding);

  return () => {
    window.removeEventListener('hashchange', handleHashChange);
    window.removeEventListener('popstate', handleHashChange);
  };
}

function setupTauriDeepLink(
  _getFindings: () => AuditFinding[],
  _navigateToFinding: (finding: AuditFinding) => void,
): void {
  if (typeof window !== 'undefined') {
    const w = window as unknown as Record<string, unknown>;
    const hasTauri = typeof w.__TAURI__ !== 'undefined';
    if (hasTauri) {
      try {
        const tauri = w.__TAURI__ as {
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
            const ctx = tryGetEditorContext();
            await handleDeepLink(request, ctx, _getFindings, _navigateToFinding);
          }
        });
      } catch {
        // Tauri event listener API might not be available
      }
    }
  }
}
