/** @vitest-environment jsdom */

import { beforeEach, describe, expect, it, vi } from 'vitest';
import {
  type DeepLinkDeps,
  handleDeepLink,
  isFindingFromDifferentDocument,
  parseDeepLink,
  parseFindingDeepLink,
  resetDeepLinkState,
  setCachedEditorContext,
  setupDeepLinkListener,
} from './deepLinkHandler';
import type { NavigationEditorContext } from './navigationCoordinator';
import { createNavigationCoordinator } from './navigationCoordinator';

function makeCtx(overrides: Partial<NavigationEditorContext> = {}): NavigationEditorContext {
  return {
    state: {
      sessions: [{ id: 's1', name: 'Doc', dirty: false }],
      activeId: 's1',
      // Non-empty nodes: a "loaded" document (isDocumentLoaded).
      document: { nodes: { n1: {} }, pages: [], activePageId: null },
      selection: [],
      zoom: 1,
      pan: { x: 0, y: 0 },
      workspaceMode: 'design',
    },
    showToast: vi.fn(),
    ...overrides,
  } as unknown as NavigationEditorContext;
}

function makeDeps(overrides: Partial<DeepLinkDeps> = {}): DeepLinkDeps {
  return {
    coordinator: createNavigationCoordinator(),
    getFindings: () => [],
    ...overrides,
  };
}

describe('parseDeepLink — legacy compatibility', () => {
  beforeEach(() => resetDeepLinkState());

  it('parses legacy finding: links', () => {
    expect(parseDeepLink('finding:audit-1')).toEqual({
      type: 'finding',
      findingId: 'audit-1',
      raw: 'finding:audit-1',
    });
  });

  it('parses ?finding= query links', () => {
    expect(parseDeepLink('?finding=audit-2')?.findingId).toBe('audit-2');
  });

  it('returns null for non-finding or malformed links', () => {
    expect(parseDeepLink('varve://navigate/workspace/design')).toBeNull();
    expect(parseDeepLink('not a link')).toBeNull();
    expect(parseFindingDeepLink('varve://navigate/page/p1')).toBeNull();
  });

  it('isFindingFromDifferentDocument reports unknown ids', () => {
    expect(isFindingFromDifferentDocument('x', [{ findingId: 'y' } as never])).toBe(true);
    expect(isFindingFromDifferentDocument('x', [{ findingId: 'x' } as never])).toBe(false);
  });
});

describe('handleDeepLink — typed destinations', () => {
  beforeEach(() => resetDeepLinkState());

  it('rejects unparseable destinations with blocked', async () => {
    const r = await handleDeepLink('garbage!!', makeDeps());
    expect(r.status).toBe('blocked');
  });

  it('navigates to a workspace when the editor is ready', async () => {
    const switchFn = vi.fn().mockResolvedValue(true);
    setCachedEditorContext(makeCtx({ requestWorkspaceSwitch: switchFn }));
    const r = await handleDeepLink('varve://navigate/workspace/logo', makeDeps());
    expect(switchFn).toHaveBeenCalledWith('logo');
    expect(r.status).toBe('completed');
  });

  it('parks the link until the document loads, then navigates', async () => {
    const switchFn = vi.fn().mockResolvedValue(true);
    // Editor mounted, but its document has not loaded yet.
    setCachedEditorContext(
      makeCtx({
        state: {
          document: { nodes: {}, pages: [] },
        } as unknown as NavigationEditorContext['state'],
      }),
    );

    const promise = handleDeepLink('varve://navigate/workspace/print', makeDeps());

    // Simulate the editor finishing load shortly after.
    setTimeout(() => {
      setCachedEditorContext(makeCtx({ requestWorkspaceSwitch: switchFn }));
    }, 50);

    const r = await promise;
    expect(switchFn).toHaveBeenCalledWith('print');
    expect(r.status).toBe('completed');
  }, 5000);

  it('times out when the document never loads', async () => {
    setCachedEditorContext(
      makeCtx({
        state: {
          document: { nodes: {}, pages: [] },
        } as unknown as NavigationEditorContext['state'],
      }),
    );
    const r = await handleDeepLink('varve://navigate/workspace/print', makeDeps({ timeoutMs: 60 }));
    expect(r.status).toBe('blocked');
  }, 2000);

  it('reports stale for a deleted page destination', async () => {
    setCachedEditorContext(makeCtx());
    const r = await handleDeepLink('varve://navigate/page/gone', makeDeps());
    expect(r.status).toBe('stale');
  });

  it('rejects hostile node ids', async () => {
    setCachedEditorContext(makeCtx());
    const r = await handleDeepLink('varve://navigate/node/../etc/passwd', makeDeps());
    expect(r.status).toBe('blocked');
  });
});

describe('setupDeepLinkListener — lifecycle', () => {
  beforeEach(() => {
    resetDeepLinkState();
    vi.restoreAllMocks();
  });

  it('returns a teardown that removes web listeners and cancels parked links', () => {
    const deps = vi.fn(() => makeDeps());
    const removeSpy = vi.spyOn(window, 'removeEventListener');
    const teardown = setupDeepLinkListener(deps);
    expect(removeSpy).not.toHaveBeenCalled();
    teardown();
    expect(removeSpy).toHaveBeenCalled();
  });

  it('does not throw when Tauri globals are absent', () => {
    expect(() => setupDeepLinkListener(() => makeDeps())).not.toThrow();
  });
});
