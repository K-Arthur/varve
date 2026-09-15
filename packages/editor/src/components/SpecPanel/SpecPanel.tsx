/**
 * SpecPanel — developer handoff / inspection surface.
 *
 * Read-only mode activated when the tool is set to 'inspect'.
 * Displays per-node spec readouts, measurements, code generation,
 * asset export, and annotations — all computed locally from the
 * scene graph with zero network round-trips.
 */

import type { Engine } from '@varve/engine';
import type { Platform } from '@varve/platform';
import type { Document, SceneNode, VariableStore } from '@varve/scene';
import { useCallback, useRef, useState } from 'react';
import { type Annotation, AnnotationsDisplay } from './AnnotationsDisplay';
import { AssetExportControls } from './AssetExportControls';
import { CodeGenView } from './CodeGenView';
import { MeasurementReadout } from './MeasurementReadout';
import { MotionSpecSection } from './MotionSpecSection';
import { SpecReadouts } from './SpecReadouts';
import { UnitSelector, useSpecUnit } from './UnitSelector';
import './SpecPanel.css';

export interface SpecPanelProps {
  nodes: SceneNode[];
  doc: Document;
  variableStore?: VariableStore;
  engine?: Engine;
  platform?: Platform;
}

const BASE_FONT_SIZE = 16;

export function SpecPanel({ nodes, doc, variableStore, engine, platform }: SpecPanelProps) {
  const node = nodes[0];
  const [unit, setUnit] = useSpecUnit();
  const [annotations, setAnnotations] = useState<Annotation[]>([]);

  const annotIdRef = useRef(1);
  const handleAddAnnotation = useCallback(
    (text: string) => {
      const a: Annotation = {
        id: `annot-${annotIdRef.current++}`,
        nodeId: node?.id ?? '',
        text,
        timestamp: Date.now(),
      };
      setAnnotations((prev) => [...prev, a]);
    },
    [node],
  );

  const handleRemoveAnnotation = useCallback((id: string) => {
    setAnnotations((prev) => prev.filter((a) => a.id !== id));
  }, []);

  if (!node) {
    return (
      <section className="spec-panel" aria-label="Specification inspector">
        <div className="spec-panel__empty">
          <p className="spec-panel__empty-title">No selection</p>
          <p className="spec-panel__empty-desc">
            Select a layer or hover over the canvas to inspect measurements.
          </p>
        </div>
      </section>
    );
  }

  const readoutsProps = { node, doc, unit, baseFontSize: BASE_FONT_SIZE, variableStore };

  return (
    <section className="spec-panel" aria-label="Specification inspector">
      <div className="spec-panel__header">
        <span className="spec-panel__name">{node.name}</span>
        <span className="spec-panel__kind">{node.kind}</span>
      </div>

      <UnitSelector value={unit} onChange={setUnit} />

      <MeasurementReadout node={node} doc={doc} unit={unit} baseFontSize={BASE_FONT_SIZE} />
      <MotionSpecSection doc={doc} />
      <SpecReadouts {...readoutsProps} />
      <CodeGenView node={node} doc={doc} variableStore={variableStore} />

      <AssetExportControls node={node} doc={doc} engine={engine} platform={platform} />

      <AnnotationsDisplay
        nodeId={node.id}
        annotations={annotations}
        onAdd={handleAddAnnotation}
        onRemove={handleRemoveAnnotation}
      />
    </section>
  );
}
