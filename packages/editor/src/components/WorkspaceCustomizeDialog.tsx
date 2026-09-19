/**
 * WorkspaceCustomizeDialog — customize the current workspace's panels,
 * editor chrome, toolbar tools, inspector tabs, and status sections.
 *
 * Opens from View > Customize Workspace… or the command palette. Changes are
 * applied immediately and persisted per-workspace. A "Reset" button reverts
 * to built-in defaults (and leaves a recoverable snapshot in Manage Layouts).
 */
import { Button, Dialog, SearchField } from '@varve/ui';
import { useCallback, useMemo, useState } from 'react';
import { useEditor } from '../context';
import type { ToolId } from '../tools/toolRegistry';
import { ESSENTIAL_TOOL_IDS, getToolDefinition, toolLabel } from '../workspace/toolLabels';
import {
  useEffectiveWorkspaceConfig,
  useWorkspaceCustomizations,
} from '../workspace/useWorkspaceConfig';
import {
  setChromeOverride,
  setInspectorTabOverride,
  setStatusSectionOverride,
  setToolbarToolOverride,
  updateWorkspacePreferences,
} from '../workspace/workspaceStore';
import {
  CHROME_CONFIG_KEYS,
  CHROME_CONFIG_LABELS,
  type ChromeConfig,
  getToolbarToolIds,
  getWorkspaceConfig,
  type InspectorTabId,
  type PanelId,
  STATUS_SECTION_LABELS,
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
  const { state, setTool, setPanelVisible, resetWorkspaceToDefault, resetAllWorkspacesToDefaults } =
    useEditor();
  const effectiveConfig = useEffectiveWorkspaceConfig(state.workspaceMode);
  const customizations = useWorkspaceCustomizations();
  const mode = state.workspaceMode;
  const builtIn = getWorkspaceConfig(mode);
  const [confirmResetAll, setConfirmResetAll] = useState(false);
  const [toolSearch, setToolSearch] = useState('');

  const handleTogglePanel = useCallback(
    (panelId: PanelId, visible: boolean) => {
      // Explicit live set, not just the stored override: the dialog must
      // visibly change the surface (and record the preference) at once.
      setPanelVisible(panelId, visible);
    },
    [setPanelVisible],
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
      // Use the normal tool transition lifecycle before removing the active
      // button. This gives transient tools a chance to clean up and leaves a
      // visible escape route in the same render as the preference change.
      if (!visible && state.tool === toolId) setTool('select');
      updateWorkspacePreferences((prefs) => setToolbarToolOverride(prefs, mode, toolId, visible));
    },
    [mode, setTool, state.tool],
  );

  const handleToggleChrome = useCallback(
    (key: keyof ChromeConfig, visible: boolean) => {
      updateWorkspacePreferences((prefs) => setChromeOverride(prefs, mode, key, visible));
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
    { id: 'pagenav', label: 'Page Navigator' },
    { id: 'library', label: 'Resources' },
    { id: 'codegen', label: 'Code Panel' },
    { id: 'logo', label: 'Logo Panel' },
    { id: 'history', label: 'History' },
  ];

  const effectiveToolIdsSet = new Set(getToolbarToolIds(effectiveConfig.toolbar));
  const toolbarToolIds = getToolbarToolIds(builtIn.toolbar);
  const filteredToolbarTools = useMemo(() => {
    const query = toolSearch.trim().toLowerCase();
    return toolbarToolIds
      .map((id) => getToolDefinition(id))
      .filter((definition): definition is NonNullable<typeof definition> => {
        if (!definition) return false;
        if (!query) return true;
        return [definition.label, definition.category, ...(definition.aliases ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(query);
      });
  }, [toolSearch, toolbarToolIds]);
  const toolbarToolGroups = useMemo(() => {
    const groups = new Map<string, typeof filteredToolbarTools>();
    for (const definition of filteredToolbarTools) {
      const group = groups.get(definition.category) ?? [];
      group.push(definition);
      groups.set(definition.category, group);
    }
    return [...groups.entries()];
  }, [filteredToolbarTools]);

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

        {/* Editor chrome */}
        <section className="workspace-customize__section">
          <h3>Editor Chrome</h3>
          <p className="workspace-customize__hint">
            Chrome stays reachable through the menu and command palette when hidden.
          </p>
          {CHROME_CONFIG_KEYS.map((key) => (
            <label key={key} className="workspace-customize__toggle">
              <input
                type="checkbox"
                checked={effectiveConfig[key]}
                onChange={(e) => handleToggleChrome(key, e.target.checked)}
              />
              <span>{CHROME_CONFIG_LABELS[key]}</span>
            </label>
          ))}
        </section>

        {/* Toolbar tools */}
        <section className="workspace-customize__section">
          <h3>Toolbar Tools</h3>
          <p className="workspace-customize__hint">
            Choose what appears in this workspace. Hidden tools remain available from commands,
            menus, or shortcuts. Select, Hand, and Zoom stay available for recovery.
          </p>
          <SearchField
            value={toolSearch}
            onChange={setToolSearch}
            placeholder="Search tools..."
            aria-label="Search toolbar tools"
          />
          {toolbarToolGroups.length === 0 && (
            <p className="workspace-customize__empty">No toolbar tools match that search.</p>
          )}
          {toolbarToolGroups.map(([category, definitions]) => (
            <div key={category} className="workspace-customize__tool-group">
              <h4>{category.replace(/^[a-z]/, (letter) => letter.toUpperCase())}</h4>
              {definitions.map((definition) => {
                const toolId = definition.id as ToolId;
                const isVisible = effectiveToolIdsSet.has(toolId);
                const isEssential = ESSENTIAL_TOOL_IDS.has(toolId);
                const flyout = builtIn.toolbar.flyouts?.find((f) => f.tools.includes(toolId));
                const isFlyoutOnly =
                  flyout && !builtIn.toolbar.tools.some((t) => t.toolId === toolId);
                return (
                  <label key={toolId} className="workspace-customize__toggle">
                    <input
                      type="checkbox"
                      checked={isVisible}
                      disabled={isEssential}
                      aria-label={`Show ${toolLabel(toolId)} in ${WORKSPACE_LABELS[mode]} workspace${isEssential ? ' (always available)' : ''}`}
                      onChange={(e) => handleToggleTool(toolId, e.target.checked)}
                    />
                    <span>
                      {toolLabel(toolId)}
                      {isFlyoutOnly && (
                        <span className="workspace-customize__flyout">in {flyout.label}</span>
                      )}
                    </span>
                    {isEssential && (
                      <span className="workspace-customize__always">Always available</span>
                    )}
                  </label>
                );
              })}
            </div>
          ))}
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
          <Button
            variant="secondary"
            onClick={handleReset}
            disabled={!customizations[mode]}
            disabledReason="This workspace still uses its built-in defaults"
          >
            Reset {WORKSPACE_LABELS[mode]}
          </Button>
          <Button variant="destructive" onClick={() => setConfirmResetAll(true)}>
            Reset All Workspaces
          </Button>
          <Button onClick={onClose}>Done</Button>
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
          <Button variant="secondary" onClick={() => setConfirmResetAll(false)}>
            Cancel
          </Button>
          <Button variant="destructive" onClick={handleConfirmResetAll}>
            Reset All Workspaces
          </Button>
        </div>
      </Dialog>
    </Dialog>
  );
}
