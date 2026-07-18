/**
 * WorkspaceSwitcher — mode switcher UI rendered in the Menubar.
 *
 * Displays four mode buttons (Design/Print/Draw/Photo) with icons and labels.
 * Clicking a mode switches the workspace. Keyboard shortcuts are shown in tooltips.
 *
 * Follows the Affinity Persona / Figma Dev Mode pattern:
 * icon + label buttons in the toolbar area, not text-only tabs.
 */

import type { IconName } from '@strata/ui';
import { Icon, Tooltip } from '@strata/ui';
import { useCallback } from 'react';
import { useEditor } from '../context';
import { useWorkspaceSwitcher } from '../workspace/useWorkspace';
import {
  ALL_WORKSPACE_MODES,
  WORKSPACE_ICONS,
  WORKSPACE_LABELS,
  WORKSPACE_SHORTCUTS,
  type WorkspaceMode,
} from '../workspace/workspaceTypes';

interface WorkspaceSwitcherProps {
  /** Optional additional class name. */
  className?: string;
}

function ModeButton({
  mode,
  isActive,
  onSwitch,
}: {
  mode: WorkspaceMode;
  isActive: boolean;
  onSwitch: (mode: WorkspaceMode) => void;
}) {
  const icon = WORKSPACE_ICONS[mode];
  const label = WORKSPACE_LABELS[mode];
  const shortcut = WORKSPACE_SHORTCUTS[mode];

  const handleClick = useCallback(() => {
    onSwitch(mode);
  }, [mode, onSwitch]);

  return (
    <Tooltip label={`${label} (${shortcut})`}>
      <button
        type="button"
        className={`workspace-switcher__btn${isActive ? ' workspace-switcher__btn--active' : ''}`}
        aria-pressed={isActive}
        aria-label={`${label} workspace`}
        onClick={handleClick}
      >
        <Icon name={icon as IconName} size={14} />
        <span className="workspace-switcher__label">{label}</span>
      </button>
    </Tooltip>
  );
}

export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  const { state, setWorkspaceMode } = useEditor();
  const { switchMode } = useWorkspaceSwitcher();

  const handleSwitch = useCallback(
    (mode: WorkspaceMode) => {
      switchMode(
        // We need to pass the full context value, but we only need a subset.
        // useWorkspaceSwitcher expects EditorContextValue-shaped object.
        // Since we're calling from within the editor context, we can use
        // the context value directly.
        { state, setWorkspaceMode } as Parameters<typeof switchMode>[0],
        mode,
      );
    },
    [state, setWorkspaceMode, switchMode],
  );

  return (
    <div
      className={`workspace-switcher${className ? ` ${className}` : ''}`}
      role="radiogroup"
      aria-label="Workspace mode"
    >
      {ALL_WORKSPACE_MODES.map((mode) => (
        <ModeButton
          key={mode}
          mode={mode}
          isActive={state.workspaceMode === mode}
          onSwitch={handleSwitch}
        />
      ))}
    </div>
  );
}
