import { describe, expect, it, vi } from 'vitest';
import type { NavigationDeps, NavigationEditorContext } from './navigationCoordinator';
import { createNavigationCoordinator } from './navigationCoordinator';
import type { NavigationRequest } from './navigationRequest';

/** Minimal stub context; anything unset fails the test if touched. */
function makeCtx(overrides: Partial<NavigationEditorContext> = {}): NavigationEditorContext {
  const base = {
    state: {
      sessions: [{ id: 's1', name: 'Doc A', dirty: false }],
      activeId: 's1',
      document: { nodes: {}, pages: [], activePageId: null },
      selection: [],
      zoom: 1,
      pan: { x: 0, y: 0 },
      workspaceMode: 'design',
    },
  } as unknown as NavigationEditorContext;
  return Object.assign(base, overrides) as NavigationEditorContext;
}

function request(
  partial: Omit<NavigationRequest, 'source'> & { source?: NavigationRequest['source'] },
): NavigationRequest {
  return { failure: 'silent', ...partial, source: partial.source ?? 'internal' };
}

const navigate = createNavigationCoordinator();

describe('navigationCoordinator — workspace targets', () => {
  it('delegates to requestWorkspaceSwitch and reports completed', async () => {
    const switchFn = vi.fn().mockResolvedValue(true);
    const ctx = makeCtx({ requestWorkspaceSwitch: switchFn });
    const r = await navigate(request({ target: { kind: 'workspace', mode: 'print' } }), ctx);
    expect(switchFn).toHaveBeenCalledWith('print');
    expect(r.status).toBe('completed');
  });

  it('no-ops when the workspace is already active', async () => {
    const switchFn = vi.fn();
    const ctx = makeCtx({
      state: { workspaceMode: 'print' } as unknown as NavigationEditorContext['state'],
      requestWorkspaceSwitch: switchFn,
    });
    const r = await navigate(request({ target: { kind: 'workspace', mode: 'print' } }), ctx);
    expect(switchFn).not.toHaveBeenCalled();
    expect(r.status).toBe('completed');
  });

  it('reports blocked when the switch was rejected', async () => {
    const ctx = makeCtx({ requestWorkspaceSwitch: vi.fn().mockResolvedValue(false) });
    const r = await navigate(request({ target: { kind: 'workspace', mode: 'logo' } }), ctx);
    expect(r.status).toBe('blocked');
  });
});

describe('navigationCoordinator — page targets', () => {
  it('activates an existing page', async () => {
    const setActivePage = vi.fn();
    const setCurrentPageId = vi.fn();
    const ctx = makeCtx({
      setActivePage,
      setCurrentPageId,
      state: {
        document: {
          nodes: {},
          pages: [
            { id: 'p1', name: 'Page 1', width: 800, height: 600, contentRoot: 'g1' },
            { id: 'p2', name: 'Page 2', width: 800, height: 600, contentRoot: 'g2' },
          ],
          activePageId: 'p1',
        },
      } as unknown as NavigationEditorContext['state'],
    });
    const r = await navigate(request({ target: { kind: 'page', pageId: 'p2' } }), ctx);
    expect(setActivePage).toHaveBeenCalledWith('p2');
    expect(setCurrentPageId).toHaveBeenCalledWith('p2');
    expect(r.status).toBe('completed');
  });

  it('reports stale when the page was deleted', async () => {
    const setActivePage = vi.fn();
    const ctx = makeCtx({
      setActivePage,
      state: {
        document: {
          nodes: {},
          pages: [{ id: 'p1', name: 'Page 1', width: 800, height: 600, contentRoot: 'g1' }],
          activePageId: 'p1',
        },
      } as unknown as NavigationEditorContext['state'],
    });
    const r = await navigate(request({ target: { kind: 'page', pageId: 'deleted-page' } }), ctx);
    expect(r.status).toBe('stale');
    expect(setActivePage).not.toHaveBeenCalled();
  });
});

describe('navigationCoordinator — node targets', () => {
  it('selects and reveals an existing node', async () => {
    const setSelection = vi.fn();
    const revealSelection = vi.fn();
    const ctx = makeCtx({
      setSelection,
      revealSelection,
      state: {
        document: { nodes: { n1: { id: 'n1', name: 'Rect' } }, pages: [], activePageId: null },
        selection: ['other'],
      } as unknown as NavigationEditorContext['state'],
    });
    const r = await navigate(request({ target: { kind: 'node', nodeId: 'n1', fit: true } }), ctx);
    expect(setSelection).toHaveBeenCalledWith('n1', 'api');
    expect(revealSelection).toHaveBeenCalledWith({ fit: true });
    expect(r.status).toBe('completed');
  });

  it('reports stale when the node was deleted', async () => {
    const setSelection = vi.fn();
    const ctx = makeCtx({
      setSelection,
      state: {
        document: { nodes: {}, pages: [], activePageId: null },
        selection: [],
      } as unknown as NavigationEditorContext['state'],
    });
    const r = await navigate(request({ target: { kind: 'node', nodeId: 'gone' } }), ctx);
    expect(r.status).toBe('stale');
    expect(setSelection).not.toHaveBeenCalled();
  });
});

describe('navigationCoordinator — finding targets', () => {
  const finding = { findingId: 'f1', nodeId: 'n1', pageId: 'p1' };

  it('routes to the finding navigator when provided', async () => {
    const navigateToFinding = vi.fn();
    const deps: NavigationDeps = {
      getFindings: () => [finding as never],
      navigateToFinding,
    };
    const r = await navigate(
      request({ target: { kind: 'finding', findingId: 'f1' } }),
      makeCtx(),
      deps,
    );
    expect(navigateToFinding).toHaveBeenCalledWith(finding);
    expect(r.status).toBe('completed');
  });

  it('reports stale for an unknown findingId', async () => {
    const deps: NavigationDeps = { getFindings: () => [finding as never] };
    const r = await navigate(
      request({ target: { kind: 'finding', findingId: 'nope' } }),
      makeCtx(),
      deps,
    );
    expect(r.status).toBe('stale');
  });

  it('reports stale when no findings are loaded', async () => {
    const deps: NavigationDeps = { getFindings: () => [] };
    const r = await navigate(
      request({ target: { kind: 'finding', findingId: 'f1' } }),
      makeCtx(),
      deps,
    );
    expect(r.status).toBe('stale');
  });

  it('falls back to select+reveal without a navigator', async () => {
    const setSelection = vi.fn();
    const revealSelection = vi.fn();
    const ctx = makeCtx({
      setSelection,
      revealSelection,
      state: {
        document: { nodes: { n1: { id: 'n1' } }, pages: [], activePageId: null },
        selection: [],
      } as unknown as NavigationEditorContext['state'],
    });
    const deps: NavigationDeps = { getFindings: () => [finding as never] };
    const r = await navigate(request({ target: { kind: 'finding', findingId: 'f1' } }), ctx, deps);
    expect(setSelection).toHaveBeenCalledWith('n1', 'api');
    expect(revealSelection).toHaveBeenCalledWith({ fit: true });
    expect(r.status).toBe('completed');
  });
});

describe('navigationCoordinator — document targets', () => {
  it('switches to an already-open document tab', async () => {
    const switchTab = vi.fn();
    const ctx = makeCtx({
      switchTab,
      state: {
        sessions: [
          { id: 's1', name: 'Doc A', dirty: false },
          { id: 's2', name: 'Doc B', dirty: false, fileId: 'f2' },
        ],
        activeId: 's1',
        document: { nodes: {}, pages: [] },
      } as unknown as NavigationEditorContext['state'],
    });
    const r = await navigate(request({ target: { kind: 'document', documentId: 'f2' } }), ctx);
    expect(switchTab).toHaveBeenCalledWith('s2');
    expect(r.status).toBe('completed');
  });

  it('reports cross-document without an openDocument resolver', async () => {
    const r = await navigate(
      request({ target: { kind: 'document', documentId: 'f-other' } }),
      makeCtx(),
    );
    expect(r.status).toBe('cross-document');
  });

  it('opens via the resolver when provided', async () => {
    const openDocument = vi.fn().mockResolvedValue(true);
    const openFile = vi.fn();
    const ctx = makeCtx({ openFile });
    const r = await navigate(
      request({ target: { kind: 'document', documentId: 'f-other', name: 'Other' } }),
      ctx,
      { openDocument },
    );
    expect(openDocument).toHaveBeenCalledWith('f-other', 'Other');
    expect(r.status).toBe('completed');
  });

  it('reports document-unavailable when the resolver fails', async () => {
    const openDocument = vi.fn().mockResolvedValue(false);
    const r = await navigate(
      request({ target: { kind: 'document', documentId: 'f-missing' } }),
      makeCtx(),
      { openDocument },
    );
    expect(r.status).toBe('document-unavailable');
  });
});

describe('navigationCoordinator — viewport and home targets', () => {
  it('applies zoom and pan', async () => {
    const setZoom = vi.fn();
    const setPan = vi.fn();
    const ctx = makeCtx({ setZoom, setPan });
    const r = await navigate(
      request({ target: { kind: 'viewport', zoom: 2, pan: { x: 5, y: 6 } } }),
      ctx,
    );
    expect(setZoom).toHaveBeenCalledWith(2);
    expect(setPan).toHaveBeenCalledWith({ x: 5, y: 6 });
    expect(r.status).toBe('completed');
  });

  it('returns home when a handler is provided, blocked otherwise', async () => {
    const goHome = vi.fn();
    const ok = await navigate(request({ target: { kind: 'home' } }), makeCtx(), { goHome });
    expect(goHome).toHaveBeenCalled();
    expect(ok.status).toBe('completed');

    const blocked = await navigate(request({ target: { kind: 'home' } }), makeCtx());
    expect(blocked.status).toBe('blocked');
  });
});
