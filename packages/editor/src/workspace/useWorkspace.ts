/**
 * @deprecated No callers remain. The app uses `useWorkspaceMode` from `context/useWorkspaceMode.ts`
 * instead. The exports from this file (`useWorkspaceSwitcher`, `createWorkspaceSnapshot`,
 * `getWorkspaceShortcutHint`, `matchWorkspaceShortcut`) are re-exported via `workspace/index.ts`,
 * but that barrel is itself never imported. `switchMode` and `cycleMode` are internal to
 * `useWorkspaceSwitcher` and are not called anywhere. This file will be removed in a future
 * release.
 *
 * useWorkspace — hook for safe workspace mode switching.
 *
 * Handles:
 * - Finishing/committing/cancelling in-progress interactions before switching
 * - Preserving document, selection, viewport, undo/redo, and unsaved state
 * - Avoiding remounting the editor or flashing an empty canvas
 * - Announcing mode changes for accessibility
 * - Persisting mode preference
 */

import { useCallback, useRef } from 'react';
import type { EditorContextValue } from '../context/types';
import {
  ALL_WORKSPACE_MODES,
  WORKSPACE_SHORTCUTS,
  type WorkspaceMode,
  type WorkspaceSnapshot,
} from './workspaceTypes';

/** Interaction states that must be resolved before switching. */
type InteractionState = 'idle' | 'editing-text' | 'cropping' | 'mask-editing' | 'modal-open';

/** Detect if the editor is in a state that blocks mode switching. */
function detectInteractionState(ctx: EditorContextValue): InteractionState {
  const { state } = ctx;

  // Modal/picker/popover open
  if (state.prototypeMode || state.isPresenting) return 'modal-open';

  // Text editing (nodeEdit tool active or a text edit overlay is focused)
  if (state.tool === 'nodeEdit') return 'editing-text';

  // Crop tool active
  if (state.tool === 'crop') return 'cropping';

  // Mask editing
  if (state.maskPreviewMode !== 'none') return 'mask-editing';

  return 'idle';
}

/** Safely finish or cancel in-progress interactions. */
function resolveInteraction(ctx: EditorContextValue, interaction: InteractionState): void {
  switch (interaction) {
    case 'editing-text':
      // Commit text edits and return to select
      ctx.setTool('select');
      break;
    case 'cropping':
      // Cancel crop and return to select
      ctx.setTool('select');
      break;
    case 'mask-editing':
      // Exit mask editing
      ctx.setTool('select');
      break;
    case 'modal-open':
      // Don't force-close modals — let user close them first
      break;
    default:
      break;
  }
}

/**
 * Create a snapshot of state that should be preserved across mode switches.
 * This is purely observational — it doesn't modify state.
 */
export function createWorkspaceSnapshot(
  ctx: EditorContextValue,
  nextMode: WorkspaceMode,
): WorkspaceSnapshot {
  return {
    previousMode: ctx.state.workspaceMode,
    nextMode,
    timestamp: Date.now(),
  };
}

/**
 * Switch workspace mode safely.
 *
 * This is a synchronous operation that:
 * 1. Detects in-progress interactions
 * 2. Safely resolves them (commit or cancel)
 * 3. Applies the new mode's config (panel visibility, default tool, overlays)
 * 4. Preserves document, selection, viewport, undo/redo, dirty state
 * 5. Announces the change for screen readers
 * 6. Persists the preference
 *
 * It does NOT:
 * - Remount the editor component
 * - Clear the canvas
 * - Reset document state
 * - Fork the scene model
 */
export function useWorkspaceSwitcher() {
  const inProgressRef = useRef(false);

  const switchMode = useCallback((ctx: EditorContextValue, nextMode: WorkspaceMode) => {
    // Prevent re-entrant switching
    if (inProgressRef.current) return;
    if (nextMode === ctx.state.workspaceMode) return;

    inProgressRef.current = true;

    try {
      // 1. Detect and resolve in-progress interactions
      const interaction = detectInteractionState(ctx);
      if (interaction !== 'idle' && interaction !== 'modal-open') {
        resolveInteraction(ctx, interaction);
      }

      // 2. Apply the new mode — __setWorkspaceModeUnsafe already:
      //    - Updates state.workspaceMode
      //    - Updates panel visibility (leftPanelVisible, rightPanelVisible, timelinePanelVisible)
      //    - Sets default tool (if configured)
      //    - Persists to settings
      //    - Announces for screen readers
      ctx.__setWorkspaceModeUnsafe(nextMode);

      // 4. Document, selection, viewport, undo/redo, dirty state are all
      //    preserved because __setWorkspaceModeUnsafe only patches workspace-related
      //    state fields — it does not touch document, selection, zoom, pan,
      //    undoStack, redoStack, or dirty.
    } finally {
      inProgressRef.current = false;
    }
  }, []);

  const cycleMode = useCallback(
    (ctx: EditorContextValue, direction: 1 | -1 = 1) => {
      const currentIdx = ALL_WORKSPACE_MODES.indexOf(ctx.state.workspaceMode);
      const nextIdx =
        (currentIdx + direction + ALL_WORKSPACE_MODES.length) % ALL_WORKSPACE_MODES.length;
      switchMode(ctx, ALL_WORKSPACE_MODES[nextIdx]!);
    },
    [switchMode],
  );

  return { switchMode, cycleMode };
}

/**
 * Get workspace keyboard shortcut description for a mode.
 */
export function getWorkspaceShortcutHint(mode: WorkspaceMode): string {
  return WORKSPACE_SHORTCUTS[mode] ?? '';
}

/**
 * Check if a keyboard event matches a workspace switching shortcut.
 * Returns the target mode or null.
 */
export function matchWorkspaceShortcut(event: KeyboardEvent): WorkspaceMode | null {
  // Normalize modifier keys
  const ctrl = event.ctrlKey || event.metaKey;
  const shift = event.shiftKey;

  if (!ctrl || !shift) return null;

  for (const [mode, shortcut] of Object.entries(WORKSPACE_SHORTCUTS)) {
    const parts = shortcut.split('+');
    const key = parts[parts.length - 1];
    if (key && event.key.toUpperCase() === key.toUpperCase()) {
      return mode as WorkspaceMode;
    }
  }

  return null;
}
