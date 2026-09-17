/**
 * PropertiesPanel — the fully-featured Inspector for Strata.
 *
 * Orchestrates all sections based on selection state (empty/single/multi).
 * Maps to the right-side inspector slot in Shell's CSS Grid.
 *
 * Uses the section registry for centralized collapse/hidden state. Each
 * DisclosureSection receives a `sectionId` linking it to the shared
 * SectionVisibilityState in EditorState.
 *
 * Research basis: Figma/Sketch right-sidebar inspector; APG Disclosure,
 * Spinbutton, Combobox, Radiogroup, Slider patterns.
 */
import {
  canHaveLayerEffects,
  canHaveSmartFilters,
  type ExportPreset,
  isExportRegion,
  isImageShape,
  type SceneNode,
} from '@varve/scene';
import { Button, Icon, Tooltip } from '@varve/ui';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setInspectorTabHandler, useEditor } from '../../context';
import { requestToolOptions } from '../../context/toolOptionsBridge';
import type { EditorState, InspectorTab, IntelligenceTab } from '../../context/types';
import { docVariableStore } from '../../docVariableStore';
import { toolIconName } from '../../tools/toolRegistry';
import { usePanelLocalState } from '../../workspace/panelLocalState';
import { useEffectiveWorkspaceConfig } from '../../workspace/useWorkspaceConfig';
import {
  getDefaultInspectorTab,
  getInspectorTabDefinition,
  getVisibleInspectorTabConfigs,
  type InspectorTabConfig,
  TAB_GROUP_ORDER,
} from '../../workspace/workspaceTypes';
import { LayerStatesSection } from '../LayersPanel/LayerStatesSection';
import { PanelDetachButton, PanelDragHandle } from '../PanelDragHandle';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { DisclosureSection } from './controls/DisclosureSection';
import { InspectorContextHeader } from './InspectorContextHeader';
import { InspectorTabBar } from './InspectorTabBar';
import { deriveInspectorContext, type InspectorContext } from './inspectorContext';
import { VariablesPanelDialog } from './panels/VariablesPanelDialog';
import { describeSelectionRestrictions, type SelectionRestrictionNotice } from './restrictionState';
import { SectionManagerTrigger } from './SectionManagerTrigger';
import { SelectionSourcesPanel } from './SelectionSourcesPanel';
import {
  getSectionDefinition,
  isContextualPrimarySection,
  resolveSectionOrder,
  type SectionAvailabilityContext,
  type SectionId,
} from './sectionRegistry';
import { hasCustomSectionOrder } from './sectionState';
import { AdjustmentLayerAccessSection } from './sections/AdjustmentLayerAccessSection';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AnimationSection } from './sections/AnimationSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { BooleanSection } from './sections/BooleanSection';
import { ComponentSection } from './sections/ComponentSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
import { FramePresetsSection } from './sections/FramePresetsSection';
import { IconSection } from './sections/IconSection';
import { ImageCropSection } from './sections/ImageCropSection';
import { ImagePlacementSection } from './sections/ImagePlacementSection';
import { ImageResolutionSection } from './sections/ImageResolutionSection';
import { LayoutChildSection } from './sections/LayoutChildSection';
import { LayoutSection } from './sections/LayoutSection';
import { MaskSection } from './sections/MaskSection';
import { MockupsSection } from './sections/MockupsSection';
import { PaintLibrarySection } from './sections/PaintLibrarySection';
import { PaletteSection } from './sections/PaletteSection';
import { PathTextSection } from './sections/PathTextSection';
import { PerspectiveSection } from './sections/PerspectiveSection';
import { PositionSizeSection } from './sections/PositionSizeSection';
import { SelectionColorsSection } from './sections/SelectionColorsSection';
import { SmartFiltersSection } from './sections/SmartFiltersSection';
import { StrokeSection } from './sections/StrokeSection';
import { TableCellsSection, TableTracksSection } from './sections/TableCellsSection';
import { TableSection } from './sections/TableSection';
import { TypographySection } from './sections/TypographySection';
import { WarpSection } from './sections/WarpSection';
import { type SelectionSummary, summarize } from './selection/selectionState';
import { toolContextSurface } from './toolContext';

import './inspector.css';

const AppearancePanel = lazy(() =>
  import('./panels/AppearancePanel').then((module) => ({ default: module.AppearancePanel })),
);
const AdjustmentsPanel = lazy(() =>
  import('./panels/AdjustmentsPanel').then((module) => ({ default: module.AdjustmentsPanel })),
);
const PrototypePanel = lazy(() =>
  import('./panels/PrototypePanel').then((module) => ({ default: module.PrototypePanel })),
);
const AuditPanel = lazy(() =>
  import('./panels/AuditPanel').then((module) => ({ default: module.AuditPanel })),
);
const DocumentPanel = lazy(() =>
  import('./panels/DocumentPanel').then((module) => ({ default: module.DocumentPanel })),
);
const FontBrowserPanel = lazy(() =>
  import('../FontBrowser/DocumentFontsPanel').then((module) => ({
    default: module.DocumentFontsPanel,
  })),
);
const EmailPanel = lazy(() =>
  import('./panels/EmailPanel').then((module) => ({ default: module.EmailPanel })),
);

type ExportSubTab = 'format' | 'code';

export function PropertiesPanel() {
  const { selectedNodes, state, platform, toggleVariablesPanel, toggleRightPanel } = useEditor();
  const { addPreset, updatePreset, removePreset, setShowExportDialog, groupCompoundOperation } =
    useEditor();
  const effectiveConfig = useEffectiveWorkspaceConfig(state.workspaceMode);
  const selNodes = selectedNodes();
  const summary = summarize(selNodes);
  const inspectorContext = useMemo(() => deriveInspectorContext(state), [state]);
  const restrictionNotice = useMemo(
    () =>
      describeSelectionRestrictions(
        inspectorContext.restrictions,
        state.document,
        inspectorContext.selectedNodeIds.length,
      ),
    [inspectorContext.restrictions, inspectorContext.selectedNodeIds.length, state.document],
  );
  const configuredTabs = useMemo(
    () => getVisibleInspectorTabConfigs(state.workspaceMode, effectiveConfig),
    [state.workspaceMode, effectiveConfig],
  );
  const [requestedTab, setRequestedTab] = useState<InspectorTab | null>(null);
  const visibleTabConfigs = useMemo((): InspectorTabConfig[] => {
    const tabs = [...configuredTabs];
    const isImageSelected = selNodes.length > 0 && selNodes.every(isImageShape);
    const isAdjustmentSelected = selNodes.length === 1 && selNodes[0]?.kind === 'adjustment';
    const isSingleNodeSelected = selNodes.length === 1;

    const addContextualTab = (id: InspectorTab) => {
      if (tabs.some((tabConfig) => tabConfig.id === id)) return;
      const definition = getInspectorTabDefinition(id, effectiveConfig);
      if (!definition) return;
      const targetGroupIndex = TAB_GROUP_ORDER.indexOf(definition.group ?? 'workflow');
      // Contextual tabs inherit their canonical group. Insert at the start of
      // that group so an image-only Adjustments tab appears before Prototype,
      // rather than jumping to the end after merged tabs are removed.
      const firstLaterGroup = tabs.findIndex(
        (tab) => TAB_GROUP_ORDER.indexOf(tab.group ?? 'workflow') >= targetGroupIndex,
      );
      const insertionIndex = firstLaterGroup >= 0 ? firstLaterGroup : tabs.length;
      tabs.splice(insertionIndex, 0, { ...definition, visible: true });
    };

    // Show Adjustments tab for any image-only selection: the image-editing
    // actions the selection quick bar offers in every workspace (Remove
    // background, Upscale, Vectorize) complete inside this tab, so hiding it
    // outside the Photo workspace made those actions unreachable — the review
    // region could never render and the bg-removal E2E suite went red.
    // Object Filters are also available for vector/text/container selections.
    // Keep mixed image/vector selections out: Image Tuning is batch-safe only
    // when every selected node is an image, while SmartFiltersSection edits a
    // single object at a time.
    const isObjectSelection =
      selNodes.length > 0 &&
      selNodes.every(canHaveSmartFilters) &&
      selNodes.every((node) => !isImageShape(node));
    if (isAdjustmentSelected || isImageSelected || isObjectSelection) {
      addContextualTab('adjustments');
    }

    // Prototype interactions may target any single scene node. Frames are the
    // screens, but child layers are real hit areas in the presenter.
    if (tabs.some((tabConfig) => tabConfig.id === 'prototype')) {
      if (!isSingleNodeSelected && !state.prototypeMode) {
        const index = tabs.findIndex((tabConfig) => tabConfig.id === 'prototype');
        if (index >= 0) tabs.splice(index, 1);
      }
    }

    // The Fonts tab is a contextual deep link. It opens Document fonts first;
    // Browse all fonts is an explicit second view, so discovery never starts
    // as a side effect of opening the inspector.
    if (requestedTab !== 'fonts') {
      const index = tabs.findIndex((tabConfig) => tabConfig.id === 'fonts');
      if (index >= 0) tabs.splice(index, 1);
    }

    // Appearance and Audit tabs are merged into the Design (properties) tab.
    // Hide them from the tab bar — their content renders inline below.
    for (const merged of ['appearance', 'audit'] as const) {
      if (requestedTab === merged) continue;
      const idx = tabs.findIndex((tabConfig) => tabConfig.id === merged);
      if (idx >= 0) tabs.splice(idx, 1);
    }

    // Audit and Export tabs: always available but show a hint when nothing is selected
    if (requestedTab && !tabs.some((tabConfig) => tabConfig.id === requestedTab)) {
      addContextualTab(requestedTab);
    }
    return tabs;
  }, [configuredTabs, effectiveConfig, requestedTab, selNodes, state.prototypeMode]);

  const [tab, setTab] = usePanelLocalState<InspectorTab>(
    'inspector',
    'activeTab',
    () => getDefaultInspectorTab(state.workspaceMode, effectiveConfig) as InspectorTab,
  );
  const [intelRequest, setIntelRequest] = useState<{ subTab?: IntelligenceTab; seq: number }>({
    seq: 0,
  });

  const [exportSubTab, setExportSubTab] = usePanelLocalState<ExportSubTab>(
    'inspector',
    'exportSubTab',
    'format',
  );
  const exportSubTabListRef = useRef<HTMLDivElement>(null);

  // APG Tabs for the Export sub-tabs: roving tabindex, arrow keys with wrap,
  // Home/End, automatic activation, focus follows the active tab.
  const handleExportSubTabKey = useCallback(
    (e: React.KeyboardEvent) => {
      const order: ExportSubTab[] = ['format', 'code'];
      const idx = order.indexOf(exportSubTab);
      let next: ExportSubTab | null = null;
      switch (e.key) {
        case 'ArrowRight':
          next = order[(idx + 1) % order.length] ?? 'format';
          break;
        case 'ArrowLeft':
          next = order[(idx - 1 + order.length) % order.length] ?? 'format';
          break;
        case 'Home':
          next = 'format';
          break;
        case 'End':
          next = 'code';
          break;
      }
      if (!next || next === exportSubTab) return;
      e.preventDefault();
      setExportSubTab(next);
      requestAnimationFrame(() => {
        exportSubTabListRef.current
          ?.querySelector<HTMLElement>(`[data-export-sub-tab="${next}"]`)
          ?.focus({ preventScroll: true });
      });
    },
    [exportSubTab],
  );

  useEffect(() => {
    setInspectorTabHandler(({ tab: nextTab, subTab }) => {
      setRequestedTab(nextTab);
      setTab(nextTab);
      setIntelRequest((r) => ({ subTab, seq: r.seq + 1 }));
    });
    return () => setInspectorTabHandler(null);
  }, []);

  useEffect(() => {
    if (!visibleTabConfigs.some((tabConfig) => tabConfig.id === tab)) {
      setTab(getDefaultInspectorTab(state.workspaceMode, effectiveConfig) as InspectorTab);
    }
  }, [state.workspaceMode, effectiveConfig, tab, visibleTabConfigs]);

  // Auto-switch to Adjustments tab when an adjustment layer is selected
  // and the current tab is Properties (which shows nothing useful for adjustments).
  const isAdjustmentOnly =
    selNodes.length === 1 &&
    selNodes[0]?.kind === 'adjustment' &&
    visibleTabConfigs.some((tabConfig) => tabConfig.id === 'adjustments');
  useEffect(() => {
    if (isAdjustmentOnly && tab === 'properties') {
      setTab('adjustments');
    }
  }, [isAdjustmentOnly, tab]);

  useEffect(() => {
    if (state.tool === 'inspect') setExportSubTab('code');
  }, [state.tool]);

  // Export-setting mutations are document edits: give each user action one
  // labeled undo step (a bundle add is one action, not one per member preset).
  const exportTargetId = selNodes[0]?.id;
  const handleAddExportPreset = useCallback(
    (preset: ExportPreset) => {
      if (!exportTargetId) return;
      groupCompoundOperation('Add export setting', () => addPreset(exportTargetId, preset));
    },
    [exportTargetId, groupCompoundOperation, addPreset],
  );
  const handleAddExportPresets = useCallback(
    (presets: ExportPreset[]) => {
      if (!exportTargetId || presets.length === 0) return;
      groupCompoundOperation(
        presets.length === 1 ? 'Add export setting' : `Add ${presets.length} export settings`,
        () => {
          for (const preset of presets) addPreset(exportTargetId, preset);
        },
      );
    },
    [exportTargetId, groupCompoundOperation, addPreset],
  );
  const handleUpdateExportPreset = useCallback(
    (preset: ExportPreset) => {
      if (!exportTargetId) return;
      groupCompoundOperation('Update export setting', () => updatePreset(exportTargetId, preset));
    },
    [exportTargetId, groupCompoundOperation, updatePreset],
  );
  const handleRemoveExportPreset = useCallback(
    (presetId: string) => {
      if (!exportTargetId) return;
      groupCompoundOperation('Remove export setting', () => removePreset(exportTargetId, presetId));
    },
    [exportTargetId, groupCompoundOperation, removePreset],
  );

  const activateTab = (nextTab: InspectorTabConfig['id']) => {
    if (configuredTabs.some((tabConfig) => tabConfig.id === nextTab)) setRequestedTab(null);
    setTab(nextTab as InspectorTab);
  };

  return (
    <section
      className="editor-inspector"
      data-panel-root="inspector"
      data-inspector-context={inspectorContext.scope}
      aria-label="Inspector"
    >
      <VariablesPanelDialog open={state.variablesPanelVisible} onClose={toggleVariablesPanel} />
      <PanelDragHandle
        panelTypeId="inspector"
        panelInstanceId="inspector-primary"
        currentWindowId="main"
        title="Inspector"
      >
        <InspectorTabBar
          tabs={visibleTabConfigs}
          activeTab={tab}
          onActivate={activateTab}
          onDetach={
            <div className="insp-panel__header-actions">
              <PanelDetachButton />
              {toggleRightPanel && (
                <Tooltip label="Collapse Inspector (Ctrl+Shift+B)">
                  <button
                    type="button"
                    className="editor__collapse-btn insp-panel__header-btn"
                    onClick={() => toggleRightPanel()}
                    aria-label="Collapse Inspector (Ctrl+Shift+B)"
                  >
                    <svg width="16" height="16" viewBox="0 0 16 16" fill="none" aria-hidden="true">
                      <rect
                        x="2"
                        y="2"
                        width="12"
                        height="12"
                        rx="2"
                        stroke="currentColor"
                        strokeWidth="1.25"
                        fill="none"
                      />
                      <rect
                        x="10"
                        y="2"
                        width="4"
                        height="12"
                        rx="1.5"
                        fill="currentColor"
                        fillOpacity="0.25"
                      />
                      <line
                        x1="10"
                        y1="2"
                        x2="10"
                        y2="14"
                        stroke="currentColor"
                        strokeWidth="1.25"
                      />
                      <path
                        d="M4.5 6L6.5 8L4.5 10"
                        stroke="currentColor"
                        strokeWidth="1.5"
                        strokeLinecap="round"
                        strokeLinejoin="round"
                      />
                    </svg>
                  </button>
                </Tooltip>
              )}
            </div>
          }
        />
      </PanelDragHandle>
      <InspectorContextHeader
        context={inspectorContext}
        action={
          tab === 'properties' && summary.kind === 'empty' ? <SectionManagerTrigger /> : undefined
        }
      />

      {tab === 'properties' && (
        <div
          className="insp-panel"
          id="insp-tabpanel-properties"
          role="tabpanel"
          aria-labelledby="insp-tab-properties"
        >
          {/* Pixel coverage leads only while it is what is being inspected;
              otherwise it follows the object's own properties. */}
          {inspectorContext.scope === 'pixel-selection' && <SelectionSourcesPanel />}
          <SelectionLockGuard restriction={restrictionNotice} showNotice={tab === 'properties'}>
            {summary.kind === 'empty' && <EmptySelectionState context={inspectorContext} />}
            {summary.kind === 'single' && (
              <SingleSelectionPanel nodes={selNodes} headerAction={<SectionManagerTrigger />} />
            )}
            {summary.kind === 'multi' && (
              <MultiSelectionPanel
                nodes={selNodes}
                summary={summary}
                headerAction={<SectionManagerTrigger />}
              />
            )}
          </SelectionLockGuard>
          {inspectorContext.scope !== 'pixel-selection' && <SelectionSourcesPanel />}
          {/* Insights remains document-level and last in the Design composition.
              It is lazy because the audit panel is also reachable from the
              legacy tab/deep-link path. Registry-managed (sectionId) so the
              section manager can hide or restore it. */}
          <Suspense fallback={null}>
            <SelectionLockGuard restriction={restrictionNotice}>
              <DisclosureSection title="Insights" sectionId="insights">
                <AuditPanel request={intelRequest} />
              </DisclosureSection>
            </SelectionLockGuard>
          </Suspense>
        </div>
      )}

      {/* Legacy appearance tab — content is merged into the Design tab; this
          block remains so stored preferences and deep links that request the
          appearance tab still render correctly. */}
      {tab === 'appearance' && (
        <LazyTabPanel tab={tab} label={getInspectorTabDefinition(tab, effectiveConfig)?.label}>
          <SelectionLockGuard restriction={restrictionNotice} showNotice={tab === 'appearance'}>
            <AppearancePanel />
          </SelectionLockGuard>
        </LazyTabPanel>
      )}
      {tab === 'adjustments' && (
        <LazyTabPanel tab={tab} label={getInspectorTabDefinition(tab, effectiveConfig)?.label}>
          <SelectionLockGuard restriction={restrictionNotice} showNotice={tab === 'adjustments'}>
            <AdjustmentsPanel />
          </SelectionLockGuard>
        </LazyTabPanel>
      )}
      {tab === 'prototype' && (
        <LazyTabPanel tab={tab} label={getInspectorTabDefinition(tab, effectiveConfig)?.label}>
          <SelectionLockGuard restriction={restrictionNotice} showNotice={tab === 'prototype'}>
            <PrototypePanel />
          </SelectionLockGuard>
        </LazyTabPanel>
      )}
      {tab === 'export' && (
        <div
          className="insp-panel"
          id="insp-tabpanel-export"
          role="tabpanel"
          aria-labelledby="insp-tab-export"
        >
          <div
            className="insp-panel__sub-tabs"
            role="tablist"
            aria-label="Export options"
            ref={exportSubTabListRef}
            onKeyDown={handleExportSubTabKey}
          >
            <button
              type="button"
              role="tab"
              id="insp-sub-tab-format"
              className="insp-panel__sub-tab"
              aria-selected={exportSubTab === 'format'}
              aria-controls="insp-tabpanel-export-sub"
              tabIndex={exportSubTab === 'format' ? 0 : -1}
              data-export-sub-tab="format"
              onClick={() => setExportSubTab('format')}
            >
              Format
            </button>
            <button
              type="button"
              role="tab"
              id="insp-sub-tab-code"
              className="insp-panel__sub-tab"
              aria-selected={exportSubTab === 'code'}
              aria-controls="insp-tabpanel-export-sub"
              tabIndex={exportSubTab === 'code' ? 0 : -1}
              data-export-sub-tab="code"
              onClick={() => setExportSubTab('code')}
            >
              Code
            </button>
          </div>
          <div
            className="insp-panel__sub-content"
            id="insp-tabpanel-export-sub"
            role="tabpanel"
            aria-labelledby={`insp-sub-tab-${exportSubTab}`}
          >
            {exportSubTab === 'format' && selNodes.length > 0 ? (
              <AssetExportControls
                node={selNodes[0] as SceneNode}
                doc={state.document}
                platform={platform}
                selectedCount={selNodes.length}
                onAddPreset={handleAddExportPreset}
                onAddPresets={handleAddExportPresets}
                onUpdatePreset={handleUpdateExportPreset}
                onRemovePreset={handleRemoveExportPreset}
                onOpenAdvancedExport={() => setShowExportDialog(true)}
              />
            ) : exportSubTab === 'code' && selNodes.length > 0 ? (
              <CodeGenView
                node={selNodes[0] as SceneNode}
                doc={state.document}
                variableStore={docVariableStore(state.document)}
              />
            ) : (
              <div className="spec-export__empty-state">
                <div className="spec-export__empty-icon" aria-hidden="true">
                  <Icon name="Download" size={24} label={undefined} />
                </div>
                <p className="insp-panel__empty-hint">
                  Select a node to export it as SVG, PNG, PDF, or generate code.
                </p>
                <button
                  type="button"
                  className="spec-export__empty-action"
                  onClick={() => setShowExportDialog(true)}
                  aria-label="Open export workspace"
                >
                  <Icon name="SlidersHorizontal" size={14} label={undefined} />
                  <span>Open Export Workspace</span>
                </button>
              </div>
            )}
          </div>
        </div>
      )}
      {tab === 'audit' && (
        <LazyTabPanel tab={tab} label={getInspectorTabDefinition(tab, effectiveConfig)?.label}>
          <AuditPanel request={intelRequest} />
        </LazyTabPanel>
      )}
      {tab === 'fonts' && (
        <LazyTabPanel tab={tab} label={getInspectorTabDefinition(tab, effectiveConfig)?.label}>
          <FontBrowserPanel />
        </LazyTabPanel>
      )}
      {tab === 'email' && (
        <LazyTabPanel tab={tab} label={getInspectorTabDefinition(tab, effectiveConfig)?.label}>
          <EmailPanel />
        </LazyTabPanel>
      )}
    </section>
  );
}

function LazyTabPanel({
  tab,
  label,
  children,
}: {
  tab: InspectorTab;
  label?: string;
  children: React.ReactNode;
}) {
  const tabLabel = label ?? tab;
  return (
    <div
      className="insp-panel"
      id={`insp-tabpanel-${tab}`}
      role="tabpanel"
      aria-labelledby={`insp-tab-${tab}`}
    >
      <Suspense
        fallback={
          <p className="insp-panel__empty-hint" role="status">
            Loading {tabLabel.toLowerCase()}…
          </p>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}

function SelectionLockGuard({
  restriction,
  showNotice = false,
  children,
}: {
  restriction: SelectionRestrictionNotice;
  showNotice?: boolean;
  children: React.ReactNode;
}) {
  const lockMessage = restriction.hasPartialLock
    ? `${restriction.lockedCount} of ${restriction.totalCount} selected layers are locked. Inspector editing is disabled until all selected layers are unlocked.`
    : `Selection is locked${restriction.lockSourceLabel ? ` by ${restriction.lockSourceLabel}` : ''}. Unlock it in Layers to edit these controls.`;
  const hiddenMessage = restriction.hasPartialHidden
    ? `${restriction.hiddenCount} of ${restriction.totalCount} selected layers are hidden${restriction.visibilitySourceLabel ? ` by ${restriction.visibilitySourceLabel}` : ''}. Changes apply, but canvas feedback is unavailable until they are shown.`
    : `Selection is hidden${restriction.visibilitySourceLabel ? ` by ${restriction.visibilitySourceLabel}` : ''}. Changes apply, but canvas feedback is unavailable until it is shown.`;
  return (
    <>
      {showNotice && restriction.locked && (
        <p className="insp-panel__restriction" role="status" aria-live="polite">
          {lockMessage}
        </p>
      )}
      {showNotice && restriction.hidden && (
        <p className="insp-panel__restriction" role="status" aria-live="polite">
          {hiddenMessage}
        </p>
      )}
      <div
        aria-disabled={restriction.locked || undefined}
        data-inspector-restriction={restriction.locked ? 'locked' : undefined}
        {...(restriction.locked ? ({ inert: true } as Record<string, unknown>) : {})}
      >
        {children}
      </div>
    </>
  );
}

/**
 * Collects registry-gated sections for one Inspector composition. Availability
 * and user hide/order preferences come from the section registry, so every
 * composition (empty, single, multi) applies the same rules.
 */
function composeSections(state: EditorState, availability: SectionAvailabilityContext) {
  const entries: { id: SectionId; order: number; el: React.ReactNode }[] = [];
  // A user's reordering applies within the contextual bands. The primary band
  // remains selection-driven so Typography/Image Placement/Table context
  // cannot be buried by a previous global reorder.
  const customOrder = hasCustomSectionOrder(state.sectionVisibility);
  const add = (id: SectionId, el: React.ReactNode) => {
    const def = getSectionDefinition(id);
    if (def && !def.isAvailable(availability)) return;
    if (state.sectionVisibility[id]?.hidden && def?.canHide) return;
    const saved = state.sectionVisibility[id]?.order;
    const contextual = def ? resolveSectionOrder(def, availability) : 500;
    const primary = def ? isContextualPrimarySection(id, availability) : false;
    entries.push({
      id,
      order: primary ? contextual : customOrder ? (saved ?? contextual) : contextual,
      el,
    });
  };
  const sorted = () => entries.sort((a, b) => a.order - b.order);
  return { add, sorted };
}

/**
 * The empty Inspector while a tool with settings of its own is active. Tools
 * that own Inspector sections (Frame presets) render them here; tools whose
 * settings live beside the toolbar get a button that opens that popover.
 */
function ToolContextState({ context }: { context: InspectorContext }) {
  const { state } = useEditor();
  const tool = context.activeTool;
  const label = context.target.label;

  if (toolContextSurface(tool) === 'inspector') {
    const { add, sorted } = composeSections(state, {
      selectionKind: 'empty',
      selectedNodes: [],
      workspaceMode: state.workspaceMode,
      activeTool: tool,
      prototypeMode: state.prototypeMode,
      tableEdit: state.tableEdit,
      document: state.document,
    });
    add('frame-presets', <FramePresetsSection mode="create" sectionId="frame-presets" />);
    const entries = sorted();
    return (
      <div className="insp-tool-context" data-tool-context={tool}>
        <p className="insp-tool-context__hint">
          Drag on the canvas to draw a {label.toLowerCase()}, or pick a size to place one.
        </p>
        {entries.map((entry) => (
          <div key={entry.id}>{entry.el}</div>
        ))}
      </div>
    );
  }

  return (
    <div className="insp-tool-context" data-tool-context={tool}>
      <p className="insp-tool-context__hint">
        {label} settings open beside the toolbar and apply to what you create next.
      </p>
      <Button
        variant="secondary"
        size="sm"
        className="insp-tool-context__action"
        onClick={requestToolOptions}
      >
        <Icon name={toolIconName(tool)} size={14} />
        Show {label.toLowerCase()} options
      </Button>
    </div>
  );
}

function EmptySelectionState({ context }: { context: InspectorContext }) {
  if (context.scope === 'tool') return <ToolContextState context={context} />;
  const showsDocumentSettings =
    context.scope === 'document' || context.scope === 'canvas' || context.scope === 'page';
  // The context header above already names what is being inspected, so one
  // line of guidance replaces the former illustration, headline, and repeat.
  const hint = showsDocumentSettings
    ? 'Select a layer to edit its properties.'
    : context.scope === 'pixel-selection'
      ? 'Select a layer to return to object properties.'
      : 'Choose a layer or return to the originating workflow to continue.';
  return (
    <div className="insp-panel__empty">
      <p className="insp-panel__empty-hint" role="status">
        {hint}
      </p>
      {showsDocumentSettings && (
        <Suspense
          fallback={
            <p className="insp-panel__empty-hint" role="status">
              Loading document settings…
            </p>
          }
        >
          <DocumentPanel />
        </Suspense>
      )}
    </div>
  );
}

function SingleSelectionPanel({
  nodes,
  headerAction,
}: {
  nodes: SceneNode[];
  headerAction?: React.ReactNode;
}) {
  const { state } = useEditor();
  const node = nodes[0] as SceneNode;
  // An Export Region is stored as a frame but is not a layout container: it
  // owns no children, so auto-layout, clipping and child-slot controls would
  // all be inert switches. Treat it as a plain rectangular region here.
  const isExportRegionNode = isExportRegion(node);
  const isFrame = node.kind === 'frame' && !isExportRegionNode;
  const isComponentInstance = isFrame && (node as import('@varve/scene').FrameNode).componentId;
  const isRect =
    node.kind === 'shape' && (node as import('@varve/scene').ShapeNode).shape.kind === 'rect';

  const sectionEntries = useMemo(() => {
    const availabilityCtx: SectionAvailabilityContext = {
      selectionKind: 'single',
      selectedNodes: nodes,
      sharedKind: node.kind,
      workspaceMode: state.workspaceMode,
      activeTool: state.tool,
      prototypeMode: state.prototypeMode,
      tableEdit: state.tableEdit,
      document: state.document,
    };
    const { add, sorted } = composeSections(state, availabilityCtx);

    // AdjustmentPanel is the canonical editor for adjustment nodes. Generic
    // fill/stroke/legacy-effects sections expose unrelated NodeBase fields and
    // create a second, conflicting effects pipeline.
    if (node.kind === 'adjustment') return sorted();

    if (node.kind === 'table') {
      add('table', <TableSection node={node as import('@varve/scene').TableNode} />);
      add('table-cells', <TableCellsSection tableId={node.id} />);
      add('table-columns', <TableTracksSection tableId={node.id} />);
      add('appearance', <AppearanceSection nodes={nodes} />);
      add('adjustment-layer-access', <AdjustmentLayerAccessSection nodes={nodes} />);
      return sorted();
    }

    if (isComponentInstance)
      add('component', <ComponentSection node={node as import('@varve/scene').FrameNode} />);
    if (node.iconAssetId) add('icon', <IconSection node={node} />);
    if (isFrame && 'mockup' in node) {
      add('mockups', <MockupsSection node={node as import('@varve/scene').FrameNode} />);
    }
    add('position-size', <PositionSizeSection nodes={nodes} />);
    if (!isFrame) add('layout-child', <LayoutChildSection nodes={nodes} />);
    if (isRect || isFrame) add('corner-radius', <CornerRadiusSection nodes={nodes} />);
    if (isFrame) add('layout', <LayoutSection node={node as import('@varve/scene').FrameNode} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    if (nodes.length === 1) add('mask', <MaskSection nodes={nodes} />);
    add('adjustment-layer-access', <AdjustmentLayerAccessSection nodes={nodes} />);
    add('selection-colors', <SelectionColorsSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
    add('paint-library', <PaintLibrarySection />);
    if (isImageShape(node)) add('palette', <PaletteSection />);
    if (canHaveSmartFilters(node)) add('smart-filters', <SmartFiltersSection nodes={nodes} />);
    if (canHaveLayerEffects(node)) {
      add('effects', <EffectsSection nodes={nodes} sectionId="effects" />);
    }
    add('animation', <AnimationSection nodes={nodes} />);
    add('image-placement', <ImagePlacementSection nodes={nodes} />);
    add('image-perspective', <PerspectiveSection nodes={nodes} sectionId="image-perspective" />);
    add('image-resolution', <ImageResolutionSection nodes={nodes} />);
    add('image-crop', <ImageCropSection nodes={nodes} sectionId="image-crop" />);
    add('stroke', <StrokeSection nodes={nodes} />);
    add('typography', <TypographySection nodes={nodes} />);
    add('text-on-path', <PathTextSection nodes={nodes} />);
    if ('warps' in node || state.tool === 'warp') {
      add('warp', <WarpSection nodes={nodes} node={node} />);
    }

    add('layer-states', <LayerStatesSection />);

    return sorted();
  }, [nodes, node, isFrame, isExportRegionNode, isComponentInstance, isRect, state]);

  return (
    <>
      <header className="insp-panel__node-header">
        <h2 className="insp-panel__node-name">
          {node.name}
          <span className="insp-panel__node-kind">
            {isExportRegionNode ? 'export region' : node.kind}
          </span>
        </h2>
        {headerAction}
      </header>
      <AlignDistributeBar />
      {node.kind === 'group' && <BooleanSection node={node} />}
      {sectionEntries.map((entry) => (
        <div key={entry.id}>{entry.el}</div>
      ))}
    </>
  );
}

function MultiSelectionPanel({
  nodes,
  summary,
  headerAction,
}: {
  nodes: SceneNode[];
  summary: SelectionSummary;
  headerAction?: React.ReactNode;
}) {
  const { state } = useEditor();

  const sectionEntries = useMemo(() => {
    const availabilityCtx: SectionAvailabilityContext = {
      selectionKind: 'multi',
      selectedNodes: nodes,
      sharedKind: summary.sharedKind,
      workspaceMode: state.workspaceMode,
      activeTool: state.tool,
      prototypeMode: state.prototypeMode,
      tableEdit: state.tableEdit,
      document: state.document,
    };
    const { add, sorted } = composeSections(state, availabilityCtx);

    add('position-size', <PositionSizeSection nodes={nodes} />);
    const hasCornerRadius = nodes.some(
      (n) =>
        n.kind === 'frame' ||
        (n.kind === 'shape' && (n as { shape?: { kind?: string } }).shape?.kind === 'rect'),
    );
    if (hasCornerRadius) {
      add('corner-radius', <CornerRadiusSection nodes={nodes} />);
    }
    add('layout-child', <LayoutChildSection nodes={nodes} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    add('paint-library', <PaintLibrarySection />);
    add('adjustment-layer-access', <AdjustmentLayerAccessSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
    add('stroke', <StrokeSection nodes={nodes} />);
    if (nodes.every(canHaveLayerEffects)) {
      add('effects', <EffectsSection nodes={nodes} sectionId="effects" />);
    }
    add('selection-colors', <SelectionColorsSection nodes={nodes} />);
    if (nodes.some(isImageShape)) {
      add('image-placement', <ImagePlacementSection nodes={nodes} />);
    }
    add('typography', <TypographySection nodes={nodes} />);
    if (nodes.some((n) => 'warps' in n) || state.tool === 'warp') {
      add('warp', <WarpSection nodes={nodes} node={nodes[0]} />);
    }

    add('layer-states', <LayerStatesSection />);

    return sorted();
  }, [nodes, state, summary.sharedKind]);

  return (
    <>
      <header className="insp-panel__node-header">
        <h2 className="insp-panel__multi-count" role="status">
          {summary.sharedKind
            ? `${nodes.length} ${summary.sharedKind} selected`
            : `${nodes.length} selected`}
        </h2>
        {headerAction}
      </header>
      <AlignDistributeBar />
      {sectionEntries.map((entry) => (
        <div key={entry.id}>{entry.el}</div>
      ))}
    </>
  );
}
