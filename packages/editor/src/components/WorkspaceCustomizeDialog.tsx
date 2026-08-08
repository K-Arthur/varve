/**
 * WorkspaceCustomizeDialog — customize the current workspace's panels,
 * inspector tabs, and status sections.
 *
 * Opens from the workspace overflow menu or the View menu. Changes are
 * applied immediately and persisted per-workspace. A "Reset" button
 * reverts to built-in defaults.
 */
import { Dialog } from '@varve/ui';
import { useCallback } from 'react';
import { useEditor } from '../context';
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
  type StatusSectionId,
  WORKSPACE_LABELS,
} from '../workspace/workspaceTypes';

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

  const handleResetAll = useCallback(() => {
    resetAllWorkspacesToDefaults();
    onClose();
  }, [resetAllWorkspacesToDefaults, onClose]);

  // Panel definitions with labels
  const panels: { id: PanelId; label: string }[] = [
    { id: 'layers', label: 'Layers' },
    { id: 'inspector', label: 'Inspector' },
    { id: 'timeline', label: 'Timeline' },
    { id: 'pagenav', label: 'Page Navigation' },
    { id: 'library', label: 'Resources' },
    { id: 'codegen', label: 'Code Panel' },
    { id: 'logo', label: 'Logo Panel' },
  ];

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
          {builtIn.toolbar.tools.map((tool) => {
            const isVisible = effectiveConfig.toolbar.tools.some((t) => t.toolId === tool.toolId);
            return (
              <label key={tool.toolId} className="workspace-customize__toggle">
                <input
                  type="checkbox"
                  checked={isVisible}
                  onChange={(e) => handleToggleTool(tool.toolId, e.target.checked)}
                />
                <span>{tool.toolId}</span>
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
              <span>{section.id}</span>
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
          <button type="button" className="varve-btn varve-btn--danger" onClick={handleResetAll}>
            Reset All Workspaces
          </button>
          <button type="button" className="varve-btn varve-btn--primary" onClick={onClose}>
            Done
          </button>
        </div>
      </div>
    </Dialog>
  );
}
