/**
 * @deprecated This component is no longer imported anywhere in the codebase. The workspace
 * switcher is now rendered inline within the Menubar components. Kept for reference only;
 * will be removed in a future release.
 *
 * WorkspaceSwitcher — mode switcher UI rendered in the Menubar.
 *
 * Displays four mode buttons (Design/Print/Draw/Photo) with icons and labels.
 * Clicking a mode switches the workspace. Keyboard shortcuts are shown in tooltips.
 *
 * Follows the Affinity Persona / Figma Dev Mode pattern:
 * icon + label buttons in the toolbar area, not text-only tabs.
 */

import { SOLID_CHROME_ICONS, SolidIcon, Tooltip } from '@strata/ui';
import { useCallback } from 'react';
import { useEditor } from '../context';
import {
  ALL_WORKSPACE_MODES,
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
  const label = WORKSPACE_LABELS[mode];
  const shortcut = WORKSPACE_SHORTCUTS[mode];

  const handleClick = useCallback(() => {
    onSwitch(mode);
  }, [mode, onSwitch]);

  // Direct mapping from workspace mode to SolidIcon name
  const WORKSPACE_SOLID_ICONS: Record<WorkspaceMode, keyof typeof SOLID_CHROME_ICONS> = {
    design: 'penTool',
    print: 'printer',
    drawing: 'paintBrush',
    image: 'image',
    motion: 'play',
    codegen: 'code',
  };
  const solidIcon = WORKSPACE_SOLID_ICONS[mode];

  return (
    <Tooltip label={`${label} (${shortcut})`}>
      <button
        type="button"
        className={`workspace-switcher__btn${isActive ? ' workspace-switcher__btn--active' : ''}`}
        aria-pressed={isActive}
        aria-label={`${label} workspace`}
        onClick={handleClick}
      >
        <SolidIcon name={SOLID_CHROME_ICONS[solidIcon]} size={16} />
        <span className="workspace-switcher__label">{label}</span>
      </button>
    </Tooltip>
  );
}

export function WorkspaceSwitcher({ className }: WorkspaceSwitcherProps) {
  const { state, requestWorkspaceSwitch } = useEditor();

  const handleSwitch = useCallback(
    (mode: WorkspaceMode) => {
      requestWorkspaceSwitch(mode);
    },
    [requestWorkspaceSwitch],
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
