import type { Document } from '@varve/scene';
import type { MenuEntry } from '@varve/ui';
import { useCallback, useMemo, useRef } from 'react';
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import { getAllMenuDefs, getCanvasContextMenuDefs } from './defs';
import { assertNoDuplicateAccelerators, lintSubmenuDepth } from './devGuard';
import {
  buildIntelFacts,
  computeDocumentFacts,
  computeSelectionFacts,
  detectPlatformFacts,
} from './facts';
import { formatLabel } from './localization';
import { menuPerfMark, timeMenuOperation } from './perfFlags';
import { renderMenubarItems, renderMenuItems } from './renderer';
import type { MenuContext, MenuContextId, MenuItemDef } from './types';

export type MenuActionHandler = (actionId: string) => void;

export interface UseMenuOptions {
  selection: string[];
  document: Document;
  workspaceMode: WorkspaceMode;
  platformKind?: string;
  runAction: MenuActionHandler;
  getTheme?: () => string;
  findingCount?: number;
  findingsBySeverity?: Record<string, number>;
  lastScanAt?: number | null;
  scanInProgress?: boolean;
  showAllMenuItems?: boolean;
}

export interface UseMenuReturn {
  menubarGroups: { id: string; items: MenuEntry[] }[];
  canvasContextMenuItems: MenuEntry[];
  allDefs: MenuItemDef[];
  ctx: MenuContext;
  renderForContext: (contexts: MenuContextId[]) => MenuEntry[];
}

const isDev = typeof process !== 'undefined' && process.env.NODE_ENV === 'development';

let _staticDefsCache: ReturnType<typeof getAllMenuDefs> | null = null;
let _staticDefsKey: object | null = null;

function getCachedDefs(opts: {
  runAction: (id: string) => void;
  getTheme?: () => string;
}): ReturnType<typeof getAllMenuDefs> {
  const key = opts.runAction;
  if (_staticDefsCache && _staticDefsKey === key) {
    return _staticDefsCache;
  }
  const defs = getAllMenuDefs(opts);
  _staticDefsCache = defs;
  _staticDefsKey = key;
  return defs;
}

export function useMenu(opts: UseMenuOptions): UseMenuReturn {
  const optsRef = useRef(opts);
  optsRef.current = opts;

  const ctx = useMemo(() => {
    const sf = computeSelectionFacts(opts.selection, opts.document.nodes);
    const df = computeDocumentFacts(opts.document, opts.selection[0] ?? null);
    df.hasSelection = sf.count > 0;
    df.hasMultipleSelection = sf.count >= 2;
    const pf = detectPlatformFacts(opts.platformKind);
    const intel = buildIntelFacts(undefined, opts.lastScanAt ?? null, opts.scanInProgress ?? false);

    return {
      selection: sf,
      document: df,
      workspace: opts.workspaceMode,
      platform: pf,
      intelligence: intel,
    } satisfies MenuContext;
  }, [
    opts.selection,
    opts.document,
    opts.workspaceMode,
    opts.platformKind,
    opts.lastScanAt,
    opts.scanInProgress,
  ]);

  const allDefs = useMemo(() => {
    const defs = getCachedDefs({
      runAction: opts.runAction,
      getTheme: opts.getTheme,
    });

    if (isDev) {
      assertNoDuplicateAccelerators([defs]);
      for (const m of defs) {
        if (m.items && Array.isArray(m.items)) {
          lintSubmenuDepth(m.items);
        }
      }
    }

    return defs;
  }, [opts.runAction, opts.getTheme]);

  const renderOpts = useMemo(
    () => ({
      ctx,
      run: opts.runAction,
      contexts: ['menubar'] as MenuContextId[],
      showAllMenuItems: opts.showAllMenuItems,
      formatLabel,
    }),
    [ctx, opts.runAction, opts.showAllMenuItems],
  );

  const menubarGroups = useMemo(
    () =>
      timeMenuOperation('renderMenubarItems', () => renderMenubarItems(allDefs, ctx, renderOpts)),
    [allDefs, ctx, renderOpts],
  );

  const canvasContextMenuItems = useMemo(() => {
    menuPerfMark('canvasContextMenu:render:start');
    const defs = getCanvasContextMenuDefs(opts.runAction);
    const result = renderMenuItems(defs, ctx, {
      ctx,
      run: opts.runAction,
      contexts: ['canvas'],
      showAllMenuItems: opts.showAllMenuItems,
    });
    menuPerfMark('canvasContextMenu:render:end');
    return result;
  }, [ctx, opts.runAction, opts.showAllMenuItems]);

  const renderForContext = useCallback(
    (contexts: MenuContextId[]) => {
      const defs = getCachedDefs({
        runAction: optsRef.current.runAction,
        getTheme: optsRef.current.getTheme,
      });
      return renderMenuItems(defs, ctx, {
        ctx,
        run: optsRef.current.runAction,
        contexts,
        showAllMenuItems: optsRef.current.showAllMenuItems,
      });
    },
    [ctx],
  );

  return {
    menubarGroups,
    canvasContextMenuItems,
    allDefs,
    ctx,
    renderForContext,
  };
}
