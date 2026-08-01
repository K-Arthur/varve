import { getPlatformInfo, shouldUseNativeMenu } from '@strata/platform';
import type { Document } from '@strata/scene';
import { useEffect, useMemo, useRef } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import { getAllMenuDefs, type MenuDefsOptions } from './defs';
import { buildIntelFacts, buildMenuContext, detectPlatformFacts } from './facts';
import { formatLabel } from './localization';
import {
  buildNativeMenuSpec,
  detectPlatform,
  isNativeMenuAvailable,
  scheduleNativeMenuUpdate,
  sendNativeMenuSpec,
} from './nativeAdapter';

export interface UseNativeMenuOptions {
  selection: string[];
  document: Document;
  workspaceMode: WorkspaceMode;
  platformKind?: string;
  runAction: (id: string) => void;
  getTheme?: () => string;
}

export function dispatchNativeMenuAction(action: string, runAction: (id: string) => void): void {
  const registered = getActionRegistry().get(action);
  if (registered) {
    registered.handler(undefined);
    return;
  }
  runAction(action);
}

export function useNativeMenu(opts: UseNativeMenuOptions): void {
  // The native application menu is a macOS convention. On Windows and Linux
  // the in-window custom menubar is authoritative — installing a native menu
  // there draws a stray OS menubar strip (GTK on Linux) above the webview
  // content, duplicating the in-window menubar and showing raw label keys.
  const useNativeMenu = shouldUseNativeMenu(getPlatformInfo());
  const available = useNativeMenu && isNativeMenuAvailable();
  const os = detectPlatform();

  const menuOpts: MenuDefsOptions = useMemo(
    () => ({ runAction: opts.runAction, getTheme: opts.getTheme }),
    [opts.runAction, opts.getTheme],
  );

  const allDefs = useMemo(() => getAllMenuDefs(menuOpts), [menuOpts]);

  const pf = useMemo(() => detectPlatformFacts(opts.platformKind), [opts.platformKind]);

  const ctx = useMemo(() => {
    const intel = buildIntelFacts(undefined, null, false);
    return buildMenuContext(opts.selection, opts.document, opts.workspaceMode, pf, intel);
  }, [opts.selection, opts.document, opts.workspaceMode, pf]);

  const spec = useMemo(
    () => buildNativeMenuSpec(allDefs, ctx, os, formatLabel),
    [allDefs, ctx, os],
  );

  const initialised = useRef(false);

  useEffect(() => {
    if (!available) return;
    if (!initialised.current) {
      initialised.current = true;
      sendNativeMenuSpec(spec);
    } else {
      scheduleNativeMenuUpdate(spec);
    }
  }, [available, spec]);

  useEffect(() => {
    if (!available) return;

    let unlisten: (() => void) | undefined;

    import('@tauri-apps/api/event')
      .then(({ listen }) => {
        listen<{ action: string }>('menu://action', (event) => {
          dispatchNativeMenuAction(event.payload.action, opts.runAction);
        }).then((fn) => {
          unlisten = fn;
        });
      })
      .catch(() => {});

    return () => {
      unlisten?.();
    };
  }, [available, opts.runAction]);
}
