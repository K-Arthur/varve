/**
 * PropertiesPanel — the fully-featured Inspector for Strata.
 *
 * Orchestrates all sections based on selection state (empty/single/multi).
 * Maps to the right-side inspector slot in Shell's CSS Grid.
 *
 * F6: Empty state shows document/canvas info. Single shows full property set.
 * Multi shows shared properties with "Mixed" indicators and batch editing.
 *
 * Research basis: Figma/Sketch right-sidebar inspector; APG Disclosure,
 * Spinbutton, Combobox, Radiogroup, Slider patterns.
 */
import type { ColorMode, ManagedColor, SceneNode } from '@strata/scene';
import { managedColorToCss } from '@strata/shared';
import { EmptyState } from '@strata/ui';
import { useMemo, useState } from 'react';
import { useEditor } from '../../context';
import { docVariableStore } from '../../docVariableStore';
import { IntelligencePanel } from '../../panels/IntelligencePanel';
import { AdjustmentPanel } from '../AdjustmentLayer/AdjustmentPanel';
import { PrototypeFlowView } from '../Prototype/PrototypeFlowView';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { SpecPanel } from '../SpecPanel/SpecPanel';
import { DisclosureSection } from './controls/DisclosureSection';
import { InspectorColorPopover } from './controls/InspectorColorPopover';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AppearanceSection } from './sections/AppearanceSection';
import { BackgroundRemovalSection } from './sections/BackgroundRemovalSection';
import { BrushSection } from './sections/BrushSection';
import { CognitiveLoadIndicator } from './sections/CognitiveLoadIndicator';
import { ComponentSection } from './sections/ComponentSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
import { FramePresetsSection } from './sections/FramePresetsSection';
import { ImageEnhancementSection } from './sections/ImageEnhancementSection';
import { ImagePlacementSection } from './sections/ImagePlacementSection';
import { InteractionSection } from './sections/InteractionSection';
import { LayoutScoreSection } from './sections/LayoutScoreSection';
import { LayoutSection } from './sections/LayoutSection';
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
      <div className="insp-panel__tabs" role="tablist" aria-label="Inspector tabs">
        {(['properties', 'export', 'spec', 'score', 'audit'] as const).map((t) => (
          <button
            type="button"
            key={t}
            role="tab"
            className="insp-panel__tab"
            aria-selected={tab === t}
            onClick={() => setTab(t)}
          >
            {t}
          </button>
        ))}
      </div>

      {tab === 'properties' && (
        <div className="insp-panel">
          {state.tool === 'frame' && summary.kind !== 'single' && (
            <FramePresetsSection mode="create" />
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
            state.tool === 'smudge') && <BrushSection tool={state.tool} />}
          {summary.kind === 'single' && <SingleSelectionPanel nodes={selNodes} />}
          {summary.kind === 'multi' && <MultiSelectionPanel nodes={selNodes} summary={summary} />}
        </div>
      )}

      {tab === 'export' && (
        <div className="insp-panel">
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
        <SpecPanel
          nodes={selNodes}
          doc={state.document}
          variableStore={docVariableStore(state.document)}
          platform={platform}
        />
      )}
      {tab === 'score' && (
        <div className="insp-panel">
          <LayoutScoreSection />
        </div>
      )}
      {tab === 'audit' && <IntelligencePanel />}
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
      <DisclosureSection title="Canvas" defaultExpanded={true}>
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
      <DisclosureSection title="Document Color" defaultExpanded={true}>
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

  return (
    <>
      <header className="insp-panel__node-header">
        <p className="insp-panel__node-name">
          {node.name}
          <span className="insp-panel__node-kind">{node.kind}</span>
        </p>
      </header>
      {isComponentInstance && <ComponentSection node={node as import('@strata/scene').FrameNode} />}
      {isFrame && !isComponentInstance && <FramePresetsSection mode="resize" />}
      <AdjustmentPanel />
      <PositionSizeSection nodes={nodes} />
      {(isRect || isFrame) && <CornerRadiusSection nodes={nodes} />}
      {isFrame && <LayoutSection node={node as import('@strata/scene').FrameNode} />}
      <AppearanceSection nodes={nodes} />
      <MaskSection nodes={nodes} />
      <FillSection nodes={nodes} />
      <PaintLibrarySection />
      <ImagePlacementSection nodes={nodes} />
      <ImageEnhancementSection nodes={nodes} />
      <BackgroundRemovalSection nodes={nodes} />
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
      <InteractionSection />
      {state.prototypeMode && (
        <DisclosureSection title="Prototype Flow" defaultExpanded>
          <PrototypeFlowView
            document={state.document}
            currentScreenId={prototypeCurrentScreen}
            selectedInteractionId={selectedInteractionId}
            onSelectScreen={navigatePrototypeTo}
            onSelectInteraction={selectPrototypeInteraction}
          />
        </DisclosureSection>
      )}
      <DisclosureSection title="Cognitive Load" defaultExpanded={false}>
        <CognitiveLoadIndicator document={state.document} nodeId={node.id} />
      </DisclosureSection>
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
  return (
    <>
      <div className="insp-panel__multi-count" role="status">
        {summary.sharedKind
          ? `${nodes.length} ${summary.sharedKind} selected`
          : `${nodes.length} selected`}
      </div>
      <AlignDistributeBar />
      <PositionSizeSection nodes={nodes} />
      <AppearanceSection nodes={nodes} />
      <FillSection nodes={nodes} />
      <PaintLibrarySection />
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
      <DisclosureSection title="Cognitive Load" defaultExpanded={false}>
        <CognitiveLoadIndicator document={state.document} nodeId={null} />
      </DisclosureSection>
    </>
  );
}
