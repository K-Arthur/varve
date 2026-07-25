import { useEffect, useMemo, useRef } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import type { WorkspaceMode } from '../workspace/workspaceTypes';
import { getAllMenuDefs, type MenuDefsOptions } from './defs';
import { buildIntelFacts, buildMenuContext, detectPlatformFacts } from './facts';
import {
  buildNativeMenuSpec,
  detectPlatform,
  isNativeMenuAvailable,
  scheduleNativeMenuUpdate,
  sendNativeMenuSpec,
} from './nativeAdapter';

export interface UseNativeMenuOptions {
  selection: string[];
  document: {
    nodes: Record<string, unknown>;
    pages?: unknown[];
    masters?: Record<string, unknown>;
    name?: string;
  };
  workspaceMode: WorkspaceMode;
  platformKind?: string;
  runAction: (id: string) => void;
  getTheme?: () => string;
}

export function useNativeMenu(opts: UseNativeMenuOptions): void {
  const available = isNativeMenuAvailable();
  const os = detectPlatform();

  const menuOpts: MenuDefsOptions = useMemo(
    () => ({ runAction: opts.runAction, getTheme: opts.getTheme }),
    [opts.runAction, opts.getTheme],
  );

  const allDefs = useMemo(() => getAllMenuDefs(menuOpts), [menuOpts]);

  const pf = useMemo(() => detectPlatformFacts(opts.platformKind), [opts.platformKind]);

  const ctx = useMemo(() => {
    const intel = buildIntelFacts(undefined, null, false);
    return buildMenuContext(opts.selection, opts.document as any, opts.workspaceMode, pf, intel);
  }, [opts.selection, opts.document, opts.workspaceMode, pf]);

  const spec = useMemo(() => buildNativeMenuSpec(allDefs, ctx, os, undefined), [allDefs, ctx, os]);

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
          const { action } = event.payload;

          const registry = getActionRegistry();
          const registered = registry.get(action);
          if (registered) {
            (registered.handler as () => void)();
            return;
          }

          if (action === 'settings') {
            opts.runAction('settings');
          }
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
