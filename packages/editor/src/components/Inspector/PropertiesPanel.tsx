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
import { SpecPanel } from '../SpecPanel/SpecPanel';
import { DisclosureSection } from './controls/DisclosureSection';
import { NumberField } from './controls/NumberField';
import { AppearanceSection } from './sections/AppearanceSection';
import { EffectsSection } from './sections/EffectsSection';
import { FillSection } from './sections/FillSection';
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

  if (state.tool === 'inspect' && selNodes.length > 0) {
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
        <p
          style={{
            padding: 'var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Export options arriving in a future update.
        </p>
      )}
      {tab === 'spec' && (
        <p
          style={{
            padding: 'var(--space-2)',
            fontSize: 'var(--font-size-xs)',
            color: 'var(--color-text-muted)',
          }}
        >
          Spec inspector arriving in a future update.
        </p>
      )}
    </section>
  );
}

function EmptyState() {
  const { state } = useEditor();
  const doc = state.document;
  const count = Object.keys(doc.nodes).length;

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
      <DisclosureSection title="Canvas" defaultExpanded={false}>
        <NumberField label="Width" value={800} min={1} onChange={() => {}} />
        <NumberField label="Height" value={600} min={1} onChange={() => {}} />
      </DisclosureSection>
    </div>
  );
}

function SingleSelectionPanel({ nodes }: { nodes: SceneNode[] }) {
  const node = nodes[0] as SceneNode;
  const isFrame = node.kind === 'frame';

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
      <PositionSizeSection nodes={nodes} />
      <AppearanceSection nodes={nodes} />
      <FillSection nodes={nodes} />
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
      <PositionSizeSection nodes={nodes} />
      <AppearanceSection nodes={nodes} />
      <FillSection nodes={nodes} />
      <StrokeSection nodes={nodes} />
      <EffectsSection nodes={nodes} />
      <TypographySection nodes={nodes} />
    </>
  );
}
