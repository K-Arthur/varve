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
import type { SceneNode, VariableStore } from '@strata/scene';
import { useState } from 'react';
import { useEditor } from '../../context';
import { AssetExportControls } from '../SpecPanel/AssetExportControls';
import { CodeGenView } from '../SpecPanel/CodeGenView';
import { SpecPanel } from '../SpecPanel/SpecPanel';
import { ColorPicker } from '@strata/ui/components/ColorPicker';
import { DisclosureSection } from './controls/DisclosureSection';
import { NumberField } from './controls/NumberField';
import { AlignDistributeBar } from './sections/AlignDistributeBar';
import { AppearanceSection } from './sections/AppearanceSection';
import { ComponentSection } from './sections/ComponentSection';
import { CornerRadiusSection } from './sections/CornerRadiusSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
import { FillStackSection } from './sections/FillStackSection';
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
          {summary.kind === 'empty' && <EmptyState />}
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
            <p
              style={{
                padding: 'var(--space-2)',
                fontSize: 'var(--font-size-xs)',
                color: 'var(--color-text-muted)',
              }}
            >
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

function EmptyState() {
  const { state, setCanvasWidth, setCanvasHeight, setCanvasBackground } = useEditor();
  const doc = state.document;
  const count = Object.keys(doc.nodes).length;
  const canvasBg = doc.canvasBackground ?? ([255, 255, 255, 255] as unknown);

  return (
    <div className="insp-panel">
      <div
        style={{
          padding: 'var(--space-2)',
          fontSize: 'var(--font-size-xs)',
          color: 'var(--color-text-muted)',
        }}
      >
        <p style={{ fontWeight: 'var(--font-weight-medium)', marginBottom: 'var(--space-1)' }}>
          {doc.name}
        </p>
        <p>
          {count} {count === 1 ? 'node' : 'nodes'}
        </p>
      </div>
      <DisclosureSection title="Canvas" defaultExpanded={true}>
        <NumberField
          label="Width"
          unit="px"
          value={doc.canvasWidth ?? 800}
          min={1}
          onChange={setCanvasWidth}
        />
        <NumberField
          label="Height"
          unit="px"
          value={doc.canvasHeight ?? 600}
          min={1}
          onChange={setCanvasHeight}
        />
        <div className="insp-field">
          <span className="insp-field__label">Background</span>
          <div className="insp-field__control">
            <ColorPicker
              value={canvasBg as import('@strata/engine').Color}
              onChange={setCanvasBackground}
            />
          </div>
        </div>
      </DisclosureSection>
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
      <header style={{ padding: '0 var(--space-2)', marginBottom: 'var(--space-1)' }}>
        <p style={{ fontSize: 'var(--font-size-xs)', fontWeight: 'var(--font-weight-medium)' }}>
          {node.name}
          <span
            style={{
              color: 'var(--color-text-muted)',
              fontWeight: 'var(--font-weight-regular)',
              marginLeft: 'var(--space-1)',
            }}
          >
            {node.kind}
          </span>
        </p>
      </header>
      {isComponentInstance && <ComponentSection node={node as import('@strata/scene').FrameNode} />}
      <PositionSizeSection nodes={nodes} />
      {isRect && <CornerRadiusSection nodes={nodes} />}
      <AppearanceSection nodes={nodes} />
      <FillSection nodes={nodes} />
      <FillStackSection nodes={nodes} />
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
      {isFrame && <LayoutSection node={node as import('@strata/scene').FrameNode} />}
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
      <FillStackSection nodes={nodes} />
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
    </>
  );
}
