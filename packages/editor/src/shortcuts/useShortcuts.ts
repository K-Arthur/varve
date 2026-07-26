import { useCallback, useEffect, useRef, useState } from 'react';
import { getActionRegistry } from '../actions/ActionRegistry';
import { schedulePasteFallback } from '../clipboard';
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
      case 'toggleGraphEditor':
        return () => ref.current.toggleGraphEditor();
      case 'motionWorkspace':
        return () => ref.current.requestWorkspaceSwitch('motion');
      case 'playPause':
        return () => {
          if (ref.current.state.motion.isPlaying) ref.current.pauseTimeline();
          else ref.current.playTimeline();
        };
      case 'stopTimeline':
        return () => ref.current.stopTimeline();
      case 'stepForward':
        return () => {
          const tl = ref.current.state.motion.activeTimelineId
            ? ref.current.state.document.timelines?.[ref.current.state.motion.activeTimelineId]
            : null;
          if (tl)
            ref.current.seekTimeline(
              Math.min(tl.duration, ref.current.state.motion.currentTime + 100),
            );
        };
      case 'stepBackward':
        return () => {
          ref.current.seekTimeline(Math.max(0, ref.current.state.motion.currentTime - 100));
        };
      case 'addKeyframe':
        return () => {
          const sel = ref.current.state.selection;
          if (sel.length > 0) {
            ref.current.addKeyframeToSelected('opacity');
            ref.current.addKeyframeToSelected('rotation');
          }
        };
      case 'newAdjustmentLayer':
        return () => ref.current.createAdjustmentLayer();
      case 'flattenSelection':
        return () => ref.current.flattenSelected('flatten', 1);
      case 'archiveBackup':
        return () => ref.current.setShowArchiveDialog(true, 'backup');
      case 'archiveRestore':
        return () => ref.current.setShowArchiveDialog(true, 'restore');
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
        if (id === 'paste') {
          // Don't run the action or preventDefault here: letting the
          // browser deliver a `paste` ClipboardEvent gives the most
          // reliable clipboard read (Shell's window paste listener
          // captures it and runs the action). WebKitGTK never fires that
          // event outside editable elements, though, so schedule a
          // fallback that runs the action directly unless the real event
          // arrives first and cancels it (see clipboard.ts).
          schedulePasteFallback(() => {
            ref.current.recordAction('shortcut:paste');
            getHandler('paste')?.();
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
