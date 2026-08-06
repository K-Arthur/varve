/**
 * Navigation coordinator — the single interpreter for NavigationRequests.
 *
 * It is deliberately NOT a second editor context: it takes the editor
 * context as a parameter and delegates to the existing document, workspace,
 * page, selection, and camera APIs. High-frequency camera input (wheel,
 * pinch, pointer) never routes through here — those stay in the canvas
 * input pipeline.
 *
 * Responsibilities:
 * - Map a typed NavigationTarget to concrete editor API calls.
 * - Apply staleness checks (deleted ids, wrong-document ids, missing docs).
 * - Return a typed NavigationResult for every input — no exceptions.
 * - Cross-document targets produce `cross-document`; the caller decides
 *   whether to offer open-or-cancel via the `openDocument` dependency.
 *
 * The editor parameter is a structural interface (`NavigationEditorContext`)
 * — the members every navigation destination needs — so the coordinator
 * works with whichever EditorContextValue flavor the host exports without
 * importing the (large) full context type.
 */

import type { AuditFinding, NodeId } from '@varve/scene';
import type { SelectionOrigin } from '../context/types';
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import type { NavigationRequest, NavigationResult } from './navigationRequest';

/** The structural slice of the editor context navigation needs. */
export interface NavigationEditorContext {
  state: {
    sessions: Array<{ id: string; name: string; dirty: boolean; fileId?: string }>;
    activeId: string;
    workspaceMode: WorkspaceMode;
    document: {
      nodes: {
        [id: string]: { id: string; kind?: string; children?: string[] };
      };
      pages?: Array<{
        id: string;
        name: string;
        width: number;
        height: number;
        contentRoot: string;
      }>;
      activePageId?: string | null;
    };
    selection: string[];
    currentPageId?: string | null;
    zoom: number;
    pan: { x: number; y: number };
  };
  showToast: (opts: { message: string; type?: 'info' | 'success' | 'warning' | 'error' }) => void;
  openFile: (
    fileId: string,
    name: string,
    filePath: string | undefined,
    json: string | null,
  ) => void;
  switchTab: (id: string) => void;
  requestWorkspaceSwitch: (mode: WorkspaceMode, options?: { force?: boolean }) => Promise<boolean>;
  setActivePage: (pageId: NodeId) => void;
  setCurrentPageId: (id: string | null) => void;
  setSelection: (id: NodeId | null, origin?: SelectionOrigin) => void;
  revealSelection: (opts: { fit: boolean; viewport?: { width: number; height: number } }) => void;
  fitActivePage: () => void;
  setZoom: (z: number) => void;
  setPan: (p: { x: number; y: number }) => void;
}

export interface NavigationDeps {
  /** Navigate back to the home/start surface. */
  goHome?: () => void;
  /**
   * Resolve a document id to openable content. Returns true when the
   * document was opened (or is already open); false when unavailable.
   * Optional — without it, cross-document targets return `cross-document`.
   */
  openDocument?: (documentId: string, name?: string) => Promise<boolean>;
  /** Current audit findings (for `finding` targets). */
  getFindings?: () => readonly AuditFinding[];
  /** Navigate to a finding (select + reveal + inspector focus). */
  navigateToFinding?: (finding: AuditFinding) => void;
}

export type NavigationCoordinator = (
  request: NavigationRequest,
  ctx: NavigationEditorContext,
  deps?: NavigationDeps,
) => Promise<NavigationResult>;

export function createNavigationCoordinator(): NavigationCoordinator {
  return (request, ctx, deps) => coordinate(request, ctx, deps ?? {});
}

async function coordinate(
  request: NavigationRequest,
  ctx: NavigationEditorContext,
  deps: NavigationDeps,
): Promise<NavigationResult> {
  const { target } = request;
  const fitPolicy = request.fit ?? 'none';

  switch (target.kind) {
    case 'home': {
      if (!deps.goHome) {
        return fail(request, ctx, { status: 'blocked', reason: 'no home surface', target });
      }
      deps.goHome();
      return { status: 'completed', target };
    }

    case 'document': {
      const session = ctx.state.sessions.find(
        (s) => s.fileId === target.documentId || s.id === target.documentId,
      );
      if (session) {
        if (session.id !== ctx.state.activeId) ctx.switchTab(session.id);
        return { status: 'completed', target };
      }
      if (!deps.openDocument) {
        return fail(request, ctx, {
          status: 'cross-document',
          documentId: target.documentId,
          target,
        });
      }
      const opened = await deps.openDocument(target.documentId, target.name);
      if (!opened) return fail(request, ctx, { status: 'document-unavailable', target });
      return { status: 'completed', target };
    }

    case 'workspace': {
      if (target.mode === ctx.state.workspaceMode) return { status: 'completed', target };
      const switched = await ctx.requestWorkspaceSwitch(target.mode);
      if (!switched) {
        return fail(request, ctx, {
          status: 'blocked',
          reason: 'workspace switch did not complete',
          target,
        });
      }
      if (request.focus === 'canvas') focusCanvas();
      return { status: 'completed', target };
    }

    case 'page': {
      const pages = ctx.state.document.pages ?? [];
      const page = pages.find((p) => p.id === target.pageId);
      if (!page) {
        return fail(request, ctx, { status: 'stale', reason: 'page was deleted', target });
      }
      const current = ctx.state.document.activePageId ?? ctx.state.currentPageId;
      if (current !== target.pageId) {
        ctx.setActivePage(target.pageId);
        ctx.setCurrentPageId(target.pageId);
      }
      if (fitPolicy === 'fit') {
        // fitActivePage reads document.activePageId, which setActivePage
        // has just updated — no camera math is duplicated here.
        ctx.fitActivePage();
      }
      if (request.focus === 'canvas') focusCanvas();
      return { status: 'completed', target };
    }

    case 'node': {
      const node = ctx.state.document.nodes[target.nodeId];
      if (!node) {
        return fail(request, ctx, { status: 'stale', reason: 'node was deleted', target });
      }
      const pageOf = findPageOfNode(ctx, target.nodeId);
      if (pageOf) {
        const current = ctx.state.document.activePageId ?? ctx.state.currentPageId;
        if (current !== pageOf) {
          ctx.setActivePage(pageOf);
          ctx.setCurrentPageId(pageOf);
        }
      }
      if (ctx.state.selection[0] !== target.nodeId) {
        ctx.setSelection(target.nodeId, 'api');
      }
      if (fitPolicy === 'fit' || target.fit === true) {
        ctx.revealSelection({ fit: true });
      } else if (fitPolicy === 'reveal' || target.fit === false) {
        ctx.revealSelection({ fit: false });
      }
      if (request.focus === 'canvas') focusCanvas();
      return { status: 'completed', target };
    }

    case 'finding': {
      const findings = deps.getFindings?.();
      const finding = findings?.find((f) => f.findingId === target.findingId);
      if (!finding) {
        return fail(request, ctx, {
          status: 'stale',
          reason:
            findings && findings.length > 0
              ? 'finding not in the current audit'
              : 'no audit findings loaded',
          target,
        });
      }
      if (deps.navigateToFinding) {
        deps.navigateToFinding(finding);
        return { status: 'completed', target };
      }
      // No navigator dependency: fall back to a minimal select+reveal.
      if (finding.nodeId) {
        const node = ctx.state.document.nodes[finding.nodeId];
        if (!node) {
          return fail(request, ctx, {
            status: 'stale',
            reason: 'finding target was deleted',
            target,
          });
        }
        ctx.setSelection(finding.nodeId, 'api');
        ctx.revealSelection({ fit: true });
      } else if (finding.pageId) {
        const pages = ctx.state.document.pages ?? [];
        if (!pages.some((p) => p.id === finding.pageId)) {
          return fail(request, ctx, {
            status: 'stale',
            reason: 'finding page was deleted',
            target,
          });
        }
        ctx.setActivePage(finding.pageId);
        ctx.setCurrentPageId(finding.pageId);
      }
      return { status: 'completed', target };
    }

    case 'viewport': {
      if (target.zoom !== undefined) ctx.setZoom(target.zoom);
      if (target.pan !== undefined) ctx.setPan(target.pan);
      return { status: 'completed', target };
    }
  }
}

/** Apply the request's failure policy and return the result. */
function fail(
  request: NavigationRequest,
  ctx: NavigationEditorContext,
  result: NavigationResult,
): NavigationResult {
  if ((request.failure ?? 'toast') === 'toast') {
    const message =
      result.status === 'stale' || result.status === 'blocked'
        ? `Destination is no longer available: ${(result as { reason: string }).reason}`
        : result.status === 'document-unavailable'
          ? 'The document could not be opened'
          : 'This destination belongs to another document';
    ctx.showToast({ message, type: 'warning' });
  }
  return result;
}

function focusCanvas(): void {
  const canvas = document.querySelector<HTMLElement>('.editor-canvas__content-layer');
  canvas?.focus();
}

function findPageOfNode(ctx: NavigationEditorContext, nodeId: string): string | null {
  const pages = ctx.state.document.pages ?? [];
  for (const page of pages) {
    if (page.id === nodeId) return page.id;
    const root = ctx.state.document.nodes[page.contentRoot];
    if (root && root.kind === 'group' && root.children?.includes(nodeId)) {
      return page.id;
    }
  }
  return null;
}
