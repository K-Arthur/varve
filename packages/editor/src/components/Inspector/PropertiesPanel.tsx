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
import { isImageShape, type SceneNode } from '@strata/scene';
import { EmptyState } from '@strata/ui';
import { lazy, Suspense, useEffect, useMemo, useRef, useState } from 'react';
import { setInspectorTabHandler, useEditor } from '../../context';
import type { InspectorTab, IntelligenceTab } from '../../context/types';
import { docVariableStore } from '../../docVariableStore';
import { getDefaultInspectorTab, getVisibleInspectorTabs } from '../../workspace/workspaceTypes';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { SectionManagerTrigger } from './SectionManagerTrigger';
import {
  getSectionDefinition,
  type SectionAvailabilityContext,
  type SectionId,
} from './sectionRegistry';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AppearanceSection } from './sections/AppearanceSection';
import { ComponentSection } from './sections/ComponentSection';
import { ConstraintSection } from './sections/ConstraintSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { FillSection } from './sections/FillSection';
import { ImagePlacementSection } from './sections/ImagePlacementSection';
import { LayoutSection } from './sections/LayoutSection';
import { PositionSizeSection } from './sections/PositionSizeSection';
import { StrokeSection } from './sections/StrokeSection';
import { TypographySection } from './sections/TypographySection';
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

type ExportSubTab = 'format' | 'code';

const FALLBACK_TAB_LABELS: Record<InspectorTab, string> = {
  properties: 'Properties',
  appearance: 'Appearance',
  adjustments: 'Adjustments',
  prototype: 'Prototype',
  export: 'Export',
  audit: 'Audit',
  fonts: 'Fonts',
};

const TAB_ORDER: InspectorTab[] = [
  'properties',
  'appearance',
  'adjustments',
  'prototype',
  'export',
  'audit',
  'fonts',
];

export function PropertiesPanel() {
  const { selectedNodes, state, platform } = useEditor();
  const selNodes = selectedNodes();
  const summary = summarize(selNodes);
  const hasLockedSelection = selNodes.some((node) => node.locked);
  const hasHiddenSelection = selNodes.some((node) => node.visible === false);
  const configuredTabs = useMemo(
    () => getVisibleInspectorTabs(state.workspaceMode) as InspectorTab[],
    [state.workspaceMode],
  );
  const [requestedTab, setRequestedTab] = useState<InspectorTab | null>(null);
  const visibleTabs = useMemo(() => {
    const tabs = [...configuredTabs];
    const adjustmentSelection =
      selNodes.length === 1 &&
      (selNodes[0]?.kind === 'adjustment' || (selNodes[0] ? isImageShape(selNodes[0]) : false));
    if (adjustmentSelection && !tabs.includes('adjustments')) tabs.push('adjustments');
    if (requestedTab && !tabs.includes(requestedTab)) tabs.push(requestedTab);
    return tabs.sort((a, b) => TAB_ORDER.indexOf(a) - TAB_ORDER.indexOf(b));
  }, [configuredTabs, requestedTab, selNodes]);

  const [tab, setTab] = useState<InspectorTab>(
    () => getDefaultInspectorTab(state.workspaceMode) as InspectorTab,
  );
  const tabRefs = useRef(new Map<InspectorTab, HTMLButtonElement>());

  const [intelRequest, setIntelRequest] = useState<{ subTab?: IntelligenceTab; seq: number }>({
    seq: 0,
  });

  const [exportSubTab, setExportSubTab] = useState<ExportSubTab>('format');

  useEffect(() => {
    setInspectorTabHandler(({ tab: nextTab, subTab }) => {
      setRequestedTab(nextTab);
      setTab(nextTab);
      setIntelRequest((r) => ({ subTab, seq: r.seq + 1 }));
    });
    return () => setInspectorTabHandler(null);
  }, []);

  useEffect(() => {
    if (!visibleTabs.includes(tab)) {
      setTab(getDefaultInspectorTab(state.workspaceMode) as InspectorTab);
    }
  }, [state.workspaceMode, tab, visibleTabs]);

  useEffect(() => {
    if (state.tool === 'inspect') setExportSubTab('code');
  }, [state.tool]);

  const activateTab = (nextTab: InspectorTab, moveFocus = false) => {
    if (configuredTabs.includes(nextTab)) setRequestedTab(null);
    setTab(nextTab);
    if (moveFocus) {
      tabRefs.current.get(nextTab)?.focus();
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const allTabs = visibleTabs;
    if (allTabs.length === 0) return;
    let next: InspectorTab | undefined;
    if (event.key === 'ArrowRight') {
      next = allTabs[(index + 1) % allTabs.length];
    } else if (event.key === 'ArrowLeft') {
      next = allTabs[(index - 1 + allTabs.length) % allTabs.length];
    } else if (event.key === 'Home') {
      next = allTabs[0];
    } else if (event.key === 'End') {
      next = allTabs[allTabs.length - 1];
    }
    if (next) {
      event.preventDefault();
      activateTab(next, true);
    }
  };

  return (
    <section className="editor-inspector" aria-label="Inspector">
      <div className="insp-panel__tabs" role="tablist" aria-label="Inspector tabs">
        {visibleTabs.map((t) => (
          <button
            type="button"
            key={t}
            ref={(element) => {
              if (element) tabRefs.current.set(t, element);
              else tabRefs.current.delete(t);
            }}
            id={`insp-tab-${t}`}
            role="tab"
            className="insp-panel__tab"
            aria-selected={tab === t}
            aria-controls={`insp-tabpanel-${t}`}
            tabIndex={tab === t ? 0 : -1}
            onClick={() => activateTab(t)}
            onKeyDown={(e) => handleTabKeyDown(e, visibleTabs.indexOf(t))}
          >
            {FALLBACK_TAB_LABELS[t]}
          </button>
        ))}
      </div>

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
          <SelectionLockGuard locked={hasLockedSelection} hidden={hasHiddenSelection}>
            {summary.kind === 'empty' && <EmptySelectionState />}
            {summary.kind === 'single' && <SingleSelectionPanel nodes={selNodes} />}
            {summary.kind === 'multi' && <MultiSelectionPanel nodes={selNodes} summary={summary} />}
          </SelectionLockGuard>
        </div>
      )}

      {tab === 'appearance' && (
        <LazyTabPanel tab={tab}>
          <SelectionLockGuard locked={hasLockedSelection} hidden={hasHiddenSelection}>
            <AppearancePanel />
          </SelectionLockGuard>
        </LazyTabPanel>
      )}
      {tab === 'adjustments' && (
        <LazyTabPanel tab={tab}>
          <SelectionLockGuard locked={hasLockedSelection} hidden={hasHiddenSelection}>
            <AdjustmentsPanel />
          </SelectionLockGuard>
        </LazyTabPanel>
      )}
      {tab === 'prototype' && (
        <LazyTabPanel tab={tab}>
          <SelectionLockGuard locked={hasLockedSelection} hidden={hasHiddenSelection}>
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
          <div className="insp-panel__sub-tabs" role="tablist" aria-label="Export options">
            <button
              type="button"
              role="tab"
              className="insp-panel__sub-tab"
              aria-selected={exportSubTab === 'format'}
              onClick={() => setExportSubTab('format')}
            >
              Format
            </button>
            <button
              type="button"
              role="tab"
              className="insp-panel__sub-tab"
              aria-selected={exportSubTab === 'code'}
              onClick={() => setExportSubTab('code')}
            >
              Code
            </button>
          </div>
          <div className="insp-panel__sub-content">
            {exportSubTab === 'format' && selNodes.length > 0 ? (
              <AssetExportControls
                node={selNodes[0] as SceneNode}
                doc={state.document}
                platform={platform}
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
        <LazyTabPanel tab={tab}>
          <AuditPanel request={intelRequest} />
        </LazyTabPanel>
      )}
      {tab === 'fonts' && (
        <LazyTabPanel tab={tab}>
          <FontBrowserPanel onSelect={() => {}} />
        </LazyTabPanel>
      )}
    </section>
  );
}

function LazyTabPanel({ tab, children }: { tab: InspectorTab; children: React.ReactNode }) {
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
            Loading {FALLBACK_TAB_LABELS[tab].toLowerCase()}…
          </p>
        }
      >
        {children}
      </Suspense>
    </div>
  );
}

function SelectionLockGuard({
  locked,
  hidden,
  children,
}: {
  locked: boolean;
  hidden: boolean;
  children: React.ReactNode;
}) {
  return (
    <>
      {locked && (
        <p className="insp-panel__empty-hint" role="status">
          Selection is locked. Unlock it in Layers to edit these controls.
        </p>
      )}
      {!locked && hidden && (
        <p className="insp-panel__empty-hint" role="status">
          Selection is hidden. Changes apply, but canvas feedback is unavailable until it is shown.
        </p>
      )}
      <div
        aria-disabled={locked || undefined}
        {...(locked ? ({ inert: true } as Record<string, unknown>) : {})}
      >
        {children}
      </div>
    </>
  );
}

function EmptySelectionState() {
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
        description="Select a layer to edit its properties"
      />
      <Suspense
        fallback={
          <p className="insp-panel__empty-hint" role="status">
            Loading document settings…
          </p>
        }
      >
        <DocumentPanel />
      </Suspense>
    </div>
  );
}

function SingleSelectionPanel({ nodes }: { nodes: SceneNode[] }) {
  const { state } = useEditor();
  const node = nodes[0] as SceneNode;
  const isFrame = node.kind === 'frame';
  const isComponentInstance = isFrame && (node as import('@strata/scene').FrameNode).componentId;
  const isRect =
    node.kind === 'shape' && (node as import('@strata/scene').ShapeNode).shape.kind === 'rect';

  const sectionEntries = useMemo(() => {
    const availabilityCtx: SectionAvailabilityContext = {
      selectionKind: 'single',
      selectedNodes: nodes,
      sharedKind: node.kind,
      workspaceMode: state.workspaceMode,
      activeTool: state.tool,
      prototypeMode: state.prototypeMode,
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

    if (isComponentInstance)
      add('component', <ComponentSection node={node as import('@strata/scene').FrameNode} />);
    add('position-size', <PositionSizeSection nodes={nodes} />);
    add('constraints', <ConstraintSection nodes={nodes} />);
    if (isRect || isFrame) add('corner-radius', <CornerRadiusSection nodes={nodes} />);
    if (isFrame) add('layout', <LayoutSection node={node as import('@strata/scene').FrameNode} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
    add('image-placement', <ImagePlacementSection nodes={nodes} />);
    add('stroke', <StrokeSection nodes={nodes} />);
    add('typography', <TypographySection nodes={nodes} />);

    return entries.sort((a, b) => a.order - b.order);
  }, [nodes, node, isFrame, isComponentInstance, isRect, state]);

  return (
    <>
      <header className="insp-panel__node-header">
        <p className="insp-panel__node-name">
          {node.name}
          <span className="insp-panel__node-kind">{node.kind}</span>
        </p>
      </header>
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
    add('fills', <FillSection nodes={nodes} />);
    add('stroke', <StrokeSection nodes={nodes} />);
    add('typography', <TypographySection nodes={nodes} />);

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
