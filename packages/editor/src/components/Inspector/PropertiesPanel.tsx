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
import { managedColorToRgba } from '@strata/shared';
import type { ManagedColor, SceneNode, VariableStore } from '@strata/scene';
import { EmptyState } from '@strata/ui';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { useState } from 'react';
import { useEditor } from '../../context';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { SpecPanel } from '../SpecPanel/SpecPanel';
import { DisclosureSection } from './controls/DisclosureSection';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AppearanceSection } from './sections/AppearanceSection';
import { ComponentSection } from './sections/ComponentSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
import { FramePresetsSection } from './sections/FramePresetsSection';
import { LayoutSection } from './sections/LayoutSection';
import { PositionSizeSection } from './sections/PositionSizeSection';
import { StrokeSection } from './sections/StrokeSection';
import { TypographySection } from './sections/TypographySection';
import { type SelectionSummary, summarize } from './selection/selectionState';

import './inspector.css';

type Tab = 'properties' | 'export' | 'spec';

export function PropertiesPanel() {
  const { selectedNodes, state } = useEditor();
  const selNodes = selectedNodes();
  const summary = summarize(selNodes);
  const [tab, setTab] = useState<Tab>('properties');

  if (state.tool === 'inspect') {
    return (
      <section className="editor-inspector" aria-label="Inspector">
        <SpecPanel
          nodes={selNodes}
          doc={state.document}
          variableStore={state.variableStore as VariableStore}
        />
      </section>
    );
  }

  return (
    <section className="editor-inspector" aria-label="Inspector">
      <div className="insp-panel__tabs" role="tablist" aria-label="Inspector tabs">
        {(['properties', 'export', 'spec'] as const).map((t) => (
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
          {summary.kind === 'empty' && state.tool !== 'frame' && <EmptySelectionState />}
          {summary.kind === 'single' && <SingleSelectionPanel nodes={selNodes} />}
          {summary.kind === 'multi' && <MultiSelectionPanel nodes={selNodes} summary={summary} />}
        </div>
      )}

      {tab === 'export' && (
        <div className="insp-panel">
          {selNodes.length > 0 ? (
            <>
              <AssetExportControls node={selNodes[0] as SceneNode} doc={state.document} />
              <CodeGenView
                node={selNodes[0] as SceneNode}
                doc={state.document}
                variableStore={state.variableStore as VariableStore}
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
          variableStore={state.variableStore as VariableStore}
        />
      )}
    </section>
  );
}

function EmptySelectionState() {
  const { state, setCanvasBackground } = useEditor();
  const doc = state.document;
  const count = Object.keys(doc.nodes).length;
  const canvasBg: ManagedColor | undefined = doc.canvasBackground;

  return (
    <div className="insp-panel">
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
        <div className="insp-field">
          <span className="insp-field__label">Background</span>
          <div className="insp-field__control">
            <ColorPicker
              value={canvasBg ? managedColorToRgba(canvasBg) : [0, 0, 0, 255]}
              onChange={(c) => setCanvasBackground({ space: 'rgb' as const, r: c[0], g: c[1], b: c[2], a: c[3] ?? 255 })}
            />
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
      <PositionSizeSection nodes={nodes} />
      {isRect && <CornerRadiusSection nodes={nodes} />}
      {isFrame && <LayoutSection node={node as import('@strata/scene').FrameNode} />}
      <AppearanceSection nodes={nodes} />
      <FillSection nodes={nodes} />
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
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
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
    </>
  );
}
