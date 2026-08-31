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
import { isExportRegion, isImageShape, type SceneNode } from '@varve/scene';
import { EmptyState } from '@varve/ui';
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setInspectorTabHandler, useEditor } from '../../context';
import type { InspectorTab, IntelligenceTab } from '../../context/types';
import { docVariableStore } from '../../docVariableStore';
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
  type SectionAvailabilityContext,
  type SectionId,
} from './sectionRegistry';
import { AdjustmentLayerAccessSection } from './sections/AdjustmentLayerAccessSection';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AnimationSection } from './sections/AnimationSection';
import { AppearanceSection } from './sections/AppearanceSection';
import { ComponentSection } from './sections/ComponentSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { FillSection } from './sections/FillSection';
import { IconSection } from './sections/IconSection';
import { ImageCropSection } from './sections/ImageCropSection';
import { ImagePlacementSection } from './sections/ImagePlacementSection';
import { ImageResolutionSection } from './sections/ImageResolutionSection';
import { LayoutChildSection } from './sections/LayoutChildSection';
import { LayoutSection } from './sections/LayoutSection';
import { MockupsSection } from './sections/MockupsSection';
import { PathTextSection } from './sections/PathTextSection';
import { PerspectiveSection } from './sections/PerspectiveSection';
import { PositionSizeSection } from './sections/PositionSizeSection';
import { SelectionColorsSection } from './sections/SelectionColorsSection';
import { StrokeSection } from './sections/StrokeSection';
import { TableCellsSection, TableTracksSection } from './sections/TableCellsSection';
import { TableSection } from './sections/TableSection';
import { TypographySection } from './sections/TypographySection';
import { WarpSection } from './sections/WarpSection';
import { type SelectionSummary, summarize } from './selection/selectionState';

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
  import('../FontBrowser/FontBrowser').then((module) => ({ default: module.FontBrowser })),
);
const EmailPanel = lazy(() =>
  import('./panels/EmailPanel').then((module) => ({ default: module.EmailPanel })),
);

type ExportSubTab = 'format' | 'code';

export function PropertiesPanel() {
  const { selectedNodes, state, platform, toggleVariablesPanel } = useEditor();
  const { addPreset, updatePreset, removePreset, setShowExportDialog } = useEditor();
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
    if (isAdjustmentSelected || isImageSelected) {
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

    // Fonts tab is merged away: font discovery lives in the Browse-fonts
    // dialog inside the Typography section. The legacy tab block remains for
    // the openFontsPanel deep link.
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
          onDetach={<PanelDetachButton />}
        />
      </PanelDragHandle>
      <InspectorContextHeader context={inspectorContext} />

      {tab === 'properties' && (
        <div
          className="insp-panel"
          id="insp-tabpanel-properties"
          role="tabpanel"
          aria-labelledby="insp-tab-properties"
        >
          <div className="insp-panel__header">
            <SectionManagerTrigger />
          </div>
          <SelectionSourcesPanel />
          <SelectionLockGuard restriction={restrictionNotice} showNotice={tab === 'properties'}>
            {summary.kind === 'empty' && <EmptySelectionState context={inspectorContext} />}
            {summary.kind === 'single' && <SingleSelectionPanel nodes={selNodes} />}
            {summary.kind === 'multi' && <MultiSelectionPanel nodes={selNodes} summary={summary} />}
          </SelectionLockGuard>
          {/* Merged from the Appearance and Audit tabs. Both panels are lazy,
              so they must render inside a Suspense boundary — at HEAD they
              only ever mounted inside LazyTabPanel. Hidden on empty selection:
              the DocumentPanel above is the empty-selection surface. */}
          <Suspense fallback={null}>
            {summary.kind !== 'empty' && (
              <SelectionLockGuard restriction={restrictionNotice}>
                <AppearancePanel />
              </SelectionLockGuard>
            )}
            {/* Merged from the Audit tab. Unlike the appearance surfaces,
                intelligence is a document-level analysis reachable with no
                selection (audit page/document menu actions), so it renders
                regardless of selection, collapsed by default. Deep-link
                requests (openAuditPanel) still reach IntelligencePanel
                through the request prop. */}
            <SelectionLockGuard restriction={restrictionNotice}>
              <DisclosureSection title="Insights" defaultExpanded={false}>
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
                onAddPreset={(preset) => addPreset((selNodes[0] as SceneNode).id, preset)}
                onUpdatePreset={(preset) => updatePreset((selNodes[0] as SceneNode).id, preset)}
                onRemovePreset={(presetId) => removePreset((selNodes[0] as SceneNode).id, presetId)}
                onOpenAdvancedExport={() => setShowExportDialog(true)}
              />
            ) : exportSubTab === 'code' && selNodes.length > 0 ? (
              <CodeGenView
                node={selNodes[0] as SceneNode}
                doc={state.document}
                variableStore={docVariableStore(state.document)}
              />
            ) : (
              <p className="insp-panel__empty-hint">
                Select a node to export it as SVG, PNG, PDF, or generate code.
              </p>
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
          <FontBrowserPanel onSelect={() => {}} />
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

function EmptySelectionState({ context }: { context: InspectorContext }) {
  const showsDocumentSettings =
    context.scope === 'document' || context.scope === 'canvas' || context.scope === 'page';
  const scopeDescription =
    context.scope === 'tool'
      ? `Inspecting ${context.target.label}. Tool controls stay with the active tool. Select a layer to return to object properties.`
      : context.scope === 'pixel-selection'
        ? `Inspecting ${context.target.label}. Select a layer to return to object properties.`
        : `Inspecting ${context.target.label} settings. Select a layer to edit its properties.`;
  return (
    <div className="insp-panel__empty">
      <EmptyState
        illustration={
          <svg
            width="64"
            height="64"
            viewBox="0 0 64 64"
            fill="none"
            stroke="currentColor"
            strokeWidth="1.5"
            aria-hidden
          >
            <title>No selection</title>
            <rect x="8" y="8" width="48" height="48" rx="4" strokeDasharray="4 3" opacity="0.4" />
            <rect
              x="16"
              y="16"
              width="32"
              height="32"
              rx="2"
              strokeDasharray="3 2"
              opacity="0.25"
            />
            <circle cx="32" cy="32" r="3" fill="currentColor" opacity="0.15" />
          </svg>
        }
        headline="No selection"
        description={scopeDescription}
      />
      {showsDocumentSettings ? (
        <Suspense
          fallback={
            <p className="insp-panel__empty-hint" role="status">
              Loading document settings…
            </p>
          }
        >
          <DocumentPanel />
        </Suspense>
      ) : (
        <p className="insp-panel__empty-hint" role="status">
          {context.scope === 'tool'
            ? 'Open the active tool controls to adjust its options.'
            : 'Choose a layer or return to the originating workflow to continue.'}
        </p>
      )}
    </div>
  );
}

function SingleSelectionPanel({ nodes }: { nodes: SceneNode[] }) {
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
    const entries: { id: SectionId; order: number; el: React.ReactNode }[] = [];
    const add = (id: SectionId, el: React.ReactNode) => {
      const def = getSectionDefinition(id);
      if (def && !def.isAvailable(availabilityCtx)) return;
      if (state.sectionVisibility[id]?.hidden && def?.canHide) return;
      const o = state.sectionVisibility[id]?.order;
      entries.push({ id, order: o ?? def?.order ?? 500, el });
    };

    // AdjustmentPanel is the canonical editor for adjustment nodes. Generic
    // fill/stroke/legacy-effects sections expose unrelated NodeBase fields and
    // create a second, conflicting effects pipeline.
    if (node.kind === 'adjustment') return entries;

    if (node.kind === 'table') {
      add('table', <TableSection node={node as import('@varve/scene').TableNode} />);
      add('table-cells', <TableCellsSection tableId={node.id} />);
      add('table-columns', <TableTracksSection tableId={node.id} />);
      add('table-rows', <TableTracksSection tableId={node.id} />);
      add('appearance', <AppearanceSection nodes={nodes} />);
      add('adjustment-layer-access', <AdjustmentLayerAccessSection nodes={nodes} />);
      return entries.sort((a, b) => a.order - b.order);
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
    if (!isFrame) add('layout', <LayoutChildSection nodes={nodes} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    add('adjustment-layer-access', <AdjustmentLayerAccessSection nodes={nodes} />);
    add('selection-colors', <SelectionColorsSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
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

    return entries.sort((a, b) => a.order - b.order);
  }, [nodes, node, isFrame, isExportRegionNode, isComponentInstance, isRect, state]);

  return (
    <>
      <header className="insp-panel__node-header">
        <p className="insp-panel__node-name">
          {node.name}
          <span className="insp-panel__node-kind">
            {isExportRegionNode ? 'export region' : node.kind}
          </span>
        </p>
      </header>
      <AlignDistributeBar />
      {sectionEntries.map((entry) => (
        <div key={entry.id}>{entry.el}</div>
      ))}
    </>
  );
}

function MultiSelectionPanel({
  nodes,
  summary,
}: {
  nodes: SceneNode[];
  summary: SelectionSummary;
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
    const entries: { id: SectionId; order: number; el: React.ReactNode }[] = [];
    const add = (id: SectionId, el: React.ReactNode) => {
      const def = getSectionDefinition(id);
      if (def && !def.isAvailable(availabilityCtx)) return;
      if (state.sectionVisibility[id]?.hidden && def?.canHide) return;
      const o = state.sectionVisibility[id]?.order;
      entries.push({ id, order: o ?? def?.order ?? 500, el });
    };

    add('position-size', <PositionSizeSection nodes={nodes} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    add('adjustment-layer-access', <AdjustmentLayerAccessSection nodes={nodes} />);
    add('selection-colors', <SelectionColorsSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
    add('stroke', <StrokeSection nodes={nodes} />);
    add('typography', <TypographySection nodes={nodes} />);
    if (nodes.some((n) => 'warps' in n) || state.tool === 'warp') {
      add('warp', <WarpSection nodes={nodes} node={nodes[0]} />);
    }

    add('layer-states', <LayerStatesSection />);

    return entries.sort((a, b) => a.order - b.order);
  }, [nodes, state, summary.sharedKind]);

  return (
    <>
      <div className="insp-panel__multi-count" role="status">
        {summary.sharedKind
          ? `${nodes.length} ${summary.sharedKind} selected`
          : `${nodes.length} selected`}
      </div>
      <AlignDistributeBar />
      {sectionEntries.map((entry) => (
        <div key={entry.id}>{entry.el}</div>
      ))}
    </>
  );
}
