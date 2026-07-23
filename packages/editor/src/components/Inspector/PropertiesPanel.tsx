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
import { lazy, Suspense, useCallback, useEffect, useMemo, useRef, useState } from 'react';
import { setInspectorTabHandler, useEditor } from '../../context';
import type { InspectorTab, IntelligenceTab } from '../../context/types';
import { docVariableStore } from '../../docVariableStore';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { QuickBar } from './sections/QuickBar';
import {
  getDefaultInspectorTab,
  getGroupedInspectorTabs,
  getVisibleInspectorTabs,
  getWorkspaceConfig,
  TAB_GROUP_ORDER,
  type InspectorTabGroup,
  type InspectorTabId,
} from '../../workspace/workspaceTypes';
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
import './inspector-shell.css';

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

type ExportSubTab = 'format' | 'code';

const FALLBACK_TAB_LABELS: Record<InspectorTab, string> = {
  properties: 'Properties',
  appearance: 'Appearance & Effects',
  adjustments: 'Adjustments',
  prototype: 'Prototype',
  export: 'Export',
  audit: 'Audit',
};

const TAB_ORDER: InspectorTab[] = [
  'properties',
  'appearance',
  'adjustments',
  'prototype',
  'export',
  'audit',
];

const FOCUSABLE_TAB_SELECTOR = '[role="tab"]:not(.insp-panel__tab--overflow)';

function SecondaryTabBar({
  tabs,
  activeTab,
  workspaceMode,
  overflowTabs,
  overflowOpen,
  onOverflowToggle,
  onActivateTab,
  tabRefs,
}: {
  tabs: InspectorTab[];
  activeTab: InspectorTab;
  workspaceMode: string;
  overflowTabs: InspectorTab[];
  overflowOpen: boolean;
  onOverflowToggle: (open: boolean) => void;
  onActivateTab: (tab: InspectorTab, moveFocus?: boolean) => void;
  tabRefs: React.MutableRefObject<Map<InspectorTab, HTMLButtonElement>>;
}) {
  const groupedTabs = useMemo(() => {
    const groups = getGroupedInspectorTabs(
      workspaceMode as import('../../workspace/workspaceTypes').WorkspaceMode,
    );
    const result: { group: InspectorTabGroup; tabs: InspectorTab[] }[] = [];
    for (const g of TAB_GROUP_ORDER) {
      const configs = groups[g];
      if (!configs || configs.length === 0) continue;
      const inGroup = configs.map((c) => c.id as InspectorTab).filter((id) => tabs.includes(id));
      if (inGroup.length > 0) {
        result.push({ group: g, tabs: inGroup });
      }
    }
    return result;
  }, [tabs, workspaceMode]);

  const visibleTabList = tabs.filter((t) => !overflowTabs.includes(t));

  const handleKeyDown = (event: React.KeyboardEvent, index: number) => {
    if (visibleTabList.length === 0) return;
    let next: InspectorTab | undefined;
    if (event.key === 'ArrowRight') {
      next = visibleTabList[(index + 1) % visibleTabList.length];
    } else if (event.key === 'ArrowLeft') {
      next = visibleTabList[(index - 1 + visibleTabList.length) % visibleTabList.length];
    } else if (event.key === 'Home') {
      next = visibleTabList[0];
    } else if (event.key === 'End') {
      next = visibleTabList[visibleTabList.length - 1];
    }
    if (next) {
      event.preventDefault();
      onActivateTab(next, true);
    }
  };

  return (
    <div style={{ display: 'flex', alignItems: 'stretch' }}>
      <div className="insp-panel__tabs-secondary" role="tablist" aria-label="Inspector workflows">
        {groupedTabs.map(({ group, tabs: groupTabs }, gi) => (
          <span key={group} className="insp-panel__tab-group">
            {gi > 0 && (
              <span className="insp-panel__tab-sep" aria-hidden>
                <svg
                  width="10"
                  height="10"
                  viewBox="0 0 10 10"
                  fill="none"
                  stroke="currentColor"
                  strokeWidth="1.5"
                  strokeLinecap="round"
                  strokeLinejoin="round"
                >
                  <path d="m3.5 2.5 3 3-3 3" />
                </svg>
              </span>
            )}
            {groupTabs.map((t) => {
              const idx = visibleTabList.indexOf(t);
              return (
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
                  aria-selected={activeTab === t}
                  aria-controls={`insp-tabpanel-${t}`}
                  tabIndex={activeTab === t ? 0 : -1}
                  onClick={() => onActivateTab(t)}
                  onKeyDown={(e) => handleKeyDown(e, idx)}
                >
                  {FALLBACK_TAB_LABELS[t]}
                </button>
              );
            })}
          </span>
        ))}
      </div>
      {overflowTabs.length > 0 && (
        <div className="insp-panel__overflow" style={{ position: 'relative' }}>
          <button
            type="button"
            className="insp-panel__tab insp-panel__tab--overflow"
            aria-label={`${overflowTabs.length} more tabs`}
            aria-expanded={overflowOpen}
            onClick={() => onOverflowToggle(!overflowOpen)}
          >
            <svg
              width="14"
              height="14"
              viewBox="0 0 24 24"
              fill="none"
              stroke="currentColor"
              strokeWidth="2"
              strokeLinecap="round"
              strokeLinejoin="round"
              aria-hidden
            >
              <circle cx="12" cy="5" r="1" />
              <circle cx="12" cy="12" r="1" />
              <circle cx="12" cy="19" r="1" />
            </svg>
          </button>
          {overflowOpen && (
            <>
              <div
                className="insp-panel__overflow-backdrop"
                onClick={() => onOverflowToggle(false)}
              />
              <div className="insp-panel__overflow-menu" role="menu">
                {overflowTabs.map((t) => (
                  <button
                    key={t}
                    type="button"
                    role="menuitem"
                    className="insp-panel__overflow-item"
                    onClick={() => {
                      onActivateTab(t);
                      onOverflowToggle(false);
                    }}
                  >
                    {FALLBACK_TAB_LABELS[t]}
                  </button>
                ))}
              </div>
            </>
          )}
        </div>
      )}
    </div>
  );
}

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

  const { primaryTabs, secondaryTabs } = useMemo(() => {
    const primary: InspectorTab[] = [];
    const secondary: InspectorTab[] = [];
    const configs = getWorkspaceConfig(state.workspaceMode).inspectorTabs;
    const tierMap = new Map<InspectorTabId, 'primary' | 'secondary'>();
    for (const c of configs) {
      tierMap.set(c.id, c.group === 'primary' ? 'primary' : 'secondary');
    }
    for (const t of visibleTabs) {
      const tier = tierMap.get(t as InspectorTabId) ?? 'secondary';
      if (tier === 'primary') primary.push(t);
      else secondary.push(t);
    }
    return { primaryTabs: primary, secondaryTabs: secondary };
  }, [visibleTabs, state.workspaceMode]);
  const [intelRequest, setIntelRequest] = useState<{ subTab?: IntelligenceTab; seq: number }>({
    seq: 0,
  });

  const [exportSubTab, setExportSubTab] = useState<ExportSubTab>('format');

  const tabBarRef = useRef<HTMLDivElement>(null);
  const [overflowTabs, setOverflowTabs] = useState<InspectorTab[]>([]);
  const [overflowOpen, setOverflowOpen] = useState(false);
  const prevOverflowRef = useRef<InspectorTab[]>([]);

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

  const measureOverflow = useCallback(() => {
    const el = tabBarRef.current;
    if (!el) return;
    const availWidth = el.clientWidth;
    if (visibleTabs.length <= 1) {
      const empty: InspectorTab[] = [];
      if (prevOverflowRef.current.length > 0) {
        prevOverflowRef.current = empty;
        setOverflowTabs(empty);
        setOverflowOpen(false);
      }
      return;
    }
    const buttons = Array.from(el.querySelectorAll(FOCUSABLE_TAB_SELECTOR)) as HTMLElement[];
    if (buttons.length === 0) return;
    const totalWidth = buttons.reduce((sum, btn) => sum + btn.scrollWidth + 2, 0);
    const overflowBtnWidth = 36;

    let overflow: InspectorTab[];
    if (totalWidth > availWidth) {
      const configs = getWorkspaceConfig(state.workspaceMode).inspectorTabs;
      const tabMap = new Map(configs.map((c) => [c.id, c]));
      const sorted = [...visibleTabs].sort((a, b) => {
        const pa = tabMap.get(a)?.overflowPriority ?? 1;
        const pb = tabMap.get(b)?.overflowPriority ?? 1;
        return pb - pa;
      });
      const fixed = sorted.filter((t) => (tabMap.get(t)?.overflowPriority ?? 1) === 0);
      const movable = sorted.filter((t) => (tabMap.get(t)?.overflowPriority ?? 1) > 0);
      let used = 0;
      for (const btn of buttons) {
        const btnTab = visibleTabs[buttons.indexOf(btn)];
        if (btnTab && fixed.includes(btnTab)) {
          used += btn.scrollWidth + 2;
        }
      }
      used += overflowBtnWidth;
      overflow = [];
      for (const t of movable) {
        const btnIndex = visibleTabs.indexOf(t);
        const btn = buttons[btnIndex];
        if (!btn) continue;
        const w = btn.scrollWidth + 2;
        if (used + w > availWidth) {
          overflow.push(t);
        } else {
          used += w;
        }
      }
    } else {
      overflow = [];
    }

    if (!arraysEqual(prevOverflowRef.current, overflow)) {
      prevOverflowRef.current = overflow;
      setOverflowTabs(overflow);
      if (overflow.length === 0) setOverflowOpen(false);
    }
    if (
      overflow.length > 0 &&
      overflow.includes(tab) &&
      visibleTabs[0] &&
      !overflow.includes(visibleTabs[0])
    ) {
      setTab(visibleTabs[0]);
    }
  }, [visibleTabs, state.workspaceMode, tab]);

  useEffect(() => {
    measureOverflow();
    const ro = new ResizeObserver(measureOverflow);
    const el = tabBarRef.current;
    if (el) ro.observe(el);
    return () => ro.disconnect();
  }, [measureOverflow]);

  const activateTab = (nextTab: InspectorTab, moveFocus = false) => {
    if (configuredTabs.includes(nextTab)) setRequestedTab(null);
    setTab(nextTab);
    if (moveFocus) {
      tabRefs.current.get(nextTab)?.focus();
    }
  };

  const handleTabKeyDown = (event: React.KeyboardEvent, index: number) => {
    const allTabs = visibleTabs.filter((t) => !overflowTabs.includes(t));
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
    } else if (event.key === 'Escape') {
      setOverflowOpen(false);
      return;
    }
    if (next) {
      event.preventDefault();
      activateTab(next, true);
    }
  };

  const useTwoTier = secondaryTabs.length > 0;

  return (
    <section className="editor-inspector" aria-label="Inspector">
      <div
        ref={tabBarRef}
        className={useTwoTier ? 'insp-panel__tabs' : 'insp-panel__tabs insp-panel__tabs--single'}
      >
        {useTwoTier ? (
          <>
            <div className="insp-panel__tabs-primary" role="tablist" aria-label="Primary inspector">
              {primaryTabs.map((t) => (
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
                >
                  {FALLBACK_TAB_LABELS[t]}
                </button>
              ))}
            </div>
            <div className="insp-panel__tier-sep" />
            <SecondaryTabBar
              tabs={secondaryTabs}
              activeTab={tab}
              workspaceMode={state.workspaceMode}
              overflowTabs={overflowTabs}
              overflowOpen={overflowOpen}
              onOverflowToggle={setOverflowOpen}
              onActivateTab={activateTab}
              tabRefs={tabRefs}
            />
          </>
        ) : (
          <div className="insp-panel__tab-group" role="tablist" aria-label="Inspector tabs">
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
        )}
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
            {summary.kind === 'empty' && <EmptySelectionState showDocumentSettings />}
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
    </section>
  );
}

/** Stable comparison for arrays of primitives. */
function arraysEqual(a: InspectorTab[], b: InspectorTab[]): boolean {
  if (a.length !== b.length) return false;
  for (let i = 0; i < a.length; i++) {
    if (a[i] !== b[i]) return false;
  }
  return true;
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

function EmptySelectionState({ showDocumentSettings }: { showDocumentSettings?: boolean }) {
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
      {showDocumentSettings && (
        <div className="insp-panel__empty-doc">
          <DocumentSummary />
        </div>
      )}
    </div>
  );
}

function DocumentSummary() {
  const { state } = useEditor();
  const doc = state.document;
  const count = Object.keys(doc.nodes).length;

  return (
    <>
      <div className="insp-panel__canvas-info">
        <p className="insp-panel__canvas-name">{doc.name}</p>
        <p className="insp-panel__canvas-count">
          {count} {count === 1 ? 'node' : 'nodes'}
        </p>
      </div>
      <div className="insp-panel__empty-doc-buttons">
        <button
          type="button"
          className="insp-btn-sm"
          onClick={() => {
            const bgSection = document.getElementById('insp-section-canvas-background');
            bgSection?.scrollIntoView({ behavior: 'smooth' });
            bgSection?.querySelector<HTMLButtonElement>('[aria-expanded="false"]')?.click();
          }}
        >
          Canvas background
        </button>
      </div>
    </>
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
      <QuickBar node={node} />
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
