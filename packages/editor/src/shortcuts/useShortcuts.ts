import { useCallback, useEffect, useRef, useState } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import type { EditorContextValue } from '../context';
import {
  bindingMatchesEvent,
  getEffectiveBinding,
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
    if (action) return action.handler as () => void;

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
      default:
        return null;
    }
  }, []);

  useEffect(() => {
    const handler = (e: KeyboardEvent) => {
      if (!enabledRef.current) return;
      if (e.defaultPrevented) return;
      if (shouldIgnoreShortcutTarget(e.target as Element | null)) return;

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

      for (const [id, _def] of Object.entries(SHORTCUT_DEFS)) {
        const binding = getEffectiveBinding(id);
        if (!binding?.key || !bindingMatchesEvent(e, binding)) continue;
        if (id === 'paste') {
          return;
        }
        e.preventDefault();
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
    window.addEventListener('keydown', handler);
    return () => window.removeEventListener('keydown', handler);
  }, [getHandler]);

  return {
    paletteOpen,
    closePalette: () => setPaletteOpen(false),
    openPalette: () => setPaletteOpen(true),
    quickActionsOpen,
    setQuickActionsOpen,
  };
}
