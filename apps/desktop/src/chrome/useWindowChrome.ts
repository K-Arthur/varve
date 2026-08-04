/**
 * useWindowChrome — live window-chrome state for the desktop app.
 *
 * Bridges Tauri window events into the canonical `WindowChromeState` model
 * from `@varve/platform`. The strategy is resolved once (from the platform
 * snapshot); the dynamic fields (focus, maximize, fullscreen, resizable,
 * scale) are driven by real window events, never guessed at startup.
 *
 * When the resolved strategy does not use a custom title bar (macOS /
 * Windows native decorations, browser), no subscriptions are created and the
 * initial state is returned untouched — the browser build never touches the
 * Tauri window API.
 */

import {
  createInitialChromeState,
  getPlatformInfo,
  resolveWindowChromeStrategy,
  updateChromeState,
  type WindowChromeState,
  type WindowEvent,
} from '@varve/platform';
import { useEffect, useMemo, useState } from 'react';

function partialToEvents(partial: Partial<WindowChromeState>): WindowEvent[] {
  const events: WindowEvent[] = [];
  if (partial.isFocused !== undefined) {
    events.push({ type: 'focus', focused: partial.isFocused });
  }
  if (partial.isMaximized !== undefined) {
    events.push({ type: 'maximize', maximized: partial.isMaximized });
  }
  if (partial.isFullscreen !== undefined) {
    events.push({ type: 'fullscreen', fullscreen: partial.isFullscreen });
  }
  if (partial.isResizable !== undefined) {
    events.push({ type: 'resizable', resizable: partial.isResizable });
  }
  if (partial.scaleFactor !== undefined) {
    events.push({ type: 'scale', scaleFactor: partial.scaleFactor });
  }
  if (partial.title !== undefined) {
    events.push({ type: 'title', title: partial.title });
  }
  return events;
}

export function useWindowChrome(title: string): WindowChromeState {
  const platform = useMemo(() => getPlatformInfo(), []);
  const strategy = useMemo(() => resolveWindowChromeStrategy(platform), [platform]);

  const [state, setState] = useState<WindowChromeState>(() =>
    createInitialChromeState(strategy, title),
  );

  const customChrome = strategy.showCustomTitleBar;

  useEffect(() => {
    if (!customChrome) return;

    let disposed = false;
    const unlisteners: Array<() => void> = [];

    const apply = (updates: Partial<WindowChromeState>) => {
      if (disposed) return;
      const events = partialToEvents(updates);
      if (events.length === 0) return;
      setState((current) => events.reduce(updateChromeState, current));
    };

    import('@tauri-apps/api/window')
      .then(({ getCurrentWindow }) => {
        if (disposed) return;
        const win = getCurrentWindow();

        const track = (promise: Promise<() => void>): void => {
          promise
            .then((unlisten) => {
              if (disposed) unlisten();
              else unlisteners.push(unlisten);
            })
            .catch(() => {});
        };

        // Reconcile maximize/fullscreen after any resize or move (also fires
        // on tile/snap state changes).
        const syncGeometry = async () => {
          if (disposed) return;
          const [maximized, fullscreen] = await Promise.all([
            win.isMaximized().catch(() => false),
            win.isFullscreen().catch(() => false),
          ]);
          apply({ isMaximized: maximized, isFullscreen: fullscreen });
        };

        track(
          win.onResized(() => {
            void syncGeometry();
          }),
        );
        track(
          win.onMoved(() => {
            void syncGeometry();
          }),
        );
        track(
          win.onFocusChanged(({ payload: focused }) => {
            apply({ isFocused: focused });
          }),
        );
        track(
          win.onScaleChanged(({ payload }) => {
            apply({ scaleFactor: payload.scaleFactor });
          }),
        );

        // Initial reconciliation + capability snapshot.
        Promise.all([
          win.isMaximized().catch(() => false),
          win.isFullscreen().catch(() => false),
          win.isFocused().catch(() => true),
          win.isResizable().catch(() => true),
          win.isMinimizable().catch(() => true),
          win.isMaximizable().catch(() => true),
          win.isClosable().catch(() => true),
        ]).then(
          ([
            isMaximized,
            isFullscreen,
            isFocused,
            isResizable,
            canMinimize,
            canMaximize,
            canClose,
          ]) => {
            if (disposed) return;
            apply({
              isMaximized,
              isFullscreen,
              isFocused,
              isResizable,
              canMinimize,
              canMaximize,
              canClose,
            });
          },
        );
      })
      .catch(() => {});

    return () => {
      disposed = true;
      for (const unlisten of unlisteners) unlisten();
    };
  }, [customChrome]);

  return state;
}
