/**
 * WorkspaceCustomizeDialog — customize the current workspace's panels,
 * inspector tabs, and status sections.
 *
 * Opens from the workspace overflow menu or the View menu. Changes are
 * applied immediately and persisted per-workspace. A "Reset" button
 * reverts to built-in defaults.
 */
import { Dialog } from '@varve/ui';
import { useCallback, useState } from 'react';
import { useEditor } from '../context';
import type { ToolId } from '../tools/types';
import { ESSENTIAL_TOOL_IDS, toolLabel } from '../workspace/toolLabels';
import {
  useEffectiveWorkspaceConfig,
  useWorkspaceCustomizations,
} from '../workspace/useWorkspaceConfig';
import {
  setInspectorTabOverride,
  setPanelOverride,
  setStatusSectionOverride,
  setToolbarToolOverride,
  updateWorkspacePreferences,
} from '../workspace/workspaceStore';
import {
  getWorkspaceConfig,
  type InspectorTabId,
  type PanelId,
  STATUS_SECTION_LABELS,
  type StatusSectionId,
  type ToolbarConfig,
  WORKSPACE_LABELS,
  type WorkspaceConfig,
} from '../workspace/workspaceTypes';

/**
 * All tools a workspace's toolbar can show: main row in declared order,
 * then flyout members not already in the main row (flyout order, first
 * flyout wins on overlaps).
 */
function allToolbarTools(toolbar: ToolbarConfig): string[] {
  const seen = new Set<string>();
  const result: string[] = [];
  for (const item of toolbar.tools) {
    if (!seen.has(item.toolId)) {
      seen.add(item.toolId);
      result.push(item.toolId);
    }
  }
  for (const flyout of toolbar.flyouts ?? []) {
    for (const toolId of flyout.tools) {
      if (!seen.has(toolId)) {
        seen.add(toolId);
        result.push(toolId);
      }
    }
  }
  return result;
}

/**
 * The effective toolbar's full tool id set (main row + flyout members).
 */
function effectiveToolIds(effectiveConfig: WorkspaceConfig): Set<string> {
  const ids = new Set<string>(effectiveConfig.toolbar.tools.map((t) => t.toolId));
  for (const flyout of effectiveConfig.toolbar.flyouts ?? []) {
    for (const toolId of flyout.tools) ids.add(toolId);
  }
  return ids;
}

export function WorkspaceCustomizeDialog({
  open,
  onClose,
}: {
  open: boolean;
  onClose: () => void;
}) {
  const { state, resetWorkspaceToDefault, resetAllWorkspacesToDefaults } = useEditor();
  const effectiveConfig = useEffectiveWorkspaceConfig(state.workspaceMode);
  const customizations = useWorkspaceCustomizations();
  const mode = state.workspaceMode;
  const builtIn = getWorkspaceConfig(mode);
  const [confirmResetAll, setConfirmResetAll] = useState(false);

  const handleTogglePanel = useCallback(
    (panelId: PanelId, visible: boolean) => {
      updateWorkspacePreferences((prefs) => setPanelOverride(prefs, mode, panelId, { visible }));
    },
    [mode],
  );

  const handleToggleInspectorTab = useCallback(
    (tabId: InspectorTabId, visible: boolean) => {
      updateWorkspacePreferences((prefs) => setInspectorTabOverride(prefs, mode, tabId, visible));
    },
    [mode],
  );

  const handleToggleStatusSection = useCallback(
    (sectionId: StatusSectionId, visible: boolean) => {
      updateWorkspacePreferences((prefs) =>
        setStatusSectionOverride(prefs, mode, sectionId, visible),
      );
    },
    [mode],
  );

  const handleToggleTool = useCallback(
    (toolId: string, visible: boolean) => {
      updateWorkspacePreferences((prefs) => setToolbarToolOverride(prefs, mode, toolId, visible));
    },
    [mode],
  );

  const handleReset = useCallback(() => {
    resetWorkspaceToDefault();
    onClose();
  }, [resetWorkspaceToDefault, onClose]);

  const handleConfirmResetAll = useCallback(() => {
    resetAllWorkspacesToDefaults();
    setConfirmResetAll(false);
    onClose();
  }, [resetAllWorkspacesToDefaults, onClose]);

  // Panel definitions with labels — every PanelId must appear here; the list
  // is validated by WorkspaceCustomizeDialog.test.tsx against the union.
  const panels: { id: PanelId; label: string }[] = [
    { id: 'layers', label: 'Layers' },
    { id: 'inspector', label: 'Inspector' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'pagenav', label: 'Page Navigation' },
    { id: 'library', label: 'Resources' },
    { id: 'codegen', label: 'Code Panel' },
    { id: 'logo', label: 'Logo Panel' },
    { id: 'history', label: 'History' },
  ];

  const effectiveToolIdsSet = effectiveToolIds(effectiveConfig);
  const toolbarTools = allToolbarTools(builtIn.toolbar);

  return (
    <Dialog open={open} onClose={onClose} title={`Customize ${WORKSPACE_LABELS[mode]} workspace`}>
      <div className="workspace-customize">
        <h2 className="workspace-customize__title">Customize {WORKSPACE_LABELS[mode]} Workspace</h2>
        <p className="workspace-customize__description">{builtIn.onboarding.description}</p>

        {/* Panel visibility */}
        <section className="workspace-customize__section">
          <h3>Panels</h3>
          {panels.map((panel) => (
            <label key={panel.id} className="workspace-customize__toggle">
              <input
                type="checkbox"
                checked={effectiveConfig.panels[panel.id].visible}
                onChange={(e) => handleTogglePanel(panel.id, e.target.checked)}
              />
              <span>{panel.label}</span>
            </label>
          ))}
        </section>

        {/* Toolbar tools */}
        <section className="workspace-customize__section">
          <h3>Toolbar Tools</h3>
          <p className="workspace-customize__hint">
            Select, Hand, and Zoom stay available so the canvas can always be navigated and
            recovered.
          </p>
          {toolbarTools.map((toolId) => {
            const isVisible = effectiveToolIdsSet.has(toolId);
            const isEssential = ESSENTIAL_TOOL_IDS.has(toolId as ToolId);
            const flyout = builtIn.toolbar.flyouts?.find((f) => f.tools.includes(toolId as ToolId));
            return (
              <label key={toolId} className="workspace-customize__toggle">
                <input
                  type="checkbox"
                  checked={isVisible}
                  disabled={isEssential}
                  aria-label={`${toolLabel(toolId)} toolbar tool${isEssential ? ' (always available)' : ''}`}
                  onChange={(e) => handleToggleTool(toolId, e.target.checked)}
                />
                <span>
                  {toolLabel(toolId)}
                  {flyout && !builtIn.toolbar.tools.some((t) => t.toolId === toolId) && (
                    <span className="workspace-customize__flyout">in {flyout.label}</span>
                  )}
                </span>
                {isEssential && (
                  <span className="workspace-customize__always">Always available</span>
                )}
              </label>
            );
          })}
        </section>

        {/* Inspector tabs */}
        <section className="workspace-customize__section">
          <h3>Inspector Tabs</h3>
          {effectiveConfig.inspectorTabs.map((tab) => (
            <label key={tab.id} className="workspace-customize__toggle">
              <input
                type="checkbox"
                checked={tab.visible}
                onChange={(e) => handleToggleInspectorTab(tab.id, e.target.checked)}
              />
              <span>{tab.label}</span>
            </label>
          ))}
        </section>

        {/* Status sections */}
        <section className="workspace-customize__section">
          <h3>Status Bar Sections</h3>
          {effectiveConfig.statusSections.map((section) => (
            <label key={section.id} className="workspace-customize__toggle">
              <input
                type="checkbox"
                checked={section.visible}
                onChange={(e) => handleToggleStatusSection(section.id, e.target.checked)}
              />
              <span>{STATUS_SECTION_LABELS[section.id]}</span>
            </label>
          ))}
        </section>

        {/* Actions */}
        <div className="workspace-customize__actions">
          <button
            type="button"
            className="varve-btn varve-btn--secondary"
            onClick={handleReset}
            disabled={!customizations[mode]}
          >
            Reset {WORKSPACE_LABELS[mode]}
          </button>
          <button
            type="button"
            className="varve-btn varve-btn--danger"
            onClick={() => setConfirmResetAll(true)}
          >
            Reset All Workspaces
          </button>
          <button type="button" className="varve-btn varve-btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>

      {/* Reset All is destructive across all seven modes — require an explicit
          confirmation before discarding every customization. */}
      <Dialog
        open={confirmResetAll}
        onClose={() => setConfirmResetAll(false)}
        title="Reset all workspaces?"
        dismissible={false}
      >
        <p>
          This discards every panel, toolbar, inspector, and status-bar customization in all
          workspaces and restores the built-in defaults. This cannot be undone.
        </p>
        <div className="workspace-customize__actions">
          <button
            type="button"
            className="varve-btn varve-btn--secondary"
            onClick={() => setConfirmResetAll(false)}
          >
            Cancel
          </button>
          <button
            type="button"
            className="varve-btn varve-btn--danger"
            onClick={handleConfirmResetAll}
          >
            Reset All Workspaces
          </button>
        </div>
      </Dialog>
    </Dialog>
  );
}
