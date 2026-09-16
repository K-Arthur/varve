import { useCallback, useEffect, useRef, useState } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import { createTransferRequest, schedulePasteFallback } from '../clipboard';
import type { EditorContextValue } from '../context';
import {
  bindingMatchesEvent,
  getEffectiveBinding,
  isNativeActivationKeyTarget,
  SHORTCUT_DEFS,
  shouldIgnoreShortcutTarget,
} from './ShortcutManager';

export interface EditorHelpActions {
  onOpenContextualHelp?: () => void;
  onOpenHelpCenter?: () => void;
}

export function useShortcuts(
  editor: EditorContextValue,
  onBackToHome?: () => void,
  enabled = true,
  helpActions?: EditorHelpActions,
): {
  paletteOpen: boolean;
  closePalette: () => void;
  openPalette: () => void;
  quickActionsOpen: boolean;
  setQuickActionsOpen: (open: boolean) => void;
} {
  const ref = useRef(editor);
  ref.current = editor;

  const onBackToHomeRef = useRef(onBackToHome);
  onBackToHomeRef.current = onBackToHome;

  const helpActionsRef = useRef(helpActions);
  helpActionsRef.current = helpActions;

  const enabledRef = useRef(enabled);
  enabledRef.current = enabled;

  const [paletteOpen, setPaletteOpen] = useState(false);
  const [quickActionsOpen, setQuickActionsOpen] = useState(false);

  const getHandler = useCallback((id: string): (() => void) | null => {
    const registry = getActionRegistry();
    const action = registry.get(id);
    if (action && !action.placeholder) return action.handler as () => void;

    switch (id) {
      case 'shortcutPalette':
        return () => setPaletteOpen((p) => !p);
      case 'quickActions':
        return () => setQuickActionsOpen((p) => !p);
      case 'home':
        return () => onBackToHomeRef.current?.();
      case 'openHelp':
        return () => helpActionsRef.current?.onOpenContextualHelp?.();
      case 'openHelpCenter':
        return () => helpActionsRef.current?.onOpenHelpCenter?.();
      case 'motionWorkspace':
        return () => {
          const registry = getActionRegistry();
          const wsAction = registry.get('workspaceMotion');
          if (wsAction && !wsAction.placeholder) wsAction.handler(undefined);
        };
      default:
        return null;
    }
  }, []);

  useEffect(() => {
    // Browsers can reserve Ctrl/Cmd+Z for native editing before a bubbling
    // window listener sees it. Undo/redo are global editor commands, but only
    // when focus is not in a real text/widget context. Capture these two
    // bindings early so canvas editing does not silently lose its first undo;
    // leave every other shortcut on the normal bubble path, which lets tools
    // such as NodeEditTool consume Escape/V/arrow keys first.
    const captureHistoryShortcut = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (e.defaultPrevented || shouldIgnoreShortcutTarget(e.target as Element | null)) return;
      if (e.isComposing) return;

      const id = bindingMatchesEvent(e, getEffectiveBinding('undo'))
        ? 'undo'
        : bindingMatchesEvent(e, getEffectiveBinding('redo'))
          ? 'redo'
          : null;
      if (!id) return;

      e.preventDefault();
      e.stopPropagation();
      ref.current.recordAction(`shortcut:${id}`);
      if (id === 'undo') ref.current.undo();
      else ref.current.redo();
    };

    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (e.defaultPrevented) return;
      if (shouldIgnoreShortcutTarget(e.target as Element | null)) return;
      if (e.isComposing) return;

      const editor = ref.current;
      const guideId = editor.state.selectedGuideId;
      if (guideId && !e.ctrlKey && !e.metaKey && !e.altKey) {
        const step = e.shiftKey ? 10 : 1;
        if (e.key === 'ArrowLeft') {
          e.preventDefault();
          editor.nudgeSelectedGuide(-step, 0);
          return;
        }
        if (e.key === 'ArrowRight') {
          e.preventDefault();
          editor.nudgeSelectedGuide(step, 0);
          return;
        }
        if (e.key === 'ArrowUp') {
          e.preventDefault();
          editor.nudgeSelectedGuide(0, -step);
          return;
        }
        if (e.key === 'ArrowDown') {
          e.preventDefault();
          editor.nudgeSelectedGuide(0, step);
          return;
        }
        if (e.key === 'Escape') {
          e.preventDefault();
          editor.setSelectedGuideId(null);
          return;
        }
        if (e.key === 'Delete' || e.key === 'Backspace') {
          e.preventDefault();
          editor.removeGuide(guideId);
          editor.setSelectedGuideId(null);
          return;
        }
      }

      if (e.key === 'Escape' && editor.state.isolatedNodeId) {
        e.preventDefault();
        const isolatedNodeId = editor.state.isolatedNodeId;
        editor.exitIsolation();
        editor.setSelection(isolatedNodeId);
        editor.announceOperation('Exit isolation', 'Clipping group');
        return;
      }

      for (const [id, def] of Object.entries(SHORTCUT_DEFS)) {
        if ('context' in def && def.context === 'canvas') continue;
        const binding = getEffectiveBinding(id);
        if (!binding?.key || !bindingMatchesEvent(e, binding)) continue;
        // Bare Space activates a focused button/summary natively. Global
        // bindings (Play/Pause) must not swallow that activation; modified
        // Space chords still dispatch normally.
        if (
          binding.key === ' ' &&
          !binding.ctrl &&
          !binding.shift &&
          !binding.alt &&
          isNativeActivationKeyTarget(e.target as Element | null)
        ) {
          continue;
        }
        if (id === 'paste') {
          // Don't run the action or preventDefault here: letting the
          // browser deliver a `paste` ClipboardEvent gives the most
          // reliable clipboard read (Shell's window paste listener
          // captures it and runs the action). WebKitGTK never fires that
          // event outside editable elements, though, so schedule a
          // fallback that runs the action directly unless the real event
          // arrives first and cancels it (see clipboard.ts).
          const request = createTransferRequest('paste');
          schedulePasteFallback(request, () => {
            ref.current.recordAction('shortcut:paste');
            ref.current.paste(request);
          });
          return;
        }
        e.preventDefault();
        editor.recordAction(`shortcut:${id}`);
        getHandler(id)?.();
        return;
      }

      if (
        !e.repeat &&
        !e.ctrlKey &&
        !e.metaKey &&
        !e.altKey &&
        (e.key === 'Delete' || e.key === 'Del')
      ) {
        e.preventDefault();
        ref.current.removeSelected();
      }
    };
    window.addEventListener('keydown', captureHistoryShortcut, true);
    window.addEventListener('keydown', handler);
    return () => {
      window.removeEventListener('keydown', captureHistoryShortcut, true);
      window.removeEventListener('keydown', handler);
    };
  }, [getHandler]);

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
    openPalette: () => setPaletteOpen(true),
    quickActionsOpen,
    setQuickActionsOpen,
  };
}
