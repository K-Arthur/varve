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
  getWorkspacePreferences,
  setChromeOverride,
  setInspectorTabOrderOverride,
  setInspectorTabOverride,
  setInspectorTabPinnedOverride,
  setStatusSectionOrderOverride,
  setStatusSectionOverride,
  setToolbarToolLocationOverride,
  setToolbarToolOrderOverride,
  setToolbarToolOverride,
  setToolbarToolPinnedOverride,
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

function moveWithinOrder<T>(order: readonly T[], item: T, direction: -1 | 1): T[] {
  const index = order.indexOf(item);
  const nextIndex = index + direction;
  if (index < 0 || nextIndex < 0 || nextIndex >= order.length) return [...order];
  const next = [...order];
  [next[index], next[nextIndex]] = [next[nextIndex]!, next[index]!];
  return next;
}

function toolbarLocation(
  config: ReturnType<typeof getWorkspaceConfig>,
  toolId: ToolId,
): string | null {
  if (config.toolbar.tools.some((item) => item.toolId === toolId)) return null;
  return config.toolbar.flyouts?.find((flyout) => flyout.tools.includes(toolId))?.id ?? null;
}

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

  const handleMoveToolbarTool = useCallback(
    (toolId: ToolId, direction: -1 | 1) => {
      const prefs = getWorkspacePreferences();
      const current = prefs[mode]?.toolbarToolOrder ?? getToolbarToolIds(builtIn.toolbar);
      updateWorkspacePreferences((next) =>
        setToolbarToolOrderOverride(next, mode, moveWithinOrder(current, toolId, direction)),
      );
    },
    [builtIn.toolbar, mode],
  );

  const handleToolbarToolLocation = useCallback(
    (toolId: ToolId, location: string | null) => {
      updateWorkspacePreferences((prefs) =>
        setToolbarToolLocationOverride(prefs, mode, toolId, location),
      );
    },
    [mode],
  );

  const handlePinToolbarTool = useCallback(
    (toolId: ToolId, pinned: boolean) => {
      updateWorkspacePreferences((prefs) =>
        setToolbarToolPinnedOverride(prefs, mode, toolId, pinned),
      );
    },
    [mode],
  );

  const handleMoveInspectorTab = useCallback(
    (tabId: InspectorTabId, direction: -1 | 1) => {
      const prefs = getWorkspacePreferences();
      const current = prefs[mode]?.inspectorTabOrder ?? builtIn.inspectorTabs.map((tab) => tab.id);
      updateWorkspacePreferences((next) =>
        setInspectorTabOrderOverride(next, mode, moveWithinOrder(current, tabId, direction)),
      );
    },
    [builtIn.inspectorTabs, mode],
  );

  const handlePinInspectorTab = useCallback(
    (tabId: InspectorTabId, pinned: boolean) => {
      updateWorkspacePreferences((prefs) =>
        setInspectorTabPinnedOverride(prefs, mode, tabId, pinned),
      );
    },
    [mode],
  );

  const handleMoveStatusSection = useCallback(
    (sectionId: StatusSectionId, direction: -1 | 1) => {
      const prefs = getWorkspacePreferences();
      const current =
        prefs[mode]?.statusSectionOrder ?? builtIn.statusSections.map((section) => section.id);
      updateWorkspacePreferences((next) =>
        setStatusSectionOrderOverride(next, mode, moveWithinOrder(current, sectionId, direction)),
      );
    },
    [builtIn.statusSections, mode],
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
    { id: 'emailPreview', label: 'Email Preview' },
    { id: 'emailOutput', label: 'Email Output' },
  ];

  const effectiveToolIdsSet = new Set(getToolbarToolIds(effectiveConfig.toolbar));
  const toolbarToolIds = getToolbarToolIds(builtIn.toolbar);
  const workspacePreference = getWorkspacePreferences()[mode];
  const toolbarToolOrder = workspacePreference?.toolbarToolOrder ?? toolbarToolIds;
  const arrangedToolbarTools = toolbarToolOrder
    .map((id) => getToolDefinition(id))
    .filter((definition): definition is NonNullable<typeof definition> => {
      if (!definition) return false;
      const query = toolSearch.trim().toLowerCase();
      return (
        !query ||
        [definition.label, definition.category, ...(definition.aliases ?? [])]
          .join(' ')
          .toLowerCase()
          .includes(query)
      );
    });
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

        {/* Toolbar ordering, existing flyouts, and responsive retention */}
        <section className="workspace-customize__section">
          <h3>Toolbar Arrangement</h3>
          <p className="workspace-customize__hint">
            Move tools earlier or later, place them in the main row or an existing flyout, and pin
            tools that should stay visible when the toolbar overflows.
          </p>
          {arrangedToolbarTools.map((definition) => {
            const toolId = definition.id as ToolId;
            const orderIndex = toolbarToolOrder.indexOf(toolId);
            const isEssential = ESSENTIAL_TOOL_IDS.has(toolId);
            const locationOverrides = workspacePreference?.toolbarToolLocations ?? {};
            const location = Object.hasOwn(locationOverrides, toolId)
              ? (locationOverrides[toolId] ?? null)
              : toolbarLocation(builtIn, toolId);
            const pinned =
              isEssential || effectiveConfig.toolbarPinnedToolIds?.includes(toolId) === true;
            return (
              <div key={toolId} className="workspace-customize__arrangement-row">
                <span className="workspace-customize__arrangement-name">{toolLabel(toolId)}</span>
                <button
                  type="button"
                  aria-label={`Move ${toolLabel(toolId)} earlier`}
                  disabled={orderIndex <= 0}
                  onClick={() => handleMoveToolbarTool(toolId, -1)}
                >
                  Move up
                </button>
                <button
                  type="button"
                  aria-label={`Move ${toolLabel(toolId)} later`}
                  disabled={orderIndex >= toolbarToolIds.length - 1}
                  onClick={() => handleMoveToolbarTool(toolId, 1)}
                >
                  Move down
                </button>
                <label className="workspace-customize__arrangement-select">
                  <span className="sr-only">Show {toolLabel(toolId)} in</span>
                  <select
                    aria-label={`Show ${toolLabel(toolId)} in`}
                    value={location ?? 'toolbar'}
                    disabled={isEssential}
                    onChange={(event) =>
                      handleToolbarToolLocation(
                        toolId,
                        event.target.value === 'toolbar' ? null : event.target.value,
                      )
                    }
                  >
                    <option value="toolbar">Main toolbar</option>
                    {(builtIn.toolbar.flyouts ?? []).map((flyout) => (
                      <option key={flyout.id} value={flyout.id}>
                        {flyout.label}
                      </option>
                    ))}
                  </select>
                </label>
                <label className="workspace-customize__pin">
                  <input
                    type="checkbox"
                    checked={pinned}
                    disabled={isEssential}
                    aria-label={`Keep ${toolLabel(toolId)} visible when the toolbar overflows${isEssential ? ' (always available)' : ''}`}
                    onChange={(event) => handlePinToolbarTool(toolId, event.target.checked)}
                  />
                  <span>Pin</span>
                </label>
              </div>
            );
          })}
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
                const locationOverrides = workspacePreference?.toolbarToolLocations ?? {};
                const location = Object.hasOwn(locationOverrides, toolId)
                  ? (locationOverrides[toolId] ?? null)
                  : toolbarLocation(builtIn, toolId);
                const flyout = builtIn.toolbar.flyouts?.find(
                  (candidate) => candidate.id === location,
                );
                const isFlyoutOnly = flyout !== undefined;
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
          <p className="workspace-customize__hint">
            Reorder tabs or pin important tabs so they remain available before responsive overflow.
          </p>
          {effectiveConfig.inspectorTabs.map((tab, index) => (
            <div key={tab.id} className="workspace-customize__arrangement-row">
              <label className="workspace-customize__toggle">
                <input
                  type="checkbox"
                  checked={tab.visible}
                  onChange={(e) => handleToggleInspectorTab(tab.id, e.target.checked)}
                />
                <span>{tab.label}</span>
              </label>
              <button
                type="button"
                aria-label={`Move ${tab.label} tab earlier`}
                disabled={index === 0}
                onClick={() => handleMoveInspectorTab(tab.id, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                aria-label={`Move ${tab.label} tab later`}
                disabled={index === effectiveConfig.inspectorTabs.length - 1}
                onClick={() => handleMoveInspectorTab(tab.id, 1)}
              >
                Move down
              </button>
              <label className="workspace-customize__pin">
                <input
                  type="checkbox"
                  checked={tab.overflowPriority === 0}
                  aria-label={`Keep ${tab.label} tab visible before overflow`}
                  onChange={(event) => handlePinInspectorTab(tab.id, event.target.checked)}
                />
                <span>Pin</span>
              </label>
            </div>
          ))}
        </section>

        {/* Status sections */}
        <section className="workspace-customize__section">
          <h3>Status Bar Sections</h3>
          {effectiveConfig.statusSections.map((section, index) => (
            <div key={section.id} className="workspace-customize__arrangement-row">
              <label className="workspace-customize__toggle">
                <input
                  type="checkbox"
                  checked={section.visible}
                  onChange={(e) => handleToggleStatusSection(section.id, e.target.checked)}
                />
                <span>{STATUS_SECTION_LABELS[section.id]}</span>
              </label>
              <button
                type="button"
                aria-label={`Move ${STATUS_SECTION_LABELS[section.id]} earlier`}
                disabled={index === 0}
                onClick={() => handleMoveStatusSection(section.id, -1)}
              >
                Move up
              </button>
              <button
                type="button"
                aria-label={`Move ${STATUS_SECTION_LABELS[section.id]} later`}
                disabled={index === effectiveConfig.statusSections.length - 1}
                onClick={() => handleMoveStatusSection(section.id, 1)}
              >
                Move down
              </button>
            </div>
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

      {/* Reset All is destructive across all six workspaces — require an explicit
          confirmation before discarding every customization. */}
      <Dialog
        open={confirmResetAll}
        onClose={() => setConfirmResetAll(false)}
        title="Reset all workspaces?"
        dismissible={false}
      >
        <p>
          This discards every panel, toolbar, inspector, and status-bar customization in all six
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
