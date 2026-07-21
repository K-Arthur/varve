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
import type { ColorMode, ManagedColor, SceneNode } from '@strata/scene';
import { managedColorToCss } from '@strata/shared';
import { EmptyState } from '@strata/ui';
import { useEffect, useMemo, useState } from 'react';
import { setInspectorTabHandler, useEditor } from '../../context';
import type { IntelligenceTab } from '../../context/types';
import { docVariableStore } from '../../docVariableStore';
import { IntelligencePanel } from '../../panels/IntelligencePanel';
import { AdjustmentPanel } from '../AdjustmentLayer/AdjustmentPanel';
import { PrototypeFlowView } from '../Prototype/PrototypeFlowView';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { SpecPanel } from '../SpecPanel/SpecPanel';
import { DisclosureSection } from './controls/DisclosureSection';
import { InspectorColorPopover } from './controls/InspectorColorPopover';
import { SectionManagerTrigger } from './SectionManagerTrigger';
import type { SectionId } from './sectionRegistry';
import { AdaptiveContrastSection } from './sections/AdaptiveContrastSection';
import { AIDenoiseSection } from './sections/AIDenoiseSection';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AppearanceSection } from './sections/AppearanceSection';
import { BackgroundRemovalSection } from './sections/BackgroundRemovalSection';
import { BrushSection } from './sections/BrushSection';
import { CognitiveLoadIndicator } from './sections/CognitiveLoadIndicator';
import { ComponentSection } from './sections/ComponentSection';
import { ConstraintSection } from './sections/ConstraintSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
import { FramePresetsSection } from './sections/FramePresetsSection';
import { ImageEnhancementSection } from './sections/ImageEnhancementSection';
import { ImagePlacementSection } from './sections/ImagePlacementSection';
import { InteractionSection } from './sections/InteractionSection';
import { LayoutScoreSection } from './sections/LayoutScoreSection';
import { LayoutSection } from './sections/LayoutSection';
import { LensBlurSection } from './sections/LensBlurSection';
import { LineArtSection } from './sections/LineArtSection';
import { MaskSection } from './sections/MaskSection';
import { PaintLibrarySection } from './sections/PaintLibrarySection';
import { PositionSizeSection } from './sections/PositionSizeSection';
import { StrokeSection } from './sections/StrokeSection';
import { TypographySection } from './sections/TypographySection';
import { type SelectionSummary, summarize } from './selection/selectionState';

import './inspector.css';

type Tab = 'properties' | 'export' | 'spec' | 'score' | 'audit';

export function PropertiesPanel() {
  const { selectedNodes, state, platform } = useEditor();
  const selNodes = selectedNodes();
  const summary = summarize(selNodes);
  const [tab, setTab] = useState<Tab>('properties');
  const [intelRequest, setIntelRequest] = useState<{ subTab?: IntelligenceTab; seq: number }>({
    seq: 0,
  });

  useEffect(() => {
    setInspectorTabHandler(({ tab: nextTab, subTab }) => {
      setTab(nextTab);
      setIntelRequest((r) => ({ subTab, seq: r.seq + 1 }));
    });
    return () => setInspectorTabHandler(null);
  }, []);

  if (state.tool === 'inspect') {
    return (
      <section className="editor-inspector" aria-label="Inspector">
        <SpecPanel
          nodes={selNodes}
          doc={state.document}
          variableStore={docVariableStore(state.document)}
          platform={platform}
        />
      </section>
    );
  }

  return (
    <section className="editor-inspector" aria-label="Inspector">
      <div
        className="insp-panel__tabs"
        role="tablist"
        aria-label="Inspector tabs"
        onKeyDown={(e) => {
          const tabs: Tab[] = ['properties', 'export', 'spec', 'score', 'audit'];
          const idx = tabs.indexOf(tab);
          if (e.key === 'ArrowRight') {
            e.preventDefault();
            setTab(tabs[(idx + 1) % tabs.length]!);
          } else if (e.key === 'ArrowLeft') {
            e.preventDefault();
            setTab(tabs[(idx - 1 + tabs.length) % tabs.length]!);
          }
        }}
      >
        {(['properties', 'export', 'spec', 'score', 'audit'] as const).map((t) => (
          <button
            type="button"
            key={t}
            id={`insp-tab-${t}`}
            role="tab"
            className="insp-panel__tab"
            aria-selected={tab === t}
            aria-controls="insp-tabpanel"
            tabIndex={tab === t ? 0 : -1}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'properties' && (
        <div
          className="insp-panel"
          id="insp-tabpanel"
          role="tabpanel"
          aria-labelledby="insp-tab-properties"
        >
          <div className="insp-panel__header">
            <SectionManagerTrigger />
          </div>
          {state.tool === 'frame' && summary.kind !== 'single' && (
            <FramePresetsSection mode="create" sectionId="frame-presets" />
          )}
          {summary.kind === 'empty' &&
            state.tool !== 'frame' &&
            state.tool !== 'paint' &&
            state.tool !== 'eraser' &&
            state.tool !== 'pencil' &&
            state.tool !== 'smudge' && <EmptySelectionState />}
          {(state.tool === 'paint' ||
            state.tool === 'eraser' ||
            state.tool === 'pencil' ||
            state.tool === 'smudge') && (
            <BrushSection tool={state.tool} sectionId="brush-settings" />
          )}
          {summary.kind === 'single' && <SingleSelectionPanel nodes={selNodes} />}
          {summary.kind === 'multi' && <MultiSelectionPanel nodes={selNodes} summary={summary} />}
        </div>
      )}

      {tab === 'export' && (
        <div
          className="insp-panel"
          id="insp-tabpanel"
          role="tabpanel"
          aria-labelledby="insp-tab-export"
        >
          {selNodes.length > 0 ? (
            <>
              <AssetExportControls
                node={selNodes[0] as SceneNode}
                doc={state.document}
                platform={platform}
              />
              <CodeGenView
                node={selNodes[0] as SceneNode}
                doc={state.document}
                variableStore={docVariableStore(state.document)}
              />
            </>
          ) : (
            <p className="insp-panel__empty-hint">
              Select a node to export it as SVG, PNG, PDF, or generate code.
            </p>
          )}
        </div>
      )}
      {tab === 'spec' && (
        <div id="insp-tabpanel" role="tabpanel" aria-labelledby="insp-tab-spec">
          <SpecPanel
            nodes={selNodes}
            doc={state.document}
            variableStore={docVariableStore(state.document)}
            platform={platform}
          />
        </div>
      )}
      {tab === 'score' && (
        <div
          className="insp-panel"
          id="insp-tabpanel"
          role="tabpanel"
          aria-labelledby="insp-tab-score"
        >
          <LayoutScoreSection />
        </div>
      )}
      {tab === 'audit' && (
        <div id="insp-tabpanel" role="tabpanel" aria-labelledby="insp-tab-audit">
          <IntelligencePanel key={intelRequest.seq} initialTab={intelRequest.subTab} />
        </div>
      )}
    </section>
  );
}

function whiteForMode(mode: ColorMode): ManagedColor {
  switch (mode) {
    case 'cmyk':
      return { space: 'cmyk', c: 0, m: 0, y: 0, k: 0, a: 255 };
    case 'grayscale':
      return { space: 'gray', v: 255, a: 255 };
    default:
      return { space: 'rgb', r: 255, g: 255, b: 255, a: 255 };
  }
}

function EmptySelectionState() {
  const { state, setCanvasBackground, switchColorMode, documentColorMode } = useEditor();
  const doc = state.document;
  const count = Object.keys(doc.nodes).length;
  const canvasBg: ManagedColor | undefined = doc.canvasBackground;
  const fallbackColor = useMemo(() => whiteForMode(documentColorMode), [documentColorMode]);
  const canvasBgColor = canvasBg ?? fallbackColor;
  const swatchBackground = useMemo(() => managedColorToCss(canvasBgColor), [canvasBgColor]);

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
      <DisclosureSection title="Canvas" sectionId="canvas-background" defaultExpanded={true}>
        <div className="insp-canvas-props">
          <div className="insp-field">
            <span className="insp-field__label">Background</span>
            <div className="insp-field__control">
              <InspectorColorPopover
                label="Canvas background"
                value={canvasBgColor}
                onChange={setCanvasBackground}
                swatchStyle={{ background: swatchBackground }}
                documentColorMode={documentColorMode}
              />
            </div>
          </div>
        </div>
      </DisclosureSection>
      <DisclosureSection title="Document Color" sectionId="document-color" defaultExpanded={true}>
        <div className="insp-panel__color-mode">
          <span className="insp-panel__color-mode-label">Mode</span>
          <div className="insp-panel__color-mode-buttons">
            {(['rgb', 'cmyk', 'grayscale'] as const).map((mode) => (
              <button
                key={mode}
                type="button"
                className={`insp-panel__color-mode-btn${documentColorMode === mode ? ' insp-panel__color-mode-btn--active' : ''}`}
                onClick={() => switchColorMode(mode)}
                aria-pressed={documentColorMode === mode}
              >
                {mode === 'rgb' ? 'RGB' : mode === 'cmyk' ? 'CMYK' : 'Grayscale'}
              </button>
            ))}
          </div>
        </div>
      </DisclosureSection>
      <div className="insp-panel__canvas-info">
        <p className="insp-panel__canvas-name">{doc.name}</p>
        <p className="insp-panel__canvas-count">
          {count} {count === 1 ? 'node' : 'nodes'}
        </p>
      </div>
    </div>
  );
}

function SingleSelectionPanel({ nodes }: { nodes: SceneNode[] }) {
  const {
    state,
    navigatePrototypeTo,
    prototypeCurrentScreen,
    selectedInteractionId,
    selectPrototypeInteraction,
  } = useEditor();
  const node = nodes[0] as SceneNode;
  const isFrame = node.kind === 'frame';
  const isComponentInstance = isFrame && (node as import('@strata/scene').FrameNode).componentId;
  const isRect =
    node.kind === 'shape' && (node as import('@strata/scene').ShapeNode).shape.kind === 'rect';

  // Build ordered section list based on state ordering
  const sectionEntries = useMemo(() => {
    const entries: { id: SectionId; order: number; el: React.ReactNode }[] = [];
    const add = (id: SectionId, el: React.ReactNode) => {
      const o = state.sectionVisibility[id]?.order;
      entries.push({ id, order: o ?? 500, el });
    };

    if (isComponentInstance)
      add('component', <ComponentSection node={node as import('@strata/scene').FrameNode} />);
    if (isFrame && !isComponentInstance)
      add('frame-presets', <FramePresetsSection mode="resize" />);
    add('position-size', <PositionSizeSection nodes={nodes} />);
    add('constraints', <ConstraintSection nodes={nodes} />);
    if (isRect || isFrame) add('corner-radius', <CornerRadiusSection nodes={nodes} />);
    if (isFrame) add('layout', <LayoutSection node={node as import('@strata/scene').FrameNode} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    add('mask', <MaskSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
    add('paint-library', <PaintLibrarySection />);
    add('image-placement', <ImagePlacementSection nodes={nodes} />);
    add('image-enhancement', <ImageEnhancementSection nodes={nodes} />);
    add('background-removal', <BackgroundRemovalSection nodes={nodes} />);
    add('ai-denoise', <AIDenoiseSection nodes={nodes} />);
    add('lens-blur', <LensBlurSection nodes={nodes} />);
    add('line-art', <LineArtSection nodes={nodes} />);
    add('stroke', <StrokeSection nodes={nodes} />);
    add('effects', <EffectsSection nodes={nodes} />);
    add('typography', <TypographySection nodes={nodes} />);
    const isText = nodes.length > 0 && nodes.every((n) => n.kind === 'text');
    if (isText) add('adaptive-contrast', <AdaptiveContrastSection nodes={nodes} />);
    add('interaction', <InteractionSection />);
    if (state.prototypeMode) {
      add(
        'prototype-flow',
        <DisclosureSection title="Prototype Flow" sectionId="prototype-flow" defaultExpanded>
          <PrototypeFlowView
            document={state.document}
            currentScreenId={prototypeCurrentScreen}
            selectedInteractionId={selectedInteractionId}
            onSelectScreen={navigatePrototypeTo}
            onSelectInteraction={selectPrototypeInteraction}
          />
        </DisclosureSection>,
      );
    }
    add(
      'cognitive-load',
      <DisclosureSection title="Cognitive Load" sectionId="cognitive-load" defaultExpanded={false}>
        <CognitiveLoadIndicator document={state.document} nodeId={node.id} />
      </DisclosureSection>,
    );

    return entries.sort((a, b) => a.order - b.order);
  }, [
    nodes,
    node,
    isFrame,
    isComponentInstance,
    isRect,
    state,
    prototypeCurrentScreen,
    selectedInteractionId,
    navigatePrototypeTo,
    selectPrototypeInteraction,
  ]);

  return (
    <>
      <header className="insp-panel__node-header">
        <p className="insp-panel__node-name">
          {node.name}
          <span className="insp-panel__node-kind">{node.kind}</span>
        </p>
      </header>
      <AdjustmentPanel />
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
    const entries: { id: SectionId; order: number; el: React.ReactNode }[] = [];
    const add = (id: SectionId, el: React.ReactNode) => {
      const o = state.sectionVisibility[id]?.order;
      entries.push({ id, order: o ?? 500, el });
    };

    add('position-size', <PositionSizeSection nodes={nodes} />);
    add('appearance', <AppearanceSection nodes={nodes} />);
    add('fills', <FillSection nodes={nodes} />);
    add('paint-library', <PaintLibrarySection />);
    add('stroke', <StrokeSection nodes={nodes} />);
    add('effects', <EffectsSection nodes={nodes} />);
    add('typography', <TypographySection nodes={nodes} />);
    add(
      'cognitive-load',
      <DisclosureSection title="Cognitive Load" sectionId="cognitive-load" defaultExpanded={false}>
        <CognitiveLoadIndicator document={state.document} nodeId={null} />
      </DisclosureSection>,
    );

    return entries.sort((a, b) => a.order - b.order);
  }, [nodes, state]);

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
